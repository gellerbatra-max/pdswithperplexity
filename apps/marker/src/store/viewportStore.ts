import { create } from 'zustand';

/**
 * The marker camera.
 *
 * `zoom` is the cm→px scale used by the canvas transform, so it is the `scale`
 * term in `konvaX = x * scale + panX`. `panX`/`panY` are pixel offsets.
 *
 * The stage size lives here too: `zoomToFit` takes only the marker's
 * dimensions, so it needs somewhere to read the viewport it is fitting into.
 * MarkerCanvas reports it on mount and on resize.
 */

/** px per cm. 2 shows a 150 cm fabric in roughly a laptop-width stage. */
export const DEFAULT_ZOOM = 2;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 40;

/** Leaves a margin around a fitted marker so pieces at the edge stay legible. */
const FIT_MARGIN = 0.9;

const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export interface ViewportState {
  zoom: number;
  panX: number;
  panY: number;
  stageWidth: number;
  stageHeight: number;

  setZoom: (zoom: number) => void;
  setPan: (panX: number, panY: number) => void;
  setStageSize: (width: number, height: number) => void;
  zoomToFit: (markerLength: number, fabricWidth: number) => void;
}

export const useViewportStore = create<ViewportState>((set) => ({
  zoom: DEFAULT_ZOOM,
  panX: 0,
  panY: 0,
  stageWidth: 0,
  stageHeight: 0,

  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  setPan: (panX, panY) => set({ panX, panY }),
  setStageSize: (stageWidth, stageHeight) => set({ stageWidth, stageHeight }),

  /**
   * Frame the whole marker. A no-op before the stage has been measured, or on
   * an empty marker — there is nothing to fit, and dividing by zero would put
   * the camera somewhere unrecoverable.
   */
  zoomToFit: (markerLength, fabricWidth) =>
    set((state) => {
      const { stageWidth, stageHeight } = state;
      if (stageWidth <= 0 || stageHeight <= 0 || markerLength <= 0 || fabricWidth <= 0) return {};
      const zoom = clampZoom(
        Math.min(stageWidth / markerLength, stageHeight / fabricWidth) * FIT_MARGIN,
      );
      return {
        zoom,
        panX: (stageWidth - markerLength * zoom) / 2,
        panY: (stageHeight - fabricWidth * zoom) / 2,
      };
    }),
}));
