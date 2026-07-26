import { create } from 'zustand';

/**
 * Undo/redo placeholder. The shell needs to render the controls and their enabled
 * state; the actual command stack lands with the first mutating tool.
 *
 * TODO(persistence): implement as an inverse-command stack rather than document
 * snapshots — the document holds every piece, so snapshotting per keystroke will
 * not hold up. Every mutation should go through a command object that can undo
 * itself. This blocks all editing tools. See DEVELOPMENT.md.
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
