import { findPiece, findPoint, type PatternDocument, type PieceId, type PointId } from '@/pattern';

/**
 * What can be selected.
 *
 * A discriminated union rather than a bag of ids, so a selection always says
 * what kind of thing it points at and carries exactly the ids needed to resolve
 * it. Adding `segment`, `notch` or `internal-line` later means adding a member
 * here and a case wherever selections are resolved — no existing member changes.
 *
 * Refs are always rooted at a piece, because everything selectable belongs to
 * one; that keeps resolution a two-step lookup and makes pruning on document
 * change straightforward.
 */
export type SelectionRef =
  | { readonly kind: 'piece'; readonly pieceId: PieceId }
  | { readonly kind: 'point'; readonly pieceId: PieceId; readonly pointId: PointId };

export type SelectionKind = SelectionRef['kind'];

export const pieceRef = (pieceId: PieceId): SelectionRef => ({ kind: 'piece', pieceId });

export const pointRef = (pieceId: PieceId, pointId: PointId): SelectionRef => ({
  kind: 'point',
  pieceId,
  pointId,
});

/** Stable string form, for set membership and React keys. */
export const selectionKey = (ref: SelectionRef): string =>
  ref.kind === 'piece' ? `piece:${ref.pieceId}` : `point:${ref.pieceId}:${ref.pointId}`;

export const sameRef = (a: SelectionRef, b: SelectionRef): boolean =>
  selectionKey(a) === selectionKey(b);

/** True when the ref still resolves against the document. */
export const refExists = (document: PatternDocument, ref: SelectionRef): boolean => {
  const piece = findPiece(document, ref.pieceId);
  if (!piece) return false;
  return ref.kind === 'piece' ? true : findPoint(piece, ref.pointId) !== undefined;
};

/** Short human description for the status bar. */
export const describeSelection = (
  document: PatternDocument,
  selection: readonly SelectionRef[],
): string => {
  if (selection.length === 0) return 'No selection';
  if (selection.length > 1) return `${selection.length} selected`;

  const ref = selection[0];
  if (!ref) return 'No selection';

  const piece = findPiece(document, ref.pieceId);
  if (!piece) return 'No selection';
  if (ref.kind === 'piece') return `${piece.name} · ${piece.meta.code}`;

  const point = findPoint(piece, ref.pointId);
  if (!point) return piece.name;
  return `${piece.name} · ${point.label ?? point.role}`;
};
