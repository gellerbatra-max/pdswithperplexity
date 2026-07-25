import { create } from 'zustand';
import type { PatternDocument, PatternPiece, PieceId } from '@/pattern';
import { createSeedDocument } from './seedDocument';
import type { SaveState } from './types';

const now = (): string => new Date().toISOString();

export interface DocumentState {
  document: PatternDocument;
  saveState: SaveState;

  markSaved: () => void;
  setDocument: (document: PatternDocument) => void;
  renameDocument: (name: string) => void;
  addPiece: (piece: PatternPiece) => void;
  updatePiece: (id: PieceId, patch: Partial<Omit<PatternPiece, 'id'>>) => void;
  removePiece: (id: PieceId) => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  document: createSeedDocument(),
  saveState: 'saved',

  markSaved: () => set({ saveState: 'saved' }),

  setDocument: (document) => set({ document, saveState: 'saved' }),

  renameDocument: (name) =>
    set((state) => ({
      document: { ...state.document, name, updatedAt: now() },
      saveState: 'unsaved',
    })),

  addPiece: (piece) =>
    set((state) => ({
      document: {
        ...state.document,
        pieces: [...state.document.pieces, piece],
        updatedAt: now(),
      },
      saveState: 'unsaved',
    })),

  updatePiece: (id, patch) =>
    set((state) => ({
      document: {
        ...state.document,
        pieces: state.document.pieces.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        updatedAt: now(),
      },
      saveState: 'unsaved',
    })),

  // Selection is pruned by the selection store's document subscription.
  removePiece: (id) =>
    set((state) => ({
      document: {
        ...state.document,
        pieces: state.document.pieces.filter((p) => p.id !== id),
        updatedAt: now(),
      },
      saveState: 'unsaved' as const,
    })),

}));
