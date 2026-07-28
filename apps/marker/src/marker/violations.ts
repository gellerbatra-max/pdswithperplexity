/**
 * Which pieces are sitting somewhere they should not be.
 *
 * Dragging cannot produce an overlap — DragTool pushes pieces apart — but
 * placing from the tray drops at the origin onto whatever is already there,
 * and a rotation can put a piece through its neighbour. Those need to be
 * visible rather than silently wrong.
 *
 * Pure: no React, no Konva, no DOM.
 */

import { boundsOf, bufferFor, expand, overlaps } from '@/canvas/collision/aabb';
import { convexPartsOf } from '@/canvas/collision/convexParts';
import { orientPoints } from '@/canvas/collision/orient';
import { satCollision } from '@/canvas/collision/sat';
import { orientedGeometry, translate } from './pieceGeometry';
import type { MarkerDocument, PlacedPiece, Point } from './schema';

const rectangle = (x: number, y: number, width: number, height: number): Point[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

interface Body {
  readonly id: string;
  readonly parts: Point[][];
  readonly bounds: ReturnType<typeof boundsOf>;
  readonly buffer: number;
}

const bodyOf = (document: MarkerDocument, piece: PlacedPiece): Body => ({
  id: piece.id,
  parts: convexPartsOf(piece.geometry).map((part) =>
    translate(orientPoints(part, piece), piece.position),
  ),
  bounds: boundsOf(translate(orientedGeometry(piece), piece.position)),
  buffer: bufferFor(piece.bufferOverride, document.cutterBuffer),
});

const touches = (a: Body, b: Body): boolean => {
  // The larger of the two buffers governs: a piece with a wider keep-out does
  // not lose it by sitting next to one with none.
  const gap = Math.max(a.buffer, b.buffer);
  if (!overlaps(expand(a.bounds, gap), b.bounds)) return false;
  for (const partA of a.parts) {
    for (const partB of b.parts) {
      if (satCollision(partA, partB, gap).collides) return true;
    }
  }
  return false;
};

/**
 * Ids of every piece overlapping another piece, or a defect zone.
 *
 * Both sides of an overlap are reported: with one piece dropped across three
 * others, highlighting only the newcomer hides how much is wrong.
 *
 * The fabric edge is deliberately not a violation — a piece can only get
 * outside it by being placed there deliberately, and flagging the boundary
 * would light up during ordinary work at the selvedge.
 */
export const findViolations = (document: MarkerDocument): Set<string> => {
  const violating = new Set<string>();
  const bodies = document.pieces.map((piece) => bodyOf(document, piece));

  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      const a = bodies[i];
      const b = bodies[j];
      if (!a || !b) continue;
      if (!touches(a, b)) continue;
      violating.add(a.id);
      violating.add(b.id);
    }
  }

  const zones = document.defectZones.map((zone) => ({
    parts: [rectangle(zone.x, zone.y, zone.width, zone.height)],
    bounds: boundsOf(rectangle(zone.x, zone.y, zone.width, zone.height)),
  }));

  for (const body of bodies) {
    for (const zone of zones) {
      if (!overlaps(body.bounds, zone.bounds)) continue;
      const hit = body.parts.some((part) =>
        zone.parts.some((zonePart) => satCollision(part, zonePart).collides),
      );
      if (hit) violating.add(body.id);
    }
  }

  return violating;
};
