import Konva from 'konva';
import type { MarkerDocument } from '@/marker/schema';
import { markerLength } from '@/marker/selectors';
import { FabricLayer } from './layers/FabricLayer';
import type { MarkerTransform, ViewportSnapshot } from './types';

/**
 * Owns the Konva stage, its four layers, and the cm→px transform.
 *
 * Imperative by design: React renders the shell and calls `update` when the
 * stores change. This class never reads a store, so the same canvas can be
 * driven by a test, a worker result, or a replayed document.
 */

/**
 * Fabric drawn when the marker is empty. Without it there is no surface to
 * drag the first piece onto, since marker length is derived from placed pieces.
 */
export const MIN_FABRIC_LENGTH = 500;

export interface MarkerCanvasCallbacks {
  /** Pixel deltas from a middle-mouse drag; the store converts them to pan. */
  onPanBy: (dxPx: number, dyPx: number) => void;
  onStageResize: (width: number, height: number) => void;
}

export class MarkerCanvas {
  private readonly stage: Konva.Stage;
  private readonly fabricLayer = new FabricLayer();

  // Layer order is the render order: fabric behind, UI in front. Only the
  // piece layer listens; Konva 9.3 deprecates FastLayer in favour of exactly
  // this, a Layer with hit detection switched off.
  private readonly pieceLayer = new Konva.Layer();
  private readonly overlayLayer = new Konva.Layer({ listening: false });
  private readonly uiLayer = new Konva.Layer({ listening: false });

  private readonly resizeObserver: ResizeObserver;
  private readonly detachPointerHandlers: () => void;

  constructor(container: HTMLDivElement, callbacks: MarkerCanvasCallbacks) {
    this.stage = new Konva.Stage({
      container,
      width: container.clientWidth,
      height: container.clientHeight,
    });

    this.stage.add(this.fabricLayer.layer);
    // TODO(step-5): PieceLayer renders placed pieces onto this layer.
    this.stage.add(this.pieceLayer);
    // TODO(step-7): OverlayLayer draws defect zones, splice lines, violations.
    this.stage.add(this.overlayLayer);
    // TODO(step-6): UILayer draws rulers, selection handles, cursor readout.
    this.stage.add(this.uiLayer);

    this.resizeObserver = new ResizeObserver((entries) => {
      const [entry] = entries;
      if (!entry) return;
      const { width, height } = entry.contentRect;
      this.stage.size({ width, height });
      callbacks.onStageResize(width, height);
    });
    this.resizeObserver.observe(container);
    callbacks.onStageResize(container.clientWidth, container.clientHeight);

    this.detachPointerHandlers = attachMiddleMousePan(container, callbacks.onPanBy);
  }

  /** Called by React whenever the document or the camera changes. */
  update(document: MarkerDocument | null, viewport: ViewportSnapshot): void {
    if (!document) {
      this.fabricLayer.clear();
      return;
    }
    this.fabricLayer.update({
      fabricWidth: document.fabricWidth,
      fabricLength: Math.max(markerLength(document), MIN_FABRIC_LENGTH),
      transform: createTransform(document.fabricWidth, viewport),
    });
  }

  destroy(): void {
    this.resizeObserver.disconnect();
    this.detachPointerHandlers();
    this.fabricLayer.destroy();
    this.stage.destroy();
  }
}

/**
 * Marker space is bottom-left origin in cm; Konva is top-left origin in px.
 * Flipping Y here is what lets every other module think only in centimetres.
 */
const createTransform = (fabricWidth: number, viewport: ViewportSnapshot): MarkerTransform => {
  const { zoom, panX, panY } = viewport;
  return {
    scale: zoom,
    x: (cm) => cm * zoom + panX,
    y: (cm) => (fabricWidth - cm) * zoom + panY,
  };
};

/**
 * Middle-drag panning.
 *
 * Pointer capture keeps the drag alive when the cursor leaves the stage, and
 * the mousedown/auxclick guards suppress the browser's middle-click autoscroll,
 * which would otherwise hijack the gesture on Windows and Linux.
 */
const attachMiddleMousePan = (
  container: HTMLDivElement,
  onPanBy: (dxPx: number, dyPx: number) => void,
): (() => void) => {
  const MIDDLE_BUTTON = 1;
  let panning = false;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== MIDDLE_BUTTON) return;
    event.preventDefault();
    panning = true;
    lastX = event.clientX;
    lastY = event.clientY;
    container.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!panning) return;
    onPanBy(event.clientX - lastX, event.clientY - lastY);
    lastX = event.clientX;
    lastY = event.clientY;
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (!panning) return;
    panning = false;
    if (container.hasPointerCapture(event.pointerId)) {
      container.releasePointerCapture(event.pointerId);
    }
  };

  const suppressMiddleClick = (event: MouseEvent): void => {
    if (event.button === MIDDLE_BUTTON) event.preventDefault();
  };

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerUp);
  container.addEventListener('mousedown', suppressMiddleClick);
  container.addEventListener('auxclick', suppressMiddleClick);

  return () => {
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointercancel', onPointerUp);
    container.removeEventListener('mousedown', suppressMiddleClick);
    container.removeEventListener('auxclick', suppressMiddleClick);
  };
};
