import { create } from 'zustand';
import type { PatternDocument, PatternPiece, PieceId } from '@/pattern';
import { createSeedDocument } from './seedDocument';
import type { SaveState } from './types';

const now = (): string => new Date().toISOString();

export interface DocumentState {
  document: PatternDocument;
  selectedPieceIds: ReadonlySet<PieceId>;
  saveState: SaveState;

  markSaved: () => void;
  setDocument: (document: PatternDocument) => void;
  renameDocument: (name: string) => void;
  addPiece: (piece: PatternPiece) => void;
  updatePiece: (id: PieceId, patch: Partial<Omit<PatternPiece, 'id'>>) => void;
  removePiece: (id: PieceId) => void;

  selectPiece: (id: PieceId, additive?: boolean) => void;
  setSelection: (ids: readonly PieceId[]) => void;
  clearSelection: () => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  document: createSeedDocument(),
  selectedPieceIds: new Set<PieceId>(),
  saveState: 'saved',

  markSaved: () => set({ saveState: 'saved' }),

  setDocument: (document) =>
    set({ document, selectedPieceIds: new Set<PieceId>(), saveState: 'saved' }),

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

  removePiece: (id) =>
    set((state) => {
      const selected = new Set(state.selectedPieceIds);
      selected.delete(id);
      return {
        document: {
          ...state.document,
          pieces: state.document.pieces.filter((p) => p.id !== id),
          updatedAt: now(),
        },
        selectedPieceIds: selected,
        saveState: 'unsaved' as const,
      };
    }),

  selectPiece: (id, additive = false) =>
    set((state) => {
      if (!additive) return { selectedPieceIds: new Set<PieceId>([id]) };
      const next = new Set(state.selectedPieceIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedPieceIds: next };
    }),

  setSelection: (ids) => set({ selectedPieceIds: new Set(ids) }),

  clearSelection: () => set({ selectedPieceIds: new Set<PieceId>() }),
}));
