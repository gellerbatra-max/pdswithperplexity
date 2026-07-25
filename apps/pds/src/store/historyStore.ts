import { create } from 'zustand';

/**
 * Undo/redo placeholder. The shell needs to render the controls and their enabled
 * state; the actual command stack lands with the first mutating tool.
 */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

export const useHistoryStore = create<HistoryState>(() => ({
  canUndo: false,
  canRedo: false,
  undo: () => undefined,
  redo: () => undefined,
}));
