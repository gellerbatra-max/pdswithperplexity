import { useEffect } from 'react';
import { useUiStore } from '@/store';
import { Icon } from './Icon';

/**
 * Command palette placeholder. The trigger, the ⌘K binding and the surface exist so
 * the shell is complete; the command index itself lands with the first real actions.
 */
export const CommandPalette = () => {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(!useUiStore.getState().commandPaletteOpen);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  if (!open) return null;

  return (
    <div className="palette-scrim" role="presentation" onClick={() => setOpen(false)}>
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="palette__input">
          <Icon name="search" size={15} />
          <input
            autoFocus
            placeholder="Search commands, pieces and tools…"
            aria-label="Search commands"
          />
        </div>
        <p className="palette__empty">
          The command index is not wired up yet. Press <kbd>Esc</kbd> to close.
        </p>
      </div>
    </div>
  );
};
