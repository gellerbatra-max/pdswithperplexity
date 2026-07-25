import { getWorkspace } from '@/features';
import { useSelectionStore, useUiStore } from '@/store';

/** Right inspector — properties of the current selection. Fixed width. */
export const InspectorPanel = () => {
  const workspaceId = useUiStore((s) => s.workspace);
  const selectedCount = useSelectionStore((s) => s.selection.length);

  const workspace = getWorkspace(workspaceId);
  const { Panel } = workspace;

  return (
    <aside className="inspector" aria-label="Inspector" tabIndex={-1}>
      <header className="inspector__header">
        <h2>Inspector</h2>
        <span className="badge" data-tone="muted">
          {selectedCount} selected
        </span>
      </header>
      <div className="inspector__body">
        <Panel />
      </div>
    </aside>
  );
};
