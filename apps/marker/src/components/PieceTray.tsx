import { useMemo } from 'react';
import { nextPlaceable, trayGroups } from '@/marker/tray';
import { useMarkerStore } from '@/store/markerStore';
import { useUiStore } from '@/store/uiStore';

/**
 * 220px left panel: every piece in the order, grouped by piece × size × fabric.
 *
 * TODO(step-7): drag a row straight onto the canvas to place it at the drop
 * point. Clicking places at the origin, which is what the spec asks for, but
 * it does mean the piece lands on top of whatever is already there.
 */

/**
 * Rows rendered at once.
 *
 * A 50,000-piece import measured a 6.7 second main-thread freeze building the
 * DOM for every row — far longer than the parse it followed. This is a cap,
 * not a fix: the real answer is a windowed list that renders only what the
 * scroll position needs.
 *
 * TODO(step-9): virtualise, and drop the cap.
 */
const MAX_VISIBLE_ROWS = 200;

export const PieceTray = () => {
  const trayPieces = useMarkerStore((state) => state.document?.trayPieces);
  const placeFromTray = useMarkerStore((state) => state.placeFromTray);
  const setStatus = useUiStore((state) => state.setStatus);

  // This component re-renders on every store change, including each drag
  // commit. Regrouping the whole tray that often is what makes a large import
  // feel slow long after it finished.
  const groups = useMemo(
    () => (trayPieces ? trayGroups({ trayPieces }) : []),
    [trayPieces],
  );
  const visible = groups.slice(0, MAX_VISIBLE_ROWS);

  if (!trayPieces) return <aside className="tray" />;

  return (
    <aside className="tray">
      <header className="panel__header">
        <h2 className="panel__title">Pieces</h2>
        <span className="panel__count">{groups.length}</span>
      </header>

      <div className="tray__list">
        {groups.length === 0 ? (
          <p className="tray__empty">No pieces imported yet.</p>
        ) : (
          visible.map((group) => {
            const remaining = group.quantity - group.placed;
            return (
              <button
                key={group.key}
                type="button"
                className="tray__row"
                data-exhausted={remaining <= 0 || undefined}
                disabled={remaining <= 0}
                title={
                  remaining > 0
                    ? `Place ${group.name} at the marker origin`
                    : `All ${group.name} pieces are placed`
                }
                onClick={() => {
                  const piece = nextPlaceable(group);
                  if (!piece) return;
                  placeFromTray(piece.id, { x: 0, y: 0 });
                  setStatus('ok', `Placed ${group.name} ${group.size} at the origin`);
                }}
              >
                <span className="tray__name">{group.name}</span>
                <span className="tray__meta">
                  {group.size} · {group.fabricCode}
                </span>
                <span className="tray__badge">
                  {group.placed}/{group.quantity}
                </span>
              </button>
            );
          })
        )}

        {groups.length > visible.length ? (
          <p className="tray__empty">
            Showing {visible.length} of {groups.length} rows.
          </p>
        ) : null}
      </div>
    </aside>
  );
};
