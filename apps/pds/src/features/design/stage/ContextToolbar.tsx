import { worldToScreen } from '@/canvas';
import { Icon, type IconName } from '@/components/Icon';
import { BoundsOps } from '@/geometry';
import { pieceBounds } from '@/pattern';
import { useDocumentStore, useSelectionStore, useViewportStore } from '@/store';

interface ContextAction {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
}

/** Actions that will apply to the current selection once editing tools exist. */
const ACTIONS: readonly ContextAction[] = [
  { id: 'mirror', label: 'Mirror', icon: 'grade' },
  { id: 'rotate', label: 'Rotate', icon: 'maximize' },
  { id: 'seam', label: 'Seam allowance', icon: 'ruler' },
  { id: 'notch', label: 'Notch', icon: 'minus' },
  { id: 'grain', label: 'Grain', icon: 'design' },
  { id: 'duplicate', label: 'Duplicate', icon: 'plus' },
];

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

      {ACTIONS.map((action) => (
        <button
          key={action.id}
          type="button"
          className="context-toolbar__action"
          title={`${action.label} — not built yet`}
          disabled
        >
          <Icon name={action.icon} size={13} />
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
};
