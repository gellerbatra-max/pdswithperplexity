import type { Vec2 } from '@/geometry';
import type { Piece, PieceId } from '@/store/types';

const containsPoint = (piece: Piece, p: Vec2): boolean => {
  const nodes = piece.nodes;
  let inside = false;
  for (let i = 0, j = nodes.length - 1; i < nodes.length; j = i++) {
    const a = nodes[i];
    const b = nodes[j];
    if (!a || !b) continue;
    const intersects =
      a.position.y > p.y !== b.position.y > p.y &&
      p.x <
        ((b.position.x - a.position.x) * (p.y - a.position.y)) /
          (b.position.y - a.position.y) +
          a.position.x;
    if (intersects) inside = !inside;
  }
  return inside;
};

/** Topmost piece under a document-space point, or null. */
export const pickPiece = (pieces: readonly Piece[], point: Vec2): PieceId | null => {
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    const piece = pieces[i];
    if (piece && piece.nodes.length >= 3 && containsPoint(piece, point)) return piece.id;
  }
  return null;
};
