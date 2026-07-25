import { create } from 'zustand';
import type { Vec2 } from '@/geometry';
import { DEFAULT_CAMERA, pan, zoomAt, type Camera } from '@/canvas';

export interface ViewportState {
  camera: Camera;
  showGrid: boolean;
  /** Cursor position in document space, for the status bar readout. */
  cursor: Vec2 | null;

  setCamera: (camera: Camera) => void;
  panBy: (deltaScreen: Vec2) => void;
  zoomAtPoint: (anchorScreen: Vec2, factor: number) => void;
  resetCamera: () => void;
  toggleGrid: () => void;
  setCursor: (cursor: Vec2 | null) => void;
}

export const useViewportStore = create<ViewportState>((set) => ({
  camera: DEFAULT_CAMERA,
  showGrid: true,
  cursor: null,

  setCamera: (camera) => set({ camera }),
  panBy: (deltaScreen) => set((state) => ({ camera: pan(state.camera, deltaScreen) })),
  zoomAtPoint: (anchorScreen, factor) =>
    set((state) => ({ camera: zoomAt(state.camera, anchorScreen, factor) })),
  resetCamera: () => set({ camera: DEFAULT_CAMERA }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  setCursor: (cursor) => set({ cursor }),
}));
