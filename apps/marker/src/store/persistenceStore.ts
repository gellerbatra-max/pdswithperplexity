import { create } from 'zustand';

/**
 * What the save indicator knows.
 *
 * Separate from markerStore on purpose: save state is not part of the document
 * and must not enter the undo history. Undoing an edit should not also undo the
 * fact that it was written to disk.
 */

export type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

export interface PersistenceState {
  saveState: SaveState;
  /** ISO 8601, or null before the first successful write. */
  lastSavedAt: string | null;
  /** Why the last write failed — surfaced in the status bar, not swallowed. */
  lastError: string | null;

  setSaveState: (state: SaveState) => void;
  markSaved: (at: string) => void;
  markFailed: (message: string) => void;
}

export const usePersistenceStore = create<PersistenceState>((set) => ({
  saveState: 'idle',
  lastSavedAt: null,
  lastError: null,

  setSaveState: (saveState) => set({ saveState }),
  markSaved: (lastSavedAt) => set({ saveState: 'saved', lastSavedAt, lastError: null }),
  markFailed: (lastError) => set({ saveState: 'error', lastError }),
}));
