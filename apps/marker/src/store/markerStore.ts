import { create } from 'zustand';
import type { DefectZone, MarkerDocument, PlacedPiece, SpliceLine } from '@/marker/schema';

/**
 * The open marker document, plus its undo history.
 *
 * History is whole-document snapshots rather than inverse commands. A marker
 * holds a few hundred small polygons, so a snapshot is cheap — unlike the
 * pattern documents in PDS, where the same approach would not hold up.
 */

/** Snapshots retained in each direction. Older ones fall off the back. */
export const HISTORY_LIMIT = 50;

const now = (): string => new Date().toISOString();

export interface MarkerState {
  /** null until a marker is opened — the app can run with nothing loaded. */
  document: MarkerDocument | null;
  past: MarkerDocument[];
  future: MarkerDocument[];

  loadMarker: (document: MarkerDocument) => void;
  updatePiece: (id: string, patch: Partial<Omit<PlacedPiece, 'id'>>) => void;
  addPiece: (piece: PlacedPiece) => void;
  removePiece: (id: string) => void;
  setFabricWidth: (width: number) => void;
  addDefectZone: (zone: DefectZone) => void;
  addSpliceLine: (line: SpliceLine) => void;
  undo: () => void;
  redo: () => void;
}

type HistorySlice = Pick<MarkerState, 'document' | 'past' | 'future'>;

/**
 * Apply a change, snapshot the document it replaced, and drop the redo stack.
 *
 * Returns an empty patch when no marker is open, so every action is a safe
 * no-op before `loadMarker`.
 */
const edit = (
  state: MarkerState,
  change: (document: MarkerDocument) => MarkerDocument,
): Partial<HistorySlice> => {
  const current = state.document;
  if (!current) return {};
  return {
    document: { ...change(current), updatedAt: now() },
    past: [...state.past, current].slice(-HISTORY_LIMIT),
    future: [],
  };
};

export const useMarkerStore = create<MarkerState>((set) => ({
  document: null,
  past: [],
  future: [],

  // Opening a marker starts a new history — the previous document's snapshots
  // would restore something the user is no longer looking at.
  loadMarker: (document) => set({ document, past: [], future: [] }),

  updatePiece: (id, patch) =>
    set((state) =>
      edit(state, (document) => ({
        ...document,
        pieces: document.pieces.map((piece) => (piece.id === id ? { ...piece, ...patch } : piece)),
      })),
    ),

  addPiece: (piece) =>
    set((state) =>
      edit(state, (document) => ({ ...document, pieces: [...document.pieces, piece] })),
    ),

  removePiece: (id) =>
    set((state) =>
      edit(state, (document) => ({
        ...document,
        pieces: document.pieces.filter((piece) => piece.id !== id),
      })),
    ),

  setFabricWidth: (fabricWidth) => set((state) => edit(state, (document) => ({ ...document, fabricWidth }))),

  addDefectZone: (zone) =>
    set((state) =>
      edit(state, (document) => ({ ...document, defectZones: [...document.defectZones, zone] })),
    ),

  addSpliceLine: (line) =>
    set((state) =>
      edit(state, (document) => ({ ...document, spliceLines: [...document.spliceLines, line] })),
    ),

  undo: () =>
    set((state) => {
      const previous = state.past[state.past.length - 1];
      if (!previous || !state.document) return {};
      return {
        document: previous,
        past: state.past.slice(0, -1),
        future: [state.document, ...state.future].slice(0, HISTORY_LIMIT),
      };
    }),

  redo: () =>
    set((state) => {
      const [next, ...rest] = state.future;
      if (!next || !state.document) return {};
      return {
        document: next,
        past: [...state.past, state.document].slice(-HISTORY_LIMIT),
        future: rest,
      };
    }),
}));
