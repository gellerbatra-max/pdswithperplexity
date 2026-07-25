import { useCallback, useEffect, useRef, useState } from 'react';
import { getWorkspace } from '@/features';
import { CONTEXT_WIDTH_MAX, CONTEXT_WIDTH_MIN, useUiStore } from '@/store';

/**
 * Left context panel — what exists in the document for the active workspace.
 * Drag its trailing edge to resize; the width is clamped and kept in the UI store.
 */
export const ContextPanel = () => {
  const workspaceId = useUiStore((s) => s.workspace);
  const width = useUiStore((s) => s.contextPanelWidth);
  const setWidth = useUiStore((s) => s.setContextPanelWidth);

  const [resizing, setResizing] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);

  const workspace = getWorkspace(workspaceId);
  const { Context } = workspace;

  useEffect(() => {
    if (!resizing) return;

    const onMove = (event: PointerEvent): void => {
      const left = panelRef.current?.getBoundingClientRect().left ?? 0;
      setWidth(event.clientX - left);
    };
    const stop = (): void => setResizing(false);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    document.body.classList.add('is-resizing');
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      document.body.classList.remove('is-resizing');
    };
  }, [resizing, setWidth]);

  // Keyboard resize keeps the handle usable without a pointer.
  const onHandleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const step = event.shiftKey ? 32 : 8;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setWidth(width - step);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setWidth(width + step);
      }
    },
    [setWidth, width],
  );

  return (
    <aside
      ref={panelRef}
      className="context"
      style={{ width }}
      aria-label={`${workspace.title} context`}
    >
      <header className="context__header">
        <h2>{workspace.title}</h2>
        <p>{workspace.summary}</p>
      </header>

      <div className="context__body">
        <Context />
      </div>

      <div
        className="resize-handle"
        role="separator"
        tabIndex={0}
        aria-label="Resize context panel"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={CONTEXT_WIDTH_MIN}
        aria-valuemax={CONTEXT_WIDTH_MAX}
        data-resizing={resizing || undefined}
        onPointerDown={(event) => {
          event.preventDefault();
          setResizing(true);
        }}
        onKeyDown={onHandleKeyDown}
      />
    </aside>
  );
};
