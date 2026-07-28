import { useEffect, useRef, useState } from 'react';
import { consumption, markerLength, markerStatus, utilization } from '@/marker/selectors';
import type { MarkerDocument } from '@/marker/schema';
import { utilisationBand } from '@/marker/utilisation';
import { drawMarkerThumbnail, type ThumbnailTokens } from './markerThumbnail';

/**
 * One recent marker.
 *
 * Three tight rows under the thumbnail, each with the same left and right
 * anchor on every card, so a column of cards can be read straight down:
 * name and utilisation, then the numbers, then status and recency.
 *
 * The actions are always visible and are drawn as buttons at rest, not as
 * grey labels that only look clickable once the pointer is on them. A
 * hover-only action does not exist on a touch screen and is undiscoverable
 * on a mouse.
 */

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

export interface MarkerCardProps {
  readonly marker: MarkerDocument;
  readonly tokens: ThumbnailTokens;
  readonly onOpen: () => void;
  readonly onRename: (name: string) => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
}

export const MarkerCard = ({
  marker,
  tokens,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
}: MarkerCardProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(marker.name);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) drawMarkerThumbnail(canvas, marker, tokens);
  }, [marker, tokens]);

  useEffect(() => {
    if (renaming) nameRef.current?.select();
    else setDraft(marker.name);
  }, [renaming, marker.name]);

  const percent = utilization(marker);
  const status = markerStatus(marker);
  const length = markerLength(marker);

  const commitRename = () => {
    setRenaming(false);
    const trimmed = draft.trim();
    // An empty name would make the marker unfindable in its own list.
    if (trimmed !== '' && trimmed !== marker.name) onRename(trimmed);
  };

  return (
    <li className="card" data-confirming={confirming || undefined}>
      <button
        type="button"
        className="card__open"
        onClick={onOpen}
        title={`Open ${marker.name}`}
        aria-label={`Open ${marker.name}`}
      >
        <canvas className="card__thumb" ref={canvasRef} aria-hidden="true" />
        <span className="card__open-hint">Open</span>
      </button>

      <div className="card__body">
        <div className="card__headline">
          {renaming ? (
            <input
              ref={nameRef}
              type="text"
              className="card__rename"
              value={draft}
              aria-label="Marker name"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') commitRename();
                if (event.key === 'Escape') {
                  setDraft(marker.name);
                  setRenaming(false);
                }
              }}
            />
          ) : (
            <>
              <button type="button" className="card__name" onClick={onOpen} title={marker.name}>
                {marker.name}
              </button>
              <span
                className="card__util"
                data-band={utilisationBand(percent)}
                aria-label={`Utilisation ${percent.toFixed(1)} percent`}
              >
                {percent.toFixed(1)}%
              </span>
            </>
          )}
        </div>

        {/*
         * Width × length, in that order, because that is how a marker is
         * quoted on the floor. Spelled out in the tooltip, since the compact
         * form is what fits in a 200px column.
         */}
        <span
          className="card__meta"
          title={`${marker.pieces.length} pieces · ${marker.fabricWidth} cm wide · ${length.toFixed(0)} cm long · ${consumption(marker).toFixed(2)} m per garment`}
        >
          {marker.pieces.length} piece{marker.pieces.length === 1 ? '' : 's'} ·{' '}
          {marker.fabricWidth} × {length.toFixed(0)} cm · {consumption(marker).toFixed(2)} m
        </span>

        <span className="card__foot">
          <span className="ribbon__status" data-status={status}>
            {status}
          </span>
          <span className="card__when">{formatWhen(marker.lastOpenedAt)}</span>
        </span>
      </div>

      {confirming ? (
        <div className="card__actions card__actions--confirm">
          <span className="card__confirm-text">Delete permanently?</span>
          <button
            type="button"
            className="card__action card__action--danger"
            onClick={() => {
              setConfirming(false);
              onDelete();
            }}
          >
            Delete
          </button>
          <button type="button" className="card__action" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="card__actions">
          <button
            type="button"
            className="card__action"
            title={`Rename ${marker.name}`}
            onClick={() => setRenaming(true)}
          >
            Rename
          </button>
          <button
            type="button"
            className="card__action"
            title={`Duplicate ${marker.name}`}
            onClick={onDuplicate}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="card__action card__action--danger"
            title={`Delete ${marker.name}`}
            // Deleting takes the restore points with it, so there is nothing
            // left to undo from. Ask first.
            onClick={() => setConfirming(true)}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
};
