import { MAX_ZOOM, MIN_ZOOM } from '@/canvas';
import { Icon } from '@/components/Icon';
import { useViewportStore } from '@/store';

const STEP = 1.25;

/** Zoom cluster in the stage's bottom-right corner. Fully wired to the camera. */
export const ZoomControls = () => {
  const camera = useViewportStore((s) => s.camera);
  const zoomBy = useViewportStore((s) => s.zoomBy);
  const fitToContent = useViewportStore((s) => s.fitToContent);
  const resetCamera = useViewportStore((s) => s.resetCamera);

  return (
    <div className="zoom" role="group" aria-label="Zoom controls">
      <button
        type="button"
        className="zoom__button"
        aria-label="Zoom out"
        title="Zoom out"
        disabled={camera.zoom <= MIN_ZOOM}
        onClick={() => zoomBy(1 / STEP)}
      >
        <Icon name="minus" size={14} />
      </button>

      <button
        type="button"
        className="zoom__level"
        title="Reset to 100%"
        onClick={() => resetCamera()}
      >
        {Math.round(camera.zoom * 100)}%
      </button>

      <button
        type="button"
        className="zoom__button"
        aria-label="Zoom in"
        title="Zoom in"
        disabled={camera.zoom >= MAX_ZOOM}
        onClick={() => zoomBy(STEP)}
      >
        <Icon name="plus" size={14} />
      </button>

      <span className="zoom__divider" role="presentation" />

      <button
        type="button"
        className="zoom__button"
        aria-label="Zoom to fit"
        title="Zoom to fit"
        onClick={fitToContent}
      >
        <Icon name="maximize" size={14} />
      </button>
    </div>
  );
};
