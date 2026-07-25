import { useEffect, useRef, useState } from 'react';
import { WORKSPACES, getWorkspace } from '@/features';
import { useUiStore } from '@/store';
import { Icon } from './Icon';

/** Compact workspace menu in the top bar. Mirrors the rail — either can drive it. */
export const WorkspaceSwitcher = () => {
  const workspaceId = useUiStore((s) => s.workspace);
  const setWorkspace = useUiStore((s) => s.setWorkspace);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const current = getWorkspace(workspaceId);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="switcher" ref={rootRef}>
      <button
        type="button"
        className="switcher__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={current.icon} size={14} />
        <span>{current.title}</span>
        <Icon name="chevron-down" size={12} />
      </button>

      {open ? (
        <div className="switcher__menu" role="menu">
          {WORKSPACES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitemradio"
              aria-checked={entry.id === workspaceId}
              className="switcher__item"
              data-active={entry.id === workspaceId || undefined}
              onClick={() => {
                setWorkspace(entry.id);
                setOpen(false);
              }}
            >
              <Icon name={entry.icon} size={14} />
              <span className="switcher__item-text">
                <span className="switcher__item-title">{entry.title}</span>
                <span className="switcher__item-summary">{entry.summary}</span>
              </span>
              {entry.id === workspaceId ? <Icon name="check" size={13} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};
