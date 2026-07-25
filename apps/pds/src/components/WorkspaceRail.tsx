import { WORKSPACES } from '@/features';
import { useUiStore } from '@/store';
import { Icon } from './Icon';

/**
 * Primary navigation: five workspaces, one stage. 64px wide, icon-first.
 * Switching workspace changes the surfaces around the stage, never the stage itself.
 */
export const WorkspaceRail = () => {
  const workspace = useUiStore((s) => s.workspace);
  const setWorkspace = useUiStore((s) => s.setWorkspace);

  return (
    <nav className="rail" aria-label="Workspaces">
      {WORKSPACES.map((entry) => (
        <button
          key={entry.id}
          type="button"
          className="rail__item"
          data-active={workspace === entry.id || undefined}
          title={entry.summary}
          aria-current={workspace === entry.id ? 'page' : undefined}
          onClick={() => setWorkspace(entry.id)}
        >
          <span className="rail__icon">
            <Icon name={entry.icon} size={18} />
          </span>
          <span className="rail__label">{entry.title}</span>
        </button>
      ))}
    </nav>
  );
};
