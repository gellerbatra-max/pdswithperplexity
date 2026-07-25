import { fitBounds } from '@/canvas';
import { BoundsOps } from '@/geometry';
import { useDocumentStore, useUiStore, useViewportStore } from '@/store';
import { Icon } from './Icon';

/** Slim 32px footer: document readouts on the left, view controls on the right. */
export const StatusBar = () => {
  const unit = useDocumentStore((s) => s.document.unit);
  const pieces = useDocumentStore((s) => s.document.pieces);
  const selectedCount = useDocumentStore((s) => s.selectedPieceIds.size);

  const camera = useViewportStore((s) => s.camera);
  const cursor = useViewportStore((s) => s.cursor);
  const showGrid = useViewportStore((s) => s.showGrid);
  const toggleGrid = useViewportStore((s) => s.toggleGrid);
  const setCamera = useViewportStore((s) => s.setCamera);
  const resetCamera = useViewportStore((s) => s.resetCamera);

  const activeTool = useUiStore((s) => s.activeTool);
  const contextPanelOpen = useUiStore((s) => s.contextPanelOpen);
  const toggleContextPanel = useUiStore((s) => s.toggleContextPanel);
  const inspectorOpen = useUiStore((s) => s.inspectorOpen);
  const toggleInspector = useUiStore((s) => s.toggleInspector);

  const zoomToFit = (): void => {
    const stage = document.querySelector<HTMLCanvasElement>('.stage');
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const bounds = BoundsOps.fromPoints(pieces.flatMap((p) => p.nodes.map((n) => n.position)));
    if (BoundsOps.isEmpty(bounds)) {
      resetCamera();
      return;
    }
    setCamera(fitBounds(bounds, rect.width, rect.height));
  };

  const format = (value: number): string =>
    `${value.toFixed(unit === 'in' ? 2 : 1)}`;

  return (
    <footer className="statusbar">
      <span className="statusbar__item statusbar__item--tool">{activeTool}</span>
      <span className="statusbar__item">{pieces.length} pieces</span>
      <span className="statusbar__item">{selectedCount} selected</span>

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

      <button type="button" className="statusbar__button statusbar__button--text" onClick={zoomToFit}>
        Fit
      </button>
      <span className="statusbar__item statusbar__item--zoom">
        {Math.round(camera.zoom * 100)}%
      </span>
    </footer>
  );
};
