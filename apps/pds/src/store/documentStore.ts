import { create } from 'zustand';
import type { PatternDocument } from '@/pattern';
import { createSeedDocument } from './seedDocument';
import type { SaveState } from './types';

const now = (): string => new Date().toISOString();

export interface DocumentState {
  document: PatternDocument;
  saveState: SaveState;

  markSaved: () => void;
  /**
   * Full replace for loading or creating a document (new/open/hydrate). Marks
   * `unsaved` like any other change — even the hydrate-from-autosave case,
   * where it's already in IndexedDB — so there is exactly one rule for what
   * `saved` means: "the autosave subscriber has written this exact document".
   * No caller gets to assert that for free. Resets history yourself: this
   * store doesn't know about `historyStore`, on purpose.
   */
  setDocument: (document: PatternDocument) => void;
  /**
   * Full replace with a command's result. Only `historyStore.execute/undo/redo`
   * should call this — every other mutation should go through a
   * `DocumentCommand` (see `documentCommands.ts`) so it lands on the undo
   * stack. Marks the result `unsaved` so the autosave subscriber picks it up.
   */
  applyDocument: (document: PatternDocument) => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  document: createSeedDocument(),
  saveState: 'saved',

  markSaved: () => set({ saveState: 'saved' }),

  setDocument: (document) => set({ document, saveState: 'unsaved' }),

  applyDocument: (document) =>
    set({ document: { ...document, updatedAt: now() }, saveState: 'unsaved' }),
}));
