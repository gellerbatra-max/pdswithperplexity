import { create } from 'zustand';
import type { SizeId } from '@/pattern';

/**
 * Grade workspace view state.
 *
 * Kept out of the shell's UI store because it is meaningless in the other four
 * workspaces, and out of the document because none of it is document data —
 * which size you are looking at is a view concern, like the camera.
 */
export interface GradeState {
  /** Size currently in focus. Null means the base size. */
  activeSizeId: SizeId | null;
  /** Whether the nested size stack draws behind the base outline. */
  nestVisible: boolean;
  /** Whether grade-movement arrows draw on graded points. */
  vectorsVisible: boolean;

  setActiveSize: (sizeId: SizeId | null) => void;
  toggleNest: () => void;
  toggleVectors: () => void;
}

export const useGradeStore = create<GradeState>((set) => ({
  activeSizeId: null,
  nestVisible: true,
  vectorsVisible: true,

  setActiveSize: (activeSizeId) => set({ activeSizeId }),
  toggleNest: () => set((state) => ({ nestVisible: !state.nestVisible })),
  toggleVectors: () => set((state) => ({ vectorsVisible: !state.vectorsVisible })),
}));
