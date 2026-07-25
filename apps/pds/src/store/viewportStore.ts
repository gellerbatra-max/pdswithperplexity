import { create } from 'zustand';
import { BoundsOps, type Vec2 } from '@/geometry';
import { DEFAULT_CAMERA, fitBounds, pan, zoomAt, type Camera } from '@/canvas';
import { documentBounds } from '@/pattern';
import { useDocumentStore } from './documentStore';
import type { LayerId, LayerVisibility } from './types';

const DEFAULT_LAYERS: LayerVisibility = {
  net: true,
  seam: true,
  nodes: true,
  labels: true,
  notches: true,
  grain: true,
  internals: true,
  annotation: true,
};

export interface ViewportState {
  camera: Camera;
  showGrid: boolean;
  layers: LayerVisibility;
  /** Cursor position in document space, for the ruler and status-bar readouts. */
  cursor: Vec2 | null;

  setCamera: (camera: Camera) => void;
  panBy: (deltaScreen: Vec2) => void;
  zoomAtPoint: (anchorScreen: Vec2, factor: number) => void;
  zoomBy: (factor: number) => void;
  fitToContent: () => void;
  resetCamera: () => void;
  toggleGrid: () => void;
  toggleLayer: (id: LayerId) => void;
  setCursor: (cursor: Vec2 | null) => void;
}

export const useViewportStore = create<ViewportState>((set) => ({
  camera: DEFAULT_CAMERA,
  showGrid: true,
  layers: DEFAULT_LAYERS,
  cursor: null,

  setCamera: (camera) => set({ camera }),
  panBy: (deltaScreen) => set((state) => ({ camera: pan(state.camera, deltaScreen) })),
  zoomAtPoint: (anchorScreen, factor) =>
    set((state) => ({ camera: zoomAt(state.camera, anchorScreen, factor) })),

  /** Zoom about the centre of the current viewport — what the zoom buttons use. */
  zoomBy: (factor) =>
    set((state) => {
      const stage = document.querySelector<HTMLCanvasElement>('.stage');
      const rect = stage?.getBoundingClientRect();
      const anchor = { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 };
      return { camera: zoomAt(state.camera, anchor, factor) };
    }),

  /** Frame the whole document in the stage. Shared by the status bar, zoom cluster and commands. */
  fitToContent: () => {
    const stage = document.querySelector<HTMLCanvasElement>('.stage');
    const rect = stage?.getBoundingClientRect();
    if (!rect) return;
    const bounds = documentBounds(useDocumentStore.getState().document);
    set({
      camera: BoundsOps.isEmpty(bounds)
        ? DEFAULT_CAMERA
        : fitBounds(bounds, rect.width, rect.height),
    });
  },

  resetCamera: () => set({ camera: DEFAULT_CAMERA }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  toggleLayer: (id) =>
    set((state) => ({ layers: { ...state.layers, [id]: !state.layers[id] } })),
  setCursor: (cursor) => set({ cursor }),
}));
