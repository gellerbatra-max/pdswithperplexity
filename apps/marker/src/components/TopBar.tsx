import { useEffect, useRef, useState } from 'react';
import { closeMarker, type Persistence } from '@/db/persistence';
import { useMarkerStore } from '@/store/markerStore';
import { usePersistenceStore, type SaveState } from '@/store/persistenceStore';
import { AutoNestButton } from './AutoNestButton';

/** 52px header: navigation and identity left, actions and save state right. */

const SAVE_LABELS: Record<SaveState, string> = {
  idle: 'Not saved yet',
  unsaved: 'Unsaved',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
};

/**
 * Click the name to rename in place.
 *
 * Committed on blur or Enter rather than per keystroke, for the same reason as
 * the width field: every keystroke would otherwise be its own undo entry, and
 * the marker would flicker through "S", "Sp", "Spr" in the recent list.
 */
const MarkerName = () => {
  const name = useMarkerStore((state) => state.document?.name ?? '');
  const rename = useMarkerStore((state) => state.renameMarker);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        className="topbar__name"
        title="Click to rename"
        onClick={() => setEditing(true)}
      >
        {name}
      </button>
    );
  }

  const commit = () => {
    rename(draft);
    setEditing(false);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      className="topbar__rename"
      value={draft}
      aria-label="Marker name"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        // Stop here: the shortcut handler is on the window, and Escape would
        // otherwise clear the canvas selection behind the open field.
        event.stopPropagation();
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') {
          setDraft(name);
          setEditing(false);
        }
      }}
    />
  );
};

const SaveIndicator = () => {
  const saveState = usePersistenceStore((state) => state.saveState);
  const lastSavedAt = usePersistenceStore((state) => state.lastSavedAt);
  const lastError = usePersistenceStore((state) => state.lastError);

  return (
    <span
      className="topbar__save"
      data-state={saveState}
      title={
        lastError ??
        (lastSavedAt === null
          ? 'Nothing written to this browser yet'
          : `Last saved ${new Date(lastSavedAt).toLocaleTimeString()}`)
      }
    >
      <span className="topbar__save-dot" aria-hidden="true" />
      {SAVE_LABELS[saveState]}
    </span>
  );
};

export const TopBar = ({ persistence }: { persistence?: Persistence | undefined }) => {
  const canUndo = useMarkerStore((state) => state.past.length > 0);
  const canRedo = useMarkerStore((state) => state.future.length > 0);
  const undo = useMarkerStore((state) => state.undo);
  const redo = useMarkerStore((state) => state.redo);

  return (
    <header className="topbar">
      <button
        type="button"
        className="topbar__button topbar__back"
        title="Close this marker and return to the home screen"
        onClick={() => void closeMarker(persistence)}
      >
        ← Markers
      </button>

      <span className="topbar__logo">NestIQ</span>
      <MarkerName />

      <span className="topbar__spacer" />

      <AutoNestButton />

      <span className="topbar__divider" role="presentation" />

      <button
        type="button"
        className="topbar__button"
        onClick={undo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
      >
        Undo
      </button>
      <button
        type="button"
        className="topbar__button"
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
      >
        Redo
      </button>

      <span className="topbar__divider" role="presentation" />

      <SaveIndicator />

      <button
        type="button"
        className="topbar__button topbar__button--palette"
        title="Command palette (⌘K)"
        // The palette owns its open state and listens on the window, so the
        // button raises the same shortcut rather than duplicating the state.
        onClick={() =>
          window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
          )
        }
      >
        ⌘K
      </button>
    </header>
  );
};
