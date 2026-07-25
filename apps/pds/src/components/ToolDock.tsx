import { getWorkspace } from '@/features';
import { useUiStore } from '@/store';

/** Floating, canvas-anchored tool dock for the active workspace. */
export const ToolDock = () => {
  const workspaceId = useUiStore((s) => s.workspace);
  const activeTool = useUiStore((s) => s.activeTool);
  const setActiveTool = useUiStore((s) => s.setActiveTool);

  const workspace = getWorkspace(workspaceId);

  return (
    <div className="dock" role="toolbar" aria-label={`${workspace.title} tools`}>
      {workspace.tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          className="dock__tool"
          data-active={activeTool === tool.id || undefined}
          data-planned={tool.status === 'planned' || undefined}
          disabled={tool.status === 'planned'}
          title={tool.status === 'planned' ? `${tool.hint} — not built yet` : tool.hint}
          onClick={() => setActiveTool(tool.id)}
        >
          {tool.label}
          {tool.shortcut ? <kbd>{tool.shortcut}</kbd> : null}
        </button>
      ))}
    </div>
  );
};
