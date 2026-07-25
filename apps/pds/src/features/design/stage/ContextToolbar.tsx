import { Icon, type IconName } from '@/components/Icon';
import { useDocumentStore } from '@/store';

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

/**
 * Selection-anchored toolbar, floating above the stage. Appears only when
 * something is selected, the way Figma surfaces contextual actions.
 */
export const ContextToolbar = () => {
  const pieces = useDocumentStore((s) => s.document.pieces);
  const selectedPieceIds = useDocumentStore((s) => s.selectedPieceIds);

  if (selectedPieceIds.size === 0) return null;

  const selected = pieces.filter((p) => selectedPieceIds.has(p.id));
  const label =
    selected.length === 1 ? (selected[0]?.name ?? 'Selection') : `${selected.length} pieces`;

  return (
    <div className="context-toolbar" role="toolbar" aria-label="Selection actions">
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
