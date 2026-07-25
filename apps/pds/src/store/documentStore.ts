import { create } from 'zustand';
import type { PatternDocument, Piece, PieceId, SaveState } from './types';

const now = (): string => new Date().toISOString();

/** A single demo piece so the canvas has something to draw on first run. */
const starterPiece: Piece = {
  id: 'piece-front-bodice',
  name: 'Front Bodice (block)',
  closed: true,
  seamAllowance: 10,
  nodes: [
    { id: 'n1', kind: 'corner', position: { x: 0, y: 0 } },
    { id: 'n2', kind: 'corner', position: { x: 180, y: 0 } },
    { id: 'n3', kind: 'curve', position: { x: 205, y: 120 } },
    { id: 'n4', kind: 'corner', position: { x: 195, y: 320 } },
    { id: 'n5', kind: 'corner', position: { x: 10, y: 320 } },
    { id: 'n6', kind: 'curve', position: { x: -15, y: 140 } },
  ],
};

const emptyDocument = (): PatternDocument => ({
  id: 'doc-untitled',
  name: 'Untitled pattern',
  unit: 'mm',
  pieces: [starterPiece],
  updatedAt: now(),
});

export interface DocumentState {
  document: PatternDocument;
  selectedPieceIds: ReadonlySet<PieceId>;
  saveState: SaveState;

  markSaved: () => void;
  setDocument: (document: PatternDocument) => void;
  renameDocument: (name: string) => void;
  addPiece: (piece: Piece) => void;
  updatePiece: (id: PieceId, patch: Partial<Omit<Piece, 'id'>>) => void;
  removePiece: (id: PieceId) => void;

  selectPiece: (id: PieceId, additive?: boolean) => void;
  clearSelection: () => void;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  document: emptyDocument(),
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

  clearSelection: () => set({ selectedPieceIds: new Set<PieceId>() }),
}));
