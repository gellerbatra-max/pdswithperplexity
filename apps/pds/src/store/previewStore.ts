import { create } from 'zustand';
import type { PatternPiece } from '@/pattern';

/**
 * The in-flight edit — what a drag looks like before it is committed.
 *
 * Deliberately *not* part of the document. A drag fires pointermove many times
 * a second; routing each one through a command would flood the undo stack,
 * re-trigger autosave, and invalidate the outline and seam-allowance caches on
 * every frame. Instead the tool draws a draft piece here, and commits exactly
 * one command when the pointer comes up.
 *
 * That also makes cancelling free: dropping the preview restores the committed
 * document, because the document was never touched.
 *
 * This is view state, so it lives beside selection and viewport rather than in
 * the document — same reasoning as `selectionStore`.
 */
export interface PreviewState {
  /**
   * A draft replacement for the piece with the same id, or null when no edit is
   * in flight. The canvas substitutes it by id; every other reader — inspector,
   * measurements, piece tree — keeps reading the committed document, so numbers
   * never reflect an edit that has not landed.
   */
  readonly piece: PatternPiece | null;
  setPreview: (piece: PatternPiece | null) => void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  piece: null,
  setPreview: (piece) => set({ piece }),
}));
