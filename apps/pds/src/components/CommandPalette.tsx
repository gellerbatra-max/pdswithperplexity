import { useEffect, useMemo, useRef, useState } from 'react';
import { COMMAND_GROUPS, searchCommands, type Command } from '@/commands';
import { useUiStore } from '@/store';
import { Icon } from './Icon';

/** Step to the next selectable row, skipping disabled commands and wrapping. */
const step = (
  from: number,
  direction: 1 | -1,
  items: readonly Command[],
  enabled: ReadonlySet<string>,
): number => {
  if (items.length === 0) return -1;
  for (let i = 1; i <= items.length; i += 1) {
    const index = (from + direction * i + items.length * i) % items.length;
    const candidate = items[index];
    if (candidate && enabled.has(candidate.id)) return index;
  }
  return -1;
};

const PaletteDialog = () => {
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  /*
   * Capture the previously focused element, then move focus into the input.
   * Deliberately not `autoFocus` on the input: that fires during commit, before
   * this effect, so we would capture the input itself and "restore" focus to a
   * detached node on close — dropping the user back on <body>.
   */
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => restoreRef.current?.focus?.();
  }, []);

  const results = useMemo(() => searchCommands(query), [query]);

  const enabled = useMemo(
    () => new Set(results.filter((c) => c.isEnabled?.() ?? true).map((c) => c.id)),
    [results],
  );

  const groups = useMemo(
    () =>
      COMMAND_GROUPS.map((group) => ({
        group,
        items: results.filter((command) => command.group === group.id),
      })).filter((entry) => entry.items.length > 0),
    [results],
  );

  const flat = useMemo(() => groups.flatMap((entry) => entry.items), [groups]);

  // Land on the first runnable row whenever the result set changes.
  useEffect(() => {
    const first = flat.findIndex((command) => enabled.has(command.id));
    setActiveIndex(first);
  }, [flat, enabled]);

  const active = activeIndex >= 0 ? flat[activeIndex] : undefined;

  useEffect(() => {
    if (!active) return;
    listRef.current
      ?.querySelector(`#cmd-${CSS.escape(active.id)}`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const execute = (command: Command): void => {
    if (!enabled.has(command.id)) return;
    setOpen(false);
    /*
     * Run after the overlay unmounts, so the focus-restore cleanup below cannot
     * steal focus back from a command that moves it. A timer rather than
     * requestAnimationFrame: rAF is suspended in a backgrounded tab, which would
     * silently drop the command.
     */
    setTimeout(() => command.run(), 0);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((current) => step(current, 1, flat, enabled));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((current) => step(current, -1, flat, enabled));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(flat.findIndex((c) => enabled.has(c.id)));
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(step(0, -1, flat, enabled));
        break;
      case 'Enter':
        event.preventDefault();
        if (active) execute(active);
        break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div className="palette-scrim" role="presentation" onClick={() => setOpen(false)}>
      {/* Key handling lives on the wrapper so arrows work from the input. */}
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="palette__input">
          <Icon name="search" size={15} />
          <input
            ref={inputRef}
            value={query}
            role="combobox"
            aria-expanded
            aria-controls="command-list"
            aria-autocomplete="list"
            aria-activedescendant={active ? `cmd-${active.id}` : undefined}
            placeholder="Search commands…"
            aria-label="Search commands"
            spellCheck={false}
            onChange={(event) => setQuery(event.target.value)}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="palette__list" id="command-list" role="listbox" ref={listRef}>
          {groups.length === 0 ? (
            <p className="palette__empty">No commands match “{query}”.</p>
          ) : (
            groups.map(({ group, items }) => (
              <div className="palette__group" role="group" aria-label={group.label} key={group.id}>
                <div className="palette__group-label">{group.label}</div>
                {items.map((command) => {
                  const index = flat.indexOf(command);
                  const isEnabled = enabled.has(command.id);
                  return (
                    <div
                      key={command.id}
                      id={`cmd-${command.id}`}
                      role="option"
                      aria-selected={index === activeIndex}
                      aria-disabled={!isEnabled || undefined}
                      className="palette__item"
                      data-active={index === activeIndex || undefined}
                      data-disabled={!isEnabled || undefined}
                      onMouseMove={() => isEnabled && setActiveIndex(index)}
                      onClick={() => execute(command)}
                    >
                      <span className="palette__icon">
                        <Icon name={command.icon} size={14} />
                      </span>
                      <span className="palette__title">{command.title}</span>
                      {command.status === 'mock' ? (
                        <span className="badge" data-tone="muted">
                          mock
                        </span>
                      ) : null}
                      {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="palette__footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> run
          </span>
          <span className="palette__count">
            {flat.length} command{flat.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  );
};

/**
 * Owns the global ⌘K / Ctrl+K binding and mounts the dialog on demand, so the
 * dialog's query and selection reset on every open without extra bookkeeping.
 */
export const CommandPalette = () => {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const setOpen = useUiStore((s) => s.setCommandPaletteOpen);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(!useUiStore.getState().commandPaletteOpen);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  return open ? <PaletteDialog /> : null;
};
