import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dexieRepository } from '@/db/database';
import { listRecentMarkers, openMarker, type Persistence } from '@/db/persistence';
import { importDxfFile } from '@/io/dxfImporter';
import { parseMarker } from '@/io/markerJson';
import { createMarker, duplicateMarker } from '@/marker/newMarker';
import { arrangeRecent, SORT_LABELS, summarise, type RecentSort } from '@/marker/recent';
import type { MarkerDocument } from '@/marker/schema';
import { useUiStore } from '@/store/uiStore';
import { MarkerCard } from './MarkerCard';
import { readThumbnailTokens, type ThumbnailTokens } from './markerThumbnail';
import { NewMarkerDialog } from './NewMarkerDialog';

/**
 * The start hub: what the app shows when no marker is open.
 *
 * Three ways in — drop a file, pick a file, or start blank — and everything
 * already worked on, searchable and sortable. The list is read from the same
 * database the app saves to, so a marker appears here the moment it exists.
 */

const RECENT_LIMIT = 60;
const DXF = '.dxf';
const RUL = '.rul';
const MARKER_JSON = '.marker.json';

const SORTS: readonly RecentSort[] = ['opened', 'name', 'utilisation', 'created'];

export const HomeScreen = ({ persistence }: { persistence?: Persistence | undefined }) => {
  const [all, setAll] = useState<MarkerDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<RecentSort>('opened');
  const fileRef = useRef<HTMLInputElement>(null);
  const [tokens] = useState<ThumbnailTokens>(() => readThumbnailTokens());

  const refresh = useCallback(async () => {
    setAll((await listRecentMarkers()).slice(0, RECENT_LIMIT));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const shown = useMemo(() => arrangeRecent(all, { query, sort }), [all, query, sort]);
  const totals = useMemo(() => summarise(all), [all]);

  const open = useCallback(
    async (marker: MarkerDocument) => {
      await openMarker(marker, dexieRepository, persistence);
      useUiStore.getState().setStatus('ok', `Opened ${marker.name}`);
    },
    [persistence],
  );

  /**
   * Take whatever was dropped or chosen.
   *
   * A `.marker.json` is a whole marker, so it opens as itself; a DXF is a bag
   * of pieces, so it becomes a new marker named after the file.
   */
  const ingest = useCallback(
    async (files: readonly File[]) => {
      const native = files.find((file) => file.name.toLowerCase().endsWith(MARKER_JSON));
      const dxf = files.find((file) => file.name.toLowerCase().endsWith(DXF));
      const rul = files.find((file) => file.name.toLowerCase().endsWith(RUL));
      const ui = useUiStore.getState();

      if (!native && !dxf) {
        ui.setStatus('warn', 'Drop a .dxf or a .marker.json file');
        return;
      }

      setBusy('Reading file…');
      try {
        if (native) {
          const parsed = parseMarker(await native.text());
          // Re-opening a file that is already here must not silently overwrite
          // the copy in the database, so it arrives as a duplicate instead.
          const clash = await dexieRepository.loadMarker(parsed.id);
          const marker = clash ? duplicateMarker(parsed) : parsed;
          await open(marker);
          ui.setStatus('ok', clash ? `Opened a copy of ${parsed.name}` : `Opened ${marker.name}`);
          return;
        }

        if (!dxf) return;
        const [dxfText, rulText] = await Promise.all([dxf.text(), rul?.text()]);
        const outcome = await importDxfFile({
          dxfText,
          ...(rulText === undefined ? {} : { rulText }),
          onProgress: (percent) => setBusy(`Importing… ${percent}%`),
        });

        // The file name is the best name available; "Untitled" among twenty
        // others is no name at all.
        await open(
          createMarker({ name: dxf.name.replace(/\.dxf$/i, ''), trayPieces: outcome.pieces }),
        );

        const summary = `Imported ${outcome.pieces.length} piece(s) from ${dxf.name}`;
        if (outcome.warnings.length > 0) {
          ui.setStatus('warn', `${summary} — ${outcome.warnings.length} warning(s)`);
          for (const warning of outcome.warnings) console.warn('[dxf]', warning);
        } else {
          ui.setStatus('ok', summary);
        }
      } catch (error) {
        ui.setStatus('error', error instanceof Error ? error.message : 'Could not open that file');
      } finally {
        setBusy(null);
      }
    },
    [open],
  );

  const empty = !loading && all.length === 0;

  return (
    <div
      className="home"
      data-dropping={dropping || undefined}
      onDragOver={(event) => {
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        // Only when the pointer leaves the hub itself, not on every child.
        // `relatedTarget` is typed `EventTarget | null`; in a DOM drag it is
        // always an element or null, and `contains` wants a `Node | null`.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDropping(false);
        void ingest([...event.dataTransfer.files]);
      }}
    >
      <header className="home__header">
        <h1 className="home__title">NestIQ Marker</h1>
        <p className="home__subtitle">
          {empty
            ? 'Marker making for apparel factories. Everything stays on this machine.'
            : `${totals.markers} marker${totals.markers === 1 ? '' : 's'} · ${totals.pieces} piece${
                totals.pieces === 1 ? '' : 's'
              } placed · ${totals.made} complete`}
        </p>
      </header>

      <div className="home__actions">
        <button
          type="button"
          className="home__action home__action--primary"
          onClick={() => fileRef.current?.click()}
          disabled={busy !== null}
        >
          <span className="home__action-title">Open a file</span>
          <span className="home__action-note">
            AAMA or ASTM DXF, or a .marker.json you exported
          </span>
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
          accept=".dxf,.rul,.json"
          multiple
          className="home__file"
          onChange={(event) => {
            void ingest([...(event.target.files ?? [])]);
            // Clear it, or choosing the same file twice fires no change event.
            event.target.value = '';
          }}
        />
      </div>

      <p className="home__hint">
        {busy ?? 'You can also drag a file anywhere onto this screen.'}
      </p>

      <section className="home__recent">
        <header className="home__recent-header">
          <h2 className="home__section-title">Recent markers</h2>

          {all.length > 0 ? (
            <div className="home__controls">
              <input
                type="search"
                className="home__search"
                placeholder="Search markers…"
                value={query}
                aria-label="Search markers"
                onChange={(event) => setQuery(event.target.value)}
              />
              <label className="home__sort">
                <span className="field__label">Sort</span>
                <select
                  className="field__input"
                  value={sort}
                  aria-label="Sort markers"
                  onChange={(event) => {
                    const next = SORTS.find((candidate) => candidate === event.target.value);
                    if (next) setSort(next);
                  }}
                >
                  {SORTS.map((option) => (
                    <option key={option} value={option}>
                      {SORT_LABELS[option]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
        </header>

        {loading ? (
          <p className="home__empty">Reading local storage…</p>
        ) : empty ? (
          <div className="home__blank">
            <p className="home__blank-title">No markers yet</p>
            <p className="home__blank-note">
              Open a DXF to bring in an order&apos;s pieces, or start a blank marker and set the
              fabric width yourself. Markers you make appear here, saved in this browser.
            </p>
          </div>
        ) : shown.length === 0 ? (
          <div className="home__blank">
            <p className="home__blank-title">Nothing matches “{query}”</p>
            <p className="home__blank-note">
              Search covers the marker name, its order model and its status.
            </p>
            <button type="button" className="topbar__button" onClick={() => setQuery('')}>
              Clear search
            </button>
          </div>
        ) : (
          <ul className="home__grid">
            {shown.map((marker) => (
              <MarkerCard
                key={marker.id}
                marker={marker}
                tokens={tokens}
                onOpen={() => void open(marker)}
                onRename={async (name) => {
                  await dexieRepository.saveMarker({ ...marker, name });
                  await refresh();
                }}
                onDuplicate={async () => {
                  await dexieRepository.saveMarker(duplicateMarker(marker));
                  await refresh();
                  useUiStore.getState().setStatus('ok', `Duplicated ${marker.name}`);
                }}
                onDelete={async () => {
                  await dexieRepository.deleteMarker(marker.id);
                  await refresh();
                  useUiStore.getState().setStatus('info', `Deleted ${marker.name}`);
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {dropping ? <div className="home__dropzone">Drop to open</div> : null}

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
