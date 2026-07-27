import {
  findPiece,
  findPoint,
  findSegment,
  type PatternDocument,
  type PieceId,
  type PointId,
  type SegmentId,
} from '@/pattern';

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
  | { readonly kind: 'point'; readonly pieceId: PieceId; readonly pointId: PointId }
  | { readonly kind: 'segment'; readonly pieceId: PieceId; readonly segmentId: SegmentId };

export type SelectionKind = SelectionRef['kind'];

export const pieceRef = (pieceId: PieceId): SelectionRef => ({ kind: 'piece', pieceId });

export const pointRef = (pieceId: PieceId, pointId: PointId): SelectionRef => ({
  kind: 'point',
  pieceId,
  pointId,
});

export const segmentRef = (pieceId: PieceId, segmentId: SegmentId): SelectionRef => ({
  kind: 'segment',
  pieceId,
  segmentId,
});

/** Stable string form, for set membership and React keys. */
export const selectionKey = (ref: SelectionRef): string => {
  switch (ref.kind) {
    case 'piece':
      return `piece:${ref.pieceId}`;
    case 'point':
      return `point:${ref.pieceId}:${ref.pointId}`;
    case 'segment':
      return `segment:${ref.pieceId}:${ref.segmentId}`;
  }
};

export const sameRef = (a: SelectionRef, b: SelectionRef): boolean =>
  selectionKey(a) === selectionKey(b);

/** True when the ref still resolves against the document. */
export const refExists = (document: PatternDocument, ref: SelectionRef): boolean => {
  const piece = findPiece(document, ref.pieceId);
  if (!piece) return false;
  switch (ref.kind) {
    case 'piece':
      return true;
    case 'point':
      return findPoint(piece, ref.pointId) !== undefined;
    case 'segment':
      return findSegment(piece, ref.segmentId) !== undefined;
  }
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

  switch (ref.kind) {
    case 'piece':
      return `${piece.name} · ${piece.meta.code}`;
    case 'point': {
      const point = findPoint(piece, ref.pointId);
      return point ? `${piece.name} · ${point.label ?? point.role}` : piece.name;
    }
    case 'segment': {
      const segment = findSegment(piece, ref.segmentId);
      return segment ? `${piece.name} · ${segment.label ?? 'edge'}` : piece.name;
    }
  }
};
