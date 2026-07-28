import { useEffect, useMemo, useRef, useState } from 'react';
import { fuzzyRank } from '@/commands/fuzzy';
import { COMMANDS, type Command } from '@/commands/registry';
import { useMarkerStore } from '@/store/markerStore';
import { useUiStore } from '@/store/uiStore';

/**
 * ⌘K over the command registry.
 *
 * The registry is the list, so anything reachable by a shortcut is reachable
 * here and a command added in one place appears in both. Matching is fuzzy
 * because substring search fails how people type — "rotcw" should find
 * "Rotate clockwise", and it contains no such substring.
 */

/** Highlight the characters the query actually matched. */
const Highlighted = ({ text, indices }: { text: string; indices: readonly number[] }) => {
  if (indices.length === 0) return <>{text}</>;
  const marked = new Set(indices);
  return (
    <>
      {[...text].map((character, index) =>
        marked.has(index) ? (
          <mark key={index} className="palette__hit">
            {character}
          </mark>
        ) : (
          <span key={index}>{character}</span>
        ),
      )}
    </>
  );
};

export const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const selection = useUiStore((state) => state.selection);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuery('');
        setActive(0);
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
    // Capture, so the palette sees these ahead of the canvas handler.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  const matches = useMemo(() => {
    const available = COMMANDS.filter(
      (command) => !command.needsSelection || selection.length > 0,
    );
    // Search the keys too, so "ctrl+z" finds undo.
    return fuzzyRank(query, available, (command) => `${command.label} ${command.keys}`);
  }, [query, selection.length]);

  // Any change to the result set invalidates the highlighted row.
  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  if (!open) return null;

  const run = (command: Command) => {
    const marker = useMarkerStore.getState().document;
    if (!marker) return;
    setOpen(false);
    command.run({ document: marker, selection: useUiStore.getState().selection });
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => (matches.length === 0 ? 0 : (index + 1) % matches.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) =>
        matches.length === 0 ? 0 : (index - 1 + matches.length) % matches.length,
      );
      return;
    }
    if (event.key === 'Enter') {
      const chosen = matches[active];
      if (chosen) run(chosen.item);
    }
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
          aria-label="Search commands"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onInputKeyDown}
        />
        <ul className="palette__list" ref={listRef}>
          {matches.length === 0 ? (
            <li className="palette__empty">
              {selection.length === 0
                ? 'No matches. Most commands need a piece selected.'
                : 'No matches.'}
            </li>
          ) : (
            matches.map(({ item, match }, index) => (
              <li key={item.id}>
                <button
                  type="button"
                  className="palette__item"
                  data-active={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => run(item)}
                >
                  <span>
                    <Highlighted text={item.label} indices={match.indices} />
                  </span>
                  <kbd>{item.keys}</kbd>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
};
