import { BoundsOps } from '@/geometry';
import {
  clonePiece,
  pieceBounds,
  type PatternDocument,
  type PatternPiece,
  type PieceId,
  type PieceMeta,
} from '@/pattern';
import { useDocumentStore } from './documentStore';
import { useHistoryStore } from './historyStore';

/**
 * Document-editing entry points. Each one reads the live document, builds a
 * `DocumentCommand` that can reverse the exact change it's about to make, and
 * executes it through `historyStore` — this is the one path a mutation should
 * take. UI code and future editing tools call these instead of touching
 * `documentStore` directly.
 *
 * Every factory fills `label` (imperative, subject-free) and `detail` (the
 * subject, plus before → after where there is one) the same way, so a history
 * list can render them uniformly. See `DocumentCommand`.
 */

/** Optional metadata overrides, for callers that know a better label than the default. */
interface CommandMeta {
  readonly label?: string;
  readonly detail?: string;
  readonly coalesceKey?: string;
}

const withPieces = (
  document: PatternDocument,
  pieces: readonly PatternPiece[],
): PatternDocument => ({ ...document, pieces });

/** Reads a piece from the live document, or throws — a command built against a
 * missing piece is a bug in the caller, not a user error. */
const requirePiece = (id: PieceId, action: string): PatternPiece => {
  const piece = useDocumentStore.getState().document.pieces.find((p) => p.id === id);
  if (!piece) throw new Error(`${action}: no piece with id "${id}"`);
  return piece;
};

/**
 * Replaces one piece by id, always with a whole new object.
 *
 * `pattern/resolve.ts` and `pattern/nest.ts` cache flattened outlines and
 * graded sizes in a WeakMap keyed on the piece *object*. Mutating a piece in
 * place would leave both caches serving stale geometry with no error, so every
 * piece edit below goes through here rather than touching a piece directly.
 */
const replacePiece = (
  document: PatternDocument,
  id: PieceId,
  next: PatternPiece,
): PatternDocument =>
  withPieces(
    document,
    document.pieces.map((p) => (p.id === id ? next : p)),
  );

/**
 * Applies `change` to whichever piece carries `id` in the document being
 * operated on — not to the piece captured when the command was built. Redo has
 * to see the document as it stands, which may have moved on since.
 */
const editPiece = (
  document: PatternDocument,
  id: PieceId,
  change: (piece: PatternPiece) => PatternPiece,
): PatternDocument => {
  const piece = document.pieces.find((p) => p.id === id);
  return piece ? replacePiece(document, id, change(piece)) : document;
};

/* --- Document --------------------------------------------------------------- */

export const renameDocument = (name: string): void => {
  const previousName = useDocumentStore.getState().document.name;
  if (previousName === name) return;

  useHistoryStore.getState().execute({
    label: 'Rename document',
    detail: `${previousName} → ${name}`,
    // Typing a name fires this on every keystroke; coalescing folds a whole
    // typing burst into one undo step instead of one per character.
    coalesceKey: 'rename-document',
    do: (document) => ({ ...document, name }),
    undo: (document) => ({ ...document, name: previousName }),
  });
};

/* --- Pieces ----------------------------------------------------------------- */

export const addPiece = (piece: PatternPiece): void => {
  useHistoryStore.getState().execute({
    label: 'Add piece',
    detail: piece.name,
    do: (document) => withPieces(document, [...document.pieces, piece]),
    undo: (document) => withPieces(document, document.pieces.filter((p) => p.id !== piece.id)),
  });
};

export const removePiece = (id: PieceId): void => {
  const piece = requirePiece(id, 'removePiece');
  const index = useDocumentStore.getState().document.pieces.indexOf(piece);

  useHistoryStore.getState().execute({
    label: 'Remove piece',
    detail: piece.name,
    do: (document) => withPieces(document, document.pieces.filter((p) => p.id !== id)),
    // Restores at the original index, so undo puts the piece back where it was
    // in the tree rather than on the end.
    undo: (document) => {
      const pieces = document.pieces.slice();
      pieces.splice(Math.min(index, pieces.length), 0, piece);
      return withPieces(document, pieces);
    },
  });
};

