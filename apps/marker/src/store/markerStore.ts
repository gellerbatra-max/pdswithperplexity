import { create } from 'zustand';
import type {
  DefectZone,
  MarkerDocument,
  PlacedPiece,
  Point,
  SpliceLine,
  TrayPiece,
} from '@/marker/schema';

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

/** The document-level values the Options tab edits. */
export type MarkerSettings = Pick<
  MarkerDocument,
  'fabricWidth' | 'endAllowance' | 'cutterBuffer' | 'rotationRule'
>;

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
  updateSettings: (patch: Partial<MarkerSettings>) => void;
  /** Instantiate one tray piece onto the marker and count it as placed. */
  placeFromTray: (trayPieceId: string, position: Point) => void;
  /** Add imported pieces to the tray, leaving placed pieces untouched. */
  addTrayPieces: (pieces: readonly TrayPiece[]) => void;
  /** Apply an auto-nest result as one undoable step. */
  applyPlacements: (
    placements: readonly {
      pieceDefId: string;
      position: Point;
      rotation: number;
      flipped: boolean;
    }[],
  ) => void;
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
  const next = change(current);
  // A change that declined to do anything returns the document it was given.
  // Snapshotting that would put a no-op step in the undo stack.
  if (next === current) return {};
  return {
    document: { ...next, updatedAt: now() },
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

  setFabricWidth: (fabricWidth) =>
    set((state) => edit(state, (document) => ({ ...document, fabricWidth }))),

  updateSettings: (patch) => set((state) => edit(state, (document) => ({ ...document, ...patch }))),

  // Placement counts live on the tray piece, so appending a piece and bumping
  // its counter has to be one edit — otherwise undo could separate them.
  placeFromTray: (trayPieceId, position) =>
    set((state) =>
      edit(state, (document) => {
        const tray = document.trayPieces.find((candidate) => candidate.id === trayPieceId);
        if (!tray || tray.placed >= tray.quantity) return document;

        const piece: PlacedPiece = {
          id: crypto.randomUUID(),
          pieceDefId: tray.id,
          name: tray.name,
          size: tray.size,
          bundle: tray.bundle,
          fabricCode: tray.fabricCode,
          geometry: tray.geometry,
          position,
          rotation: 0,
          flipped: false,
          placed: true,
          blocked: false,
        };

        return {
          ...document,
          pieces: [...document.pieces, piece],
          trayPieces: document.trayPieces.map((candidate) =>
            candidate.id === trayPieceId
              ? { ...candidate, placed: candidate.placed + 1 }
              : candidate,
          ),
        };
      }),
    ),

  addTrayPieces: (pieces) =>
    set((state) =>
      edit(state, (document) => {
        if (pieces.length === 0) return document;
        // Ids come from the file; a re-import of the same file must not create
        // a second copy of every piece.
        const known = new Set(document.trayPieces.map((piece) => piece.id));
        const fresh = pieces.filter((piece) => !known.has(piece.id));
        if (fresh.length === 0) return document;
        return { ...document, trayPieces: [...document.trayPieces, ...fresh] };
      }),
    ),

  // One edit for the whole run: a nest that placed forty pieces must undo in
  // one press, not forty.
  applyPlacements: (placements) =>
    set((state) =>
      edit(state, (document) => {
        if (placements.length === 0) return document;

        const added: PlacedPiece[] = [];
        const counts = new Map<string, number>();

        for (const placement of placements) {
          const tray = document.trayPieces.find((piece) => piece.id === placement.pieceDefId);
          if (!tray) continue;
          added.push({
            id: crypto.randomUUID(),
            pieceDefId: tray.id,
            name: tray.name,
            size: tray.size,
            bundle: tray.bundle,
            fabricCode: tray.fabricCode,
            geometry: tray.geometry,
            position: placement.position,
            rotation: placement.rotation,
            flipped: placement.flipped,
            placed: true,
            blocked: false,
          });
          counts.set(tray.id, (counts.get(tray.id) ?? 0) + 1);
        }

        if (added.length === 0) return document;

        return {
          ...document,
          pieces: [...document.pieces, ...added],
          trayPieces: document.trayPieces.map((piece) => {
            const extra = counts.get(piece.id);
            return extra === undefined ? piece : { ...piece, placed: piece.placed + extra };
          }),
        };
      }),
    ),

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
