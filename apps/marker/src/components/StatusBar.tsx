import { useUiStore } from '@/store/uiStore';

/**
 * 30px message bar.
 *
 * Nothing here expires. A warning about a piece over a defect zone has to
 * still be on screen when the operator looks up from the cutting table, so
 * messages persist until something replaces them.
 */
export const StatusBar = () => {
  const message = useUiStore((state) => state.statusMessage);
  const activeTool = useUiStore((state) => state.activeTool);
  const selection = useUiStore((state) => state.selection);

  return (
    <div className="statusbar" role="status" aria-live="polite">
      <span className="statusbar__level" data-level={message?.level ?? 'idle'} />
      <span className="statusbar__text">{message?.text ?? 'Ready'}</span>

      <span className="statusbar__spacer" />

      <span className="statusbar__item">{activeTool}</span>
      <span className="statusbar__item">
        {selection.length === 0
          ? 'nothing selected'
          : `${selection.length} selected`}
      </span>
    </div>
  );
};