export const renamePiece = (id: PieceId, name: string): void => {
  const before = requirePiece(id, 'renamePiece');
  if (before.name === name) return;

  useHistoryStore.getState().execute({
    label: 'Rename piece',
    detail: `${before.name} → ${name}`,
    // Keyed per piece, so renaming two pieces in quick succession stays two
    // undo steps rather than collapsing into one.
    coalesceKey: `rename-piece:${id}`,
    do: (document) => editPiece(document, id, (piece) => ({ ...piece, name })),
    undo: (document) => replacePiece(document, id, before),
  });
};

/**
 * Patches top-level piece fields.
 *
 * `meta` is excluded from the patch type: spreading it wholesale is how a
 * caller silently drops sibling production fields. Use `updatePieceMeta`.
 */
export const updatePiece = (
  id: PieceId,
  patch: Partial<Omit<PatternPiece, 'id' | 'meta'>>,
  meta: CommandMeta = {},
): void => {
  const before = requirePiece(id, 'updatePiece');

  useHistoryStore.getState().execute({
    label: meta.label ?? 'Update piece',
    detail: meta.detail ?? before.name,
    ...(meta.coalesceKey !== undefined ? { coalesceKey: meta.coalesceKey } : {}),
    do: (document) => editPiece(document, id, (piece) => ({ ...piece, ...patch })),
    undo: (document) => replacePiece(document, id, before),
  });
};

/**
 * Patches production data. Rebuilds `meta` as a new object over the piece's
 * current one, so a caller can pass a single field without having to spread the
 * rest correctly — the mistake this exists to prevent.
 */
export const updatePieceMeta = (
  id: PieceId,
  patch: Partial<PieceMeta>,
  meta: CommandMeta = {},
): void => {
  const before = requirePiece(id, 'updatePieceMeta');

  useHistoryStore.getState().execute({
    label: meta.label ?? 'Update piece data',
    detail: meta.detail ?? before.name,
    ...(meta.coalesceKey !== undefined ? { coalesceKey: meta.coalesceKey } : {}),
    do: (document) =>
      editPiece(document, id, (piece) => ({ ...piece, meta: { ...piece.meta, ...patch } })),
    undo: (document) => replacePiece(document, id, before),
  });
};

/** Gap left between a piece and its copy, in millimetres. */
const DUPLICATE_GAP_MM = 40;

/**
 * Places a structural copy beside the original and returns the copy's id.
 *
 * The offset is placement, not shaping — every point moves by the same delta,
 * so the copy stays congruent with its source. It exists because there is no
 * move tool yet: a copy laid exactly on top of its original would be both
 * invisible and unreachable.
 */
export const duplicatePiece = (id: PieceId): PieceId => {
  const source = requirePiece(id, 'duplicatePiece');
  const bounds = pieceBounds(source);
  const width = BoundsOps.isEmpty(bounds) ? 0 : bounds.maxX - bounds.minX;

  const copy: PatternPiece = {
    ...clonePiece(source, { x: width + DUPLICATE_GAP_MM, y: 0 }),
    name: `${source.name} copy`,
    meta: { ...source.meta, code: `${source.meta.code}-COPY` },
  };

  useHistoryStore.getState().execute({
    label: 'Duplicate piece',
    detail: `${source.name} → ${copy.name}`,
    // Inserted directly after its source rather than appended, so the copy
    // lands beside the original in the piece tree as well as on the canvas.
    do: (document) => {
      const pieces = document.pieces.slice();
      const index = pieces.findIndex((p) => p.id === id);
      pieces.splice(index < 0 ? pieces.length : index + 1, 0, copy);
      return withPieces(document, pieces);
    },
    undo: (document) => withPieces(document, document.pieces.filter((p) => p.id !== copy.id)),
  });

  return copy.id;
};
