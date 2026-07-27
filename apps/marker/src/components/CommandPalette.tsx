import { useEffect, useMemo, useState } from 'react';
import { COMMANDS, type Command } from '@/commands/registry';
import { useMarkerStore } from '@/store/markerStore';
import { useUiStore } from '@/store/uiStore';

/**
 * ⌘K palette over the command registry.
 *
 * Deliberately small: the registry is the list, so anything reachable by a
 * shortcut is reachable here, and a command added in one place appears in
 * both without a second edit.
 */
export const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selection = useUiStore((state) => state.selection);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuery('');
        setOpen((wasOpen) => !wasOpen);
        return;
      }
      // Escape closes the palette before it reaches the deselect command.
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    // Capture, so the palette sees Escape ahead of the canvas handler.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return COMMANDS.filter((command) => {
      if (command.needsSelection && selection.length === 0) return false;
      if (needle === '') return true;
      return (
        command.label.toLowerCase().includes(needle) ||
        command.keys.toLowerCase().includes(needle)
      );
    });
  }, [query, selection.length]);

  if (!open) return null;

  const run = (command: Command) => {
    const marker = useMarkerStore.getState().document;
    if (!marker) return;
    setOpen(false);
    command.run({ document: marker, selection: useUiStore.getState().selection });
  };

  return (
    <div className="palette" role="dialog" aria-label="Command palette">
      <div className="palette__backdrop" onClick={() => setOpen(false)} />
      <div className="palette__panel">
        <input
          className="palette__input"
          type="text"
          autoFocus
          placeholder="Search commands…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && matches[0]) run(matches[0]);
          }}
        />
        <ul className="palette__list">
          {matches.length === 0 ? (
            <li className="palette__empty">
              {selection.length === 0
                ? 'No matches. Most commands need a piece selected.'
                : 'No matches.'}
            </li>
          ) : (
            matches.map((command) => (
              <li key={command.id}>
                <button type="button" className="palette__item" onClick={() => run(command)}>
                  <span>{command.label}</span>
                  <kbd>{command.keys}</kbd>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
};
