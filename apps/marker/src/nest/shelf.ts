/**
 * Shelf nesting: the baseline engine.
 *
 * A shelf is a band running **across** the fabric. Pieces are stacked up it
 * from one selvedge toward the other until the next one will not fit inside
 * the fabric width; then a new shelf opens past the deepest piece in the last
 * one and the marker grows along its length.
 *
 * That orientation is forced by the fabric, not chosen: width (+Y) is fixed by
 * the roll and length (+X) is effectively unbounded, so the bounded axis is
 * the one a shelf has to fill.
 *
 * This is deliberately the simplest thing that produces a legal marker. It
 * will not beat bottom-left fill on utilisation and is not meant to: it is
 * fast, obvious and completely deterministic, which is what makes it the
 * baseline every later engine is measured against. `heuristic.ts` is the
 * quality engine; this one is the floor.
 *
 * Pure and synchronous — no React, no Zustand, no DOM, no clock.
 */

import { boundsOf, expand, overlaps, type Bounds } from '@/canvas/collision/aabb';
import { convexPartsOf } from '@/canvas/collision/convexParts';
import { orientPoints } from '@/canvas/collision/orient';
import { satCollision, separation } from '@/canvas/collision/sat';
import { translate } from '@/marker/pieceGeometry';
import type { Point } from '@/marker/schema';
import {
  anglesFor,
  boundsSize,
  boxAreaOf,
  expandQuantities,
  type NestPiece,
  type NestPlacement,
  type NestPlan,
  type NestProgress,
  type NestRequest,
} from './model';

/** One orientation of a piece, computed once rather than at every position. */
interface Candidate {
  readonly rotation: number;
  readonly parts: Point[][];
  readonly bounds: Bounds;
}

interface Obstacle {
  readonly parts: Point[][];
  readonly bounds: Bounds;
}

const toObstacle = (parts: Point[][]): Obstacle => ({ parts, bounds: boundsOf(parts.flat()) });

const candidatesFor = (piece: NestPiece, angles: readonly number[]): Candidate[] => {
  const parts = convexPartsOf(piece.geometry);
  return angles.map((rotation) => {
    const spin = { rotation, flipped: false };
    return {
      rotation,
      parts: parts.map((part) => orientPoints(part, spin)),
      bounds: boundsOf(orientPoints(piece.geometry, spin)),
    };
  });
};

/**
 * Does this candidate at this position hit anything already down?
 *
 * Broad phase first — most obstacles are nowhere near — then SAT on the convex
 * parts. The buffer is measured, not merely used to widen the search box: two
 * pieces can pass the box test and still come to rest touching, and a cutter
 * following that line has nothing to cut.
 */
const collides = (
  candidate: Candidate,
  at: Point,
  buffer: number,
  obstacles: readonly Obstacle[],
): boolean => {
  const searchBounds = expand(
    {
      minX: candidate.bounds.minX + at.x,
      minY: candidate.bounds.minY + at.y,
      maxX: candidate.bounds.maxX + at.x,
      maxY: candidate.bounds.maxY + at.y,
    },
    buffer,
  );

  for (const obstacle of obstacles) {
    if (!overlaps(searchBounds, obstacle.bounds)) continue;
    for (const part of candidate.parts) {
      const moved = translate(part, at);
      for (const obstaclePart of obstacle.parts) {
        if (satCollision(moved, obstaclePart).collides) return true;
        if (buffer > 0 && separation(moved, obstaclePart) < buffer) return true;
      }
    }
  }
  return false;
};

const straddlesSplice = (
  bounds: Bounds,
  at: Point,
  splices: NestRequest['spliceLines'],
): boolean => {
  const left = at.x + bounds.minX;
  const right = at.x + bounds.maxX;
  return splices.some((splice) => left < splice.x && right > splice.x);
};

/**
 * The order to try a piece's orientations in.
 *
 * Narrowest across the fabric first: a shelf holds as many pieces as the width
 * allows, so the turn that eats the least width is the one that lets the most
 * pieces share the shelf. Ties break on the lower angle, which is what keeps
 * two runs of the same order identical.
 */
const preferredOrder = (candidates: readonly Candidate[]): Candidate[] =>
  [...candidates].sort((a, b) => {
    const across = boundsSize(a.bounds).height - boundsSize(b.bounds).height;
    return across !== 0 ? across : a.rotation - b.rotation;
  });

