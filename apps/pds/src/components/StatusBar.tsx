import {
  describeSelection,
  useDocumentStore,
  useSelectionStore,
  useUiStore,
  useViewportStore,
} from '@/store';
import { Icon } from './Icon';

/** Slim 32px footer: document readouts on the left, view controls on the right. */
export const StatusBar = () => {
  const doc = useDocumentStore((s) => s.document);
  const unit = doc.unit;
  const pieces = doc.pieces;
  const selection = useSelectionStore((s) => s.selection);

  const camera = useViewportStore((s) => s.camera);
  const cursor = useViewportStore((s) => s.cursor);
  const showGrid = useViewportStore((s) => s.showGrid);
  const toggleGrid = useViewportStore((s) => s.toggleGrid);
  const fitToContent = useViewportStore((s) => s.fitToContent);

  const activeTool = useUiStore((s) => s.activeTool);
  const commandNotice = useUiStore((s) => s.commandNotice);
  const contextPanelOpen = useUiStore((s) => s.contextPanelOpen);
  const toggleContextPanel = useUiStore((s) => s.toggleContextPanel);
  const inspectorOpen = useUiStore((s) => s.inspectorOpen);
  const toggleInspector = useUiStore((s) => s.toggleInspector);

  const format = (value: number): string =>
    `${value.toFixed(unit === 'in' ? 2 : 1)}`;

  return (
    <footer className="statusbar">
      <span className="statusbar__item statusbar__item--tool">{activeTool}</span>
      <span className="statusbar__item">{pieces.length} pieces</span>
      <span className="statusbar__item statusbar__item--selection" title="Current selection">
        {describeSelection(doc, selection)}
      </span>

      {commandNotice ? (
        <span className="statusbar__notice" role="status">
          {commandNotice}
        </span>
      ) : null}

      <span className="statusbar__spacer" />

      <span className="statusbar__item statusbar__item--coords">
        {cursor ? `x ${format(cursor.x)}  y ${format(cursor.y)}` : 'x —  y —'}
      </span>
      <span className="statusbar__item">{unit}</span>

      <span className="statusbar__divider" role="presentation" />

      <button
        type="button"
        className="statusbar__button"
        data-active={showGrid || undefined}
        aria-label="Toggle grid"
        title="Toggle grid"
        onClick={toggleGrid}
      >
        <Icon name="grid" size={14} />
      </button>
      <button
        type="button"
        className="statusbar__button"
        data-active={contextPanelOpen || undefined}
        aria-label="Toggle context panel"
        title="Toggle context panel"
        onClick={toggleContextPanel}
      >
        <Icon name="panel-left" size={14} />
      </button>
      <button
        type="button"
        className="statusbar__button"
        data-active={inspectorOpen || undefined}
        aria-label="Toggle inspector"
        title="Toggle inspector"
        onClick={toggleInspector}
      >
        <Icon name="panel-right" size={14} />
      </button>

      <span className="statusbar__divider" role="presentation" />

      <button type="button" className="statusbar__button statusbar__button--text" onClick={fitToContent}>
        Fit
      </button>
      <span className="statusbar__item statusbar__item--zoom">
        {Math.round(camera.zoom * 100)}%
      </span>
    </footer>
  );
};
