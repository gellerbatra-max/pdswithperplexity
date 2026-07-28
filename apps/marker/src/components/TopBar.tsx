import { closeMarker, type Persistence } from '@/db/persistence';
import { useMarkerStore } from '@/store/markerStore';
import { usePersistenceStore, type SaveState } from '@/store/persistenceStore';
import { useUiStore } from '@/store/uiStore';
import { AutoNestButton } from './AutoNestButton';

const SAVE_LABELS: Record<SaveState, string> = {
  idle: 'Not saved yet',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
};

/** 52px header: identity on the left, history and save state on the right. */
export const TopBar = ({ persistence }: { persistence?: Persistence | undefined }) => {
  const name = useMarkerStore((state) => state.document?.name ?? 'No marker open');
  const canUndo = useMarkerStore((state) => state.past.length > 0);
  const canRedo = useMarkerStore((state) => state.future.length > 0);
  const undo = useMarkerStore((state) => state.undo);
  const redo = useMarkerStore((state) => state.redo);
  const setStatus = useUiStore((state) => state.setStatus);
  const saveState = usePersistenceStore((state) => state.saveState);
  const lastSavedAt = usePersistenceStore((state) => state.lastSavedAt);
  const lastError = usePersistenceStore((state) => state.lastError);

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
      <span className="topbar__name">{name}</span>

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
        {SAVE_LABELS[saveState]}
      </span>

      {/* TODO(step-6+): open the command palette; the registry lands with commands/. */}
      <button
        type="button"
        className="topbar__button topbar__button--palette"
        onClick={() => setStatus('info', 'Command palette lands with the command registry')}
        title="Command palette"
      >
        ⌘K
      </button>
    </header>
  );
};
