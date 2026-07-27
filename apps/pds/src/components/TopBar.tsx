import { renameDocument, useDocumentStore, useHistoryStore, useUiStore } from '@/store';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { SaveState } from './SaveState';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

/**
 * Top bar: identity and document-level affordances on the left/centre, session and
 * collaboration controls on the right. 56px tall, fixed.
 */
export const TopBar = () => {
  const documentName = useDocumentStore((s) => s.document.name);

  const canUndo = useHistoryStore((s) => s.canUndo);
  const canRedo = useHistoryStore((s) => s.canRedo);
  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);

  const setCommandPaletteOpen = useUiStore((s) => s.setCommandPaletteOpen);

  return (
    <header className="topbar">
      <div className="topbar__group topbar__group--start">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <span className="brand__name">PDS</span>
        </div>
        <span className="topbar__divider" role="presentation" />
        <WorkspaceSwitcher />
      </div>

      <div className="topbar__group topbar__group--center">
        <input
          className="doc-title"
          value={documentName}
          aria-label="Document title"
          spellCheck={false}
          onChange={(event) => renameDocument(event.target.value)}
        />
        <SaveState />
      </div>

      <div className="topbar__group topbar__group--end">
        <button
          type="button"
          className="command-trigger"
          onClick={() => setCommandPaletteOpen(true)}
        >
          <Icon name="search" size={14} />
          <span className="command-trigger__label">Search commands</span>
          <kbd className="command-trigger__kbd">⌘K</kbd>
        </button>

        <span className="topbar__divider" role="presentation" />

        <div className="topbar__cluster">
          <IconButton icon="undo" label="Undo" disabled={!canUndo} onClick={undo} />
          <IconButton icon="redo" label="Redo" disabled={!canRedo} onClick={redo} />
        </div>

        <IconButton icon="comment" label="Comments" />

        <button type="button" className="avatar" aria-label="Account">
          <span aria-hidden="true">RL</span>
        </button>
      </div>
    </header>
  );
};
