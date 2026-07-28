import { useCallback, useEffect, useRef, useState } from 'react';
import { listRecentMarkers, openMarker, type Persistence } from '@/db/persistence';
import { dexieRepository } from '@/db/database';
import { importDxfFile } from '@/io/dxfImporter';
import { createMarker, duplicateMarker } from '@/marker/newMarker';
import { consumption, markerLength, markerStatus, utilization } from '@/marker/selectors';
import type { MarkerDocument } from '@/marker/schema';
import { utilisationBand } from '@/marker/utilisation';
import { useUiStore } from '@/store/uiStore';
import { drawMarkerThumbnail, readThumbnailTokens, type ThumbnailTokens } from './markerThumbnail';
import { NewMarkerDialog } from './NewMarkerDialog';

/**
 * What the app shows when no marker is open.
 *
 * Two ways in — a DXF or a blank marker — and everything already worked on,
 * most recently opened first. The list is read from the same database the app
 * saves to, so a marker appears here the moment it exists.
 */

const RECENT_LIMIT = 24;

const formatWhen = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'never opened';
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return new Date(iso).toLocaleDateString();
};

const Thumbnail = ({ marker, tokens }: { marker: MarkerDocument; tokens: ThumbnailTokens }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (canvas) drawMarkerThumbnail(canvas, marker, tokens);
  }, [marker, tokens]);

  return <canvas className="card__thumb" ref={ref} aria-hidden="true" />;
};

export const HomeScreen = ({ persistence }: { persistence?: Persistence | undefined }) => {
  const [recent, setRecent] = useState<MarkerDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [tokens] = useState<ThumbnailTokens>(() => readThumbnailTokens());

  const refresh = useCallback(async () => {
    const markers = await listRecentMarkers();
    setRecent(markers.slice(0, RECENT_LIMIT));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = useCallback(
    async (marker: MarkerDocument) => {
      await openMarker(marker, dexieRepository, persistence);
      useUiStore.getState().setStatus('ok', `Opened ${marker.name}`);
    },
    [persistence],
  );

  const onDxfChosen = useCallback(
    async (files: FileList | null) => {
      const dxf = [...(files ?? [])].find((file) => file.name.toLowerCase().endsWith('.dxf'));
      const rul = [...(files ?? [])].find((file) => file.name.toLowerCase().endsWith('.rul'));
      if (!dxf) return;

      setBusy('Reading file…');
      try {
        const [dxfText, rulText] = await Promise.all([dxf.text(), rul?.text()]);
        const outcome = await importDxfFile({
          dxfText,
          ...(rulText === undefined ? {} : { rulText }),
          onProgress: (percent) => setBusy(`Importing… ${percent}%`),
        });

        // The file name is the best name available; a marker called
        // "Untitled" among twenty others is no name at all.
        const marker = createMarker({
          name: dxf.name.replace(/\.dxf$/i, ''),
          trayPieces: outcome.pieces,
        });
        await open(marker);

        const summary = `Imported ${outcome.pieces.length} piece(s) from ${dxf.name}`;
        if (outcome.warnings.length > 0) {
          useUiStore
            .getState()
            .setStatus('warn', `${summary} — ${outcome.warnings.length} warning(s)`);
          for (const warning of outcome.warnings) console.warn('[dxf]', warning);
        } else {
          useUiStore.getState().setStatus('ok', summary);
        }
      } catch (error) {
        useUiStore
          .getState()
          .setStatus('error', error instanceof Error ? error.message : 'DXF import failed');
      } finally {
        setBusy(null);
      }
    },
    [open],
  );

  return (
    <div className="home">
      <header className="home__header">
        <div>
          <h1 className="home__title">NestIQ Marker</h1>
          <p className="home__subtitle">Marker making for apparel factories.</p>
        </div>
      </header>

      <div className="home__actions">
        <button
          type="button"
          className="home__action home__action--primary"
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
        >
          <span className="home__action-title">Open DXF file</span>
          <span className="home__action-note">Import pieces from AAMA or ASTM DXF</span>
        </button>

        <button
          type="button"
          className="home__action"
          onClick={() => setDialogOpen(true)}
          disabled={busy !== null}
        >
          <span className="home__action-title">New blank marker</span>
          <span className="home__action-note">Start from an empty roll</span>
        </button>

        <input
          ref={fileRef}
          type="file"
          accept=".dxf,.rul"
          multiple
          className="home__file"
          onChange={(event) => {
            void onDxfChosen(event.target.files);
            // Clear it, or choosing the same file twice fires no change event.
            event.target.value = '';
          }}
        />
      </div>

      {busy ? <p className="home__busy">{busy}</p> : null}

      <section className="home__recent">
        <h2 className="home__section-title">Recent markers</h2>

        {loading ? (
          <p className="home__empty">Reading local storage…</p>
        ) : recent.length === 0 ? (
          <p className="home__empty">
            Nothing here yet. Open a DXF or start a blank marker to begin.
          </p>
        ) : (
          <ul className="home__grid">
            {recent.map((marker) => {
              const percent = utilization(marker);
              const status = markerStatus(marker);
              return (
                <li key={marker.id} className="card">
                  <button
                    type="button"
                    className="card__open"
                    onClick={() => void open(marker)}
                    title={`Open ${marker.name}`}
                  >
                    <Thumbnail marker={marker} tokens={tokens} />
                    <span className="card__name">{marker.name}</span>
                    <span className="card__meta">
                      {marker.pieces.length} piece{marker.pieces.length === 1 ? '' : 's'} ·{' '}
                      {marker.fabricWidth} cm · {formatWhen(marker.lastOpenedAt)}
                    </span>
                    <span className="card__stats">
                      <span className="card__util" data-band={utilisationBand(percent)}>
                        {percent.toFixed(1)}%
                      </span>
                      <span className="card__length">{markerLength(marker).toFixed(0)} cm</span>
                      <span className="card__consumption">
                        {consumption(marker).toFixed(2)} m
                      </span>
                      <span className="ribbon__status" data-status={status}>
                        {status}
                      </span>
                    </span>
                  </button>

                  <div className="card__actions">
                    <button
                      type="button"
                      className="card__action"
                      title="Duplicate this marker"
                      onClick={async () => {
                        await dexieRepository.saveMarker(duplicateMarker(marker));
                        await refresh();
                      }}
                    >
                      Duplicate
                    </button>

                    {confirmDelete === marker.id ? (
                      <>
                        <button
                          type="button"
                          className="card__action card__action--danger"
                          onClick={async () => {
                            await dexieRepository.deleteMarker(marker.id);
                            setConfirmDelete(null);
                            await refresh();
                          }}
                        >
                          Delete for good
                        </button>
                        <button
                          type="button"
                          className="card__action"
                          onClick={() => setConfirmDelete(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="card__action"
                        // Deleting a marker takes its restore points with it,
                        // so there is nothing left to undo from. Ask first.
                        onClick={() => setConfirmDelete(marker.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {dialogOpen ? (
        <NewMarkerDialog
          onCancel={() => setDialogOpen(false)}
          onCreate={async (options) => {
            setDialogOpen(false);
            await open(createMarker(options));
          }}
        />
      ) : null}
    </div>
  );
};
