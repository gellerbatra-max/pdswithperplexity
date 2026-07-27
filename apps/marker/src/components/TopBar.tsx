import { useMarkerStore } from '@/store/markerStore';
import { useUiStore } from '@/store/uiStore';

/** 52px header: identity on the left, history and save state on the right. */
export const TopBar = () => {
  const name = useMarkerStore((state) => state.document?.name ?? 'No marker open');
  const canUndo = useMarkerStore((state) => state.past.length > 0);
  const canRedo = useMarkerStore((state) => state.future.length > 0);
  const undo = useMarkerStore((state) => state.undo);
  const redo = useMarkerStore((state) => state.redo);
  const setStatus = useUiStore((state) => state.setStatus);

  return (
    <header className="topbar">
      <span className="topbar__logo">NestIQ</span>
      <span className="topbar__name">{name}</span>

      <span className="topbar__spacer" />

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

      {/*
        TODO(step-8): drive this from the Dexie auto-save subscription. Until
        persistence exists there is nothing truthful to report, and a green
        "Saved" chip that means nothing is worse than no chip.
      */}
      <span className="topbar__save" data-state="unsaved">
        Not saved
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
