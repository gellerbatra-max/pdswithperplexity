import { worldToScreen } from '@/canvas';
import { Icon } from '@/components/Icon';
import { BoundsOps } from '@/geometry';
import { pieceBounds } from '@/pattern';
import {
  duplicatePiece,
  pieceRef,
  removePiece,
  useDocumentStore,
  useSelectionStore,
  useViewportStore,
} from '@/store';

/*
 * This bar used to carry five more actions — Mirror, Rotate, Seam allowance,
 * Notch, Grain — all permanently disabled. They are gone rather than greyed:
 * an affordance that never activates is worse than an absent one, because it
 * reads as a bug rather than as a gap. Duplicate and Remove remain because they
 * work.
 */

/** Keeps the bar clear of the stage edges and the rulers. */
const EDGE_INSET_PX = 150;
const MIN_TOP_PX = 62;
const GAP_ABOVE_SELECTION_PX = 14;

/**
 * Selection-anchored toolbar, floating above whatever is selected.
 *
 * Position comes from the selection's bounds through the live camera, so it
 * tracks panning and zooming. Clamping is done in CSS with `clamp()` and
 * `max()` rather than by measuring the stage, which keeps this a pure render
 * with no layout reads.
 */
export const ContextToolbar = () => {
  const pieces = useDocumentStore((s) => s.document.pieces);
  const selectedPieceIds = useSelectionStore((s) => s.selectedPieceIds);
  const select = useSelectionStore((s) => s.select);
  const camera = useViewportStore((s) => s.camera);

  if (selectedPieceIds.size === 0) return null;

  const selected = pieces.filter((p) => selectedPieceIds.has(p.id));
  if (selected.length === 0) return null;

  const bounds = selected
    .map(pieceBounds)
    .filter((b) => !BoundsOps.isEmpty(b))
    .reduce(BoundsOps.union, BoundsOps.EMPTY_BOUNDS);
  if (BoundsOps.isEmpty(bounds)) return null;

  const anchor = worldToScreen(camera, {
    x: (bounds.minX + bounds.maxX) / 2,
    y: bounds.minY,
  });

  const label =
    selected.length === 1 ? (selected[0]?.name ?? 'Selection') : `${selected.length} pieces`;

  return (
    <div
      className="context-toolbar"
      role="toolbar"
      aria-label="Selection actions"
      style={{
        left: `clamp(${EDGE_INSET_PX}px, ${anchor.x}px, calc(100% - ${EDGE_INSET_PX}px))`,
        top: `max(${MIN_TOP_PX}px, ${anchor.y - GAP_ABOVE_SELECTION_PX}px)`,
      }}
    >
      <span className="context-toolbar__subject">
        <Icon name="piece" size={13} />
        {label}
      </span>

      <span className="context-toolbar__divider" role="presentation" />

      {/* Duplicate and Remove need no geometry tools, so they are real. Both
          act on a single piece; with a multi-selection they stay disabled
          rather than guessing which piece is meant. */}
      <button
        type="button"
        className="context-toolbar__action"
        title={
          selected.length === 1
            ? 'Duplicate piece'
            : 'Duplicate — select a single piece'
        }
        disabled={selected.length !== 1}
        onClick={() => {
          const source = selected[0];
          if (!source) return;
          select(pieceRef(duplicatePiece(source.id)), false);
        }}
      >
        <Icon name="plus" size={13} />
        <span>Duplicate</span>
      </button>

      <button
        type="button"
        className="context-toolbar__action"
        title={selected.length === 1 ? 'Remove piece' : 'Remove — select a single piece'}
        disabled={selected.length !== 1}
        onClick={() => {
          const target = selected[0];
          if (!target) return;
          // Selection is pruned by the selection store's document subscription.
          removePiece(target.id);
        }}
      >
        <Icon name="minus" size={13} />
        <span>Remove</span>
      </button>
    </div>
  );
};
