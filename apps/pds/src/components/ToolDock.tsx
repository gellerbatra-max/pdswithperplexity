import { getWorkspace } from '@/features';
import { useUiStore } from '@/store';
import { Icon } from './Icon';

/**
 * Floating tool palette for the active workspace.
 *
 * Icon-first, the way every drafting tool does it: a row of text buttons cannot
 * fit nine tools without clipping, and reads like a toolbar in a web dashboard
 * rather than a palette. The label and shortcut live in the tooltip and in the
 * accessible name, so nothing is lost.
 *
 * Navigation tools (select, pan) are separated from the drafting tools, because
 * they are always available while the rest are workspace-specific.
 */
export const ToolDock = () => {
  const workspaceId = useUiStore((s) => s.workspace);
  const activeTool = useUiStore((s) => s.activeTool);
  const setActiveTool = useUiStore((s) => s.setActiveTool);

  const workspace = getWorkspace(workspaceId);

  const navigation = workspace.tools.filter((tool) => tool.id === 'select' || tool.id === 'pan');
  const drafting = workspace.tools.filter((tool) => tool.id !== 'select' && tool.id !== 'pan');

  const renderTool = (tool: (typeof workspace.tools)[number]) => {
    const planned = tool.status === 'planned';
    const name = tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label;

    return (
      <button
        key={tool.id}
        type="button"
        className="dock__tool"
        data-active={activeTool === tool.id || undefined}
        disabled={planned}
        aria-label={name}
        aria-pressed={activeTool === tool.id}
        title={planned ? `${name} — ${tool.hint}, not built yet` : `${name} — ${tool.hint}`}
        onClick={() => setActiveTool(tool.id)}
      >
        <Icon name={tool.icon} size={16} />
      </button>
    );
  };

  return (
    <div className="dock" role="toolbar" aria-label={`${workspace.title} tools`}>
      {navigation.map(renderTool)}
      {navigation.length > 0 && drafting.length > 0 ? (
        <span className="dock__divider" role="presentation" />
      ) : null}
      {drafting.map(renderTool)}
    </div>
  );
};
