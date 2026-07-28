import { useMemo, useState } from 'react';
import { bundleSlots } from '@/marker/bundles';
import { nextPlaceable, remainingOf, trayBundles, type TrayGroup } from '@/marker/tray';
import { useMarkerStore } from '@/store/markerStore';
import { useUiStore } from '@/store/uiStore';
import { pieceThumbnail } from './pieceThumbnail';

/**
 * 220px left panel: the order, grouped by bundle and then by piece.
 *
 * A row can be clicked to place at the origin, or dragged onto the marker to
 * place where it lands. Dragging carries a thumbnail of the actual outline,
 * because shape is the question you are answering when you choose a spot.
 */

/** The drag payload type, so the canvas can tell a row from a dropped file. */
export const TRAY_DRAG_TYPE = 'application/x-nestiq-tray-piece';

/** Drag ghost size in CSS pixels. */
const THUMBNAIL_PX = 56;

/**
 * Rows rendered at once, across all bundles.
 *
 * A 50,000-piece import measured a 6.7 second main-thread freeze building the
 * DOM for every row. This is a cap, not a fix: the real answer is a windowed
 * list that renders only what the scroll position needs.
 *
 * TODO(step-9): virtualise, and drop the cap.
 */
const MAX_VISIBLE_ROWS = 200;

export const PieceTray = () => {
  const trayPieces = useMarkerStore((state) => state.document?.trayPieces);
  const placeFromTray = useMarkerStore((state) => state.placeFromTray);
  const setStatus = useUiStore((state) => state.setStatus);
  const [query, setQuery] = useState('');

  // This component re-renders on every store change, including each drag
  // commit. Regrouping the whole tray that often is what makes a large import
  // feel slow long after it finished.
  const bundles = useMemo(
    () => (trayPieces ? trayBundles({ trayPieces }, query) : []),
    [trayPieces, query],
  );

  const slots = useMemo(
    () => (trayPieces ? bundleSlots({ pieces: [], trayPieces }) : new Map<string, number>()),
    [trayPieces],
  );

  const totals = useMemo(() => {
    const rows = bundles.reduce((sum, bundle) => sum + bundle.groups.length, 0);
    const outstanding = bundles.reduce(
      (sum, bundle) => sum + bundle.groups.reduce((n, group) => n + remainingOf(group), 0),
      0,
    );
    return { rows, outstanding };
  }, [bundles]);

  if (!trayPieces) return <aside className="tray" />;

  const place = (group: TrayGroup, at: 'origin') => {
    const piece = nextPlaceable(group);
    if (!piece) return;
    placeFromTray(piece.id, { x: 0, y: 0 });
    setStatus('ok', `Placed ${group.name} ${group.size} at the ${at}`);
  };

  let rendered = 0;

  return (
    <aside className="tray">
      <header className="panel__header">
        <h2 className="panel__title">Pieces</h2>
        <span className="panel__count">{totals.outstanding} left</span>
      </header>

      <div className="tray__search">
        <input
          type="search"
          className="tray__search-input"
          placeholder="Search pieces…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search pieces"
        />
      </div>

      <div className="tray__list">
        {trayPieces.length === 0 ? (
          <p className="tray__empty">No pieces imported yet.</p>
        ) : bundles.length === 0 ? (
          <p className="tray__empty">Nothing matches “{query}”.</p>
        ) : (
          bundles.map((bundle) => {
            const slot = slots.get(bundle.bundle) ?? 0;
            return (
              <section key={bundle.bundle} className="tray__bundle" data-complete={bundle.complete || undefined}>
                <header className="tray__bundle-header">
                  <span
                    className="tray__swatch"
                    style={{ background: `var(--bundle-${slot + 1}-chip)` }}
                    aria-hidden="true"
                  />
                  <span className="tray__bundle-name">{bundle.bundle || 'No bundle'}</span>
                  <span className="tray__bundle-count">
                    {bundle.placed}/{bundle.quantity}
                  </span>
                </header>

                {bundle.groups.map((group) => {
                  if (rendered >= MAX_VISIBLE_ROWS) return null;
                  rendered += 1;

                  const remaining = remainingOf(group);
                  const done = remaining <= 0;

                  return (
                    <button
                      key={group.key}
                      type="button"
                      className="tray__row"
                      data-exhausted={done || undefined}
                      disabled={done}
                      draggable={!done}
                      title={
                        done
                          ? `All ${group.name} pieces are placed`
                          : `Click to place at the origin, or drag onto the marker`
                      }
                      onClick={() => place(group, 'origin')}
                      onDragStart={(event) => {
                        const piece = nextPlaceable(group);
                        if (!piece) {
                          event.preventDefault();
                          return;
                        }
                        event.dataTransfer.setData(TRAY_DRAG_TYPE, piece.id);
                        event.dataTransfer.effectAllowed = 'copy';

                        const style = getComputedStyle(document.documentElement);
                        const ghost = pieceThumbnail(
                          piece.geometry,
                          {
                            fill: style.getPropertyValue(`--bundle-${slot + 1}-fill`).trim(),
                            line: style.getPropertyValue(`--bundle-${slot + 1}-line`).trim(),
                          },
                          THUMBNAIL_PX,
                        );
                        if (!ghost) return;

                        // setDragImage needs the element in the document, but
                        // it must not be seen: park it off-screen and drop it
                        // once the browser has taken its snapshot.
                        ghost.style.position = 'fixed';
                        ghost.style.top = '-1000px';
                        document.body.append(ghost);
                        event.dataTransfer.setDragImage(ghost, THUMBNAIL_PX / 2, THUMBNAIL_PX / 2);
                        window.setTimeout(() => ghost.remove(), 0);
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
                })}
              </section>
            );
          })
        )}

        {totals.rows > rendered ? (
          <p className="tray__empty">
            Showing {rendered} of {totals.rows} rows.
          </p>
        ) : null}
      </div>
    </aside>
  );
};