/** State of the shelf currently being filled. */
interface Shelf {
  /** Where this shelf starts along the fabric. */
  readonly startX: number;
  /** Next free position across the fabric. */
  cursorY: number;
  /** How far along the fabric the deepest piece in this shelf reaches. */
  depth: number;
}

export const nestShelf = (request: NestRequest, onProgress?: NestProgress): NestPlan => {
  const { sheet, spacing, effort } = request;
  const buffer = spacing.betweenPieces;
  const margin = spacing.fromEdge;

  const obstacles: Obstacle[] = request.obstacles.map((obstacle) =>
    toObstacle(convexPartsOf(obstacle.polygon)),
  );

  // Largest box first, id as the tiebreak so equal-area pieces never swap
  // order between runs.
  const queue = expandQuantities(request.pieces).sort((a, b) => {
    const byArea = boxAreaOf(b) - boxAreaOf(a);
    return byArea !== 0 ? byArea : a.id.localeCompare(b.id);
  });

  // The usable band across the fabric, once the selvedge margin is off both
  // edges.
  const bandBottom = margin;
  const bandTop = sheet.width - margin;

  const placements: NestPlacement[] = [];
  const unplaced: string[] = [];
  let shelf: Shelf = { startX: 0, cursorY: bandBottom, depth: 0 };
  let markerLength = 0;

  /**
   * Where a new shelf could start, in order.
   *
   * Past the current shelf, and then past the far edge of anything in the way.
   * A new shelf is not automatically clear fabric — a defect zone or a
   * pre-placed piece can sit right where it would open — so the starts a piece
   * is offered have to include the points where each obstruction ends.
   * Bounded by the obstacle count, so this stays linear rather than a scan.
   */
  const shelfStarts = (from: number): number[] => {
    const starts = new Set([from]);
    for (const obstacle of obstacles) {
      if (obstacle.bounds.maxX > from) starts.add(obstacle.bounds.maxX);
    }
    return [...starts].sort((a, b) => a - b);
  };

  for (const [index, piece] of queue.entries()) {
    const candidates = preferredOrder(candidatesFor(piece, anglesFor(piece.rotation, effort)));
    let landed = false;

    // The open shelf first, then each place a fresh one could begin.
    const attempts: { readonly startX: number; readonly cursorY: number; readonly fresh: boolean }[] =
      [
        { startX: shelf.startX, cursorY: shelf.cursorY, fresh: false },
        ...shelfStarts(shelf.startX + shelf.depth).map((startX) => ({
          startX,
          cursorY: bandBottom,
          fresh: true,
        })),
      ];

    for (const attempt of attempts) {
      if (landed) break;

      const { startX: shelfStart, cursorY } = attempt;

      for (const candidate of candidates) {
        const size = boundsSize(candidate.bounds);
        // Too wide for the roll in this orientation, whatever the shelf holds.
        if (size.height > bandTop - bandBottom) continue;

        const at = {
          x: shelfStart - candidate.bounds.minX,
          y: cursorY - candidate.bounds.minY,
        };

        if (at.y + candidate.bounds.maxY > bandTop) continue;
        if (sheet.maxLength !== undefined && at.x + candidate.bounds.maxX > sheet.maxLength) {
          continue;
        }
        if (straddlesSplice(candidate.bounds, at, request.spliceLines)) continue;
        if (collides(candidate, at, buffer, obstacles)) continue;

        placements.push({
          pieceId: piece.id,
          position: at,
          rotation: candidate.rotation,
          flipped: false,
        });
        obstacles.push(toObstacle(candidate.parts.map((part) => translate(part, at))));

        if (attempt.fresh) shelf = { startX: shelfStart, cursorY: bandBottom, depth: 0 };
        // The next piece in this shelf starts past this one, plus the gap the
        // cutter needs between them.
        shelf.cursorY = at.y + candidate.bounds.maxY + buffer;
        shelf.depth = Math.max(shelf.depth, at.x + candidate.bounds.maxX - shelf.startX + buffer);
        markerLength = Math.max(markerLength, at.x + candidate.bounds.maxX);
        landed = true;
        break;
      }
    }

    if (!landed) unplaced.push(piece.id);
    // Once per piece, which is the only boundary this algorithm has.
    onProgress?.(Math.round(((index + 1) / queue.length) * 100));
  }

  return { placements, unplaced, length: markerLength, sheet };
};
