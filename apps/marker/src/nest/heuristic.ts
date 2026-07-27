/**
 * Bottom-Left Fill auto-nest.
 *
 * Largest piece first, then for each piece scan the fabric left-to-right and
 * bottom-to-top and take the first position that fits. Placed pieces become
 * obstacles for the ones after them.
 *
 * Pure and synchronous: no React, no Zustand, no DOM. It runs in a worker
 * because it is slow, not because it needs anything a worker provides — which
 * is what makes it testable directly.
 */

import { boundsOf, expand, overlaps, type Bounds } from '@/canvas/collision/aabb';
import { convexPartsOf } from '@/canvas/collision/convexParts';
import { orientPoints } from '@/canvas/collision/orient';
import { satCollision, separation } from '@/canvas/collision/sat';
import { orientedGeometry, translate } from '@/marker/pieceGeometry';
import type {
  DefectZone,
  LayDirection,
  PlacedPiece,
  Point,
  SpliceLine,
  TrayPiece,
} from '@/marker/schema';

export type NestEffort = 1 | 2 | 3 | 4 | 5;

export interface NestInput {
  readonly pieces: TrayPiece[];
  readonly fabricWidth: number;
  /** Existing placed pieces, treated as fixed obstacles. */
  readonly placed: PlacedPiece[];
  readonly defectZones: DefectZone[];
  readonly spliceLines: SpliceLine[];
  readonly effort: NestEffort;
  /** Held between every pair of pieces. Defaults to zero. */
  readonly cutterBuffer?: number;
}

export interface NestPlacement {
  readonly pieceDefId: string;
  readonly position: Point;
  readonly rotation: number;
  readonly flipped: boolean;
}

export interface NestResult {
  readonly placements: NestPlacement[];
  readonly utilization: number;
  readonly markerLength: number;
  /** Pieces that found no legal position anywhere on the fabric. */
  readonly unplaced: string[];
}

/** A free piece gets 8 angles at effort 1, and 8 more for each step up. */
const FREE_ANGLES_PER_EFFORT = 8;

/**
 * Angles this piece may be tried at.
 *
 * Effort subdivides the circle for free-direction pieces only: 8 angles at
 * effort 1 through 40 at effort 5. Grain-constrained pieces ignore it — no
 * amount of searching makes it acceptable to cut a two-way piece off-grain.
 */
export const rotationsFor = (layDirection: LayDirection, effort: NestEffort): number[] => {
  if (layDirection === '2way') return [0, 180];
  if (layDirection === '4way') return [0, 90, 180, 270];

  const count = FREE_ANGLES_PER_EFFORT * effort;
  const step = 360 / count;
  return Array.from({ length: count }, (_, index) => index * step);
};

/**
 * How far past the current marker end the scan is allowed to reach.
 *
 * Without a ceiling, a piece that cannot fit anywhere would scan to infinity.
 * One extra piece-length past the end is always enough: if it does not fit
 * there, the fabric is clear and it never will.
 */
const SCAN_MARGIN = 1;

interface Obstacle {
  readonly parts: Point[][];
  readonly bounds: Bounds;
}

const rectangle = (x: number, y: number, width: number, height: number): Point[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

const toObstacle = (parts: Point[][]): Obstacle => ({ parts, bounds: boundsOf(parts.flat()) });

/** A candidate orientation, computed once per piece rather than per position. */
interface Candidate {
  readonly rotation: number;
  readonly parts: Point[][];
  readonly bounds: Bounds;
}

const candidatesFor = (piece: TrayPiece, rotations: readonly number[]): Candidate[] => {
  const parts = convexPartsOf(piece.geometry);
  const candidates: Candidate[] = [];

  for (const rotation of rotations) {
    const spin = { rotation, flipped: false };
    const oriented = orientPoints(piece.geometry, spin);
    candidates.push({
      rotation,
      parts: parts.map((part) => orientPoints(part, spin)),
      bounds: boundsOf(oriented),
    });
  }

  return candidates;
};

const fitsFabric = (bounds: Bounds, at: Point, fabricWidth: number): boolean =>
  at.y + bounds.minY >= 0 && at.y + bounds.maxY <= fabricWidth && at.x + bounds.minX >= 0;

const straddlesSplice = (bounds: Bounds, at: Point, splices: readonly SpliceLine[]): boolean => {
  const left = at.x + bounds.minX;
  const right = at.x + bounds.maxX;
  return splices.some((splice) => left < splice.x && right > splice.x);
};

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
    // Broad phase first: most obstacles are nowhere near, and SAT is the
    // expensive half.
    if (!overlaps(searchBounds, obstacle.bounds)) continue;
    for (const part of candidate.parts) {
      const moved = translate(part, at);
      for (const obstaclePart of obstacle.parts) {
        if (satCollision(moved, obstaclePart).collides) return true;
        // Expanding the search bounds only decides which pairs get tested; the
        // gap itself has to be measured, or pieces come to rest touching and
        // the cutter has nothing to follow.
        if (buffer > 0 && separation(moved, obstaclePart) < buffer) return true;
      }
    }
  }
  return false;
};

/** Shoelace area, for the utilisation figure. */
const areaOf = (points: readonly Point[]): number => {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if (a && b) sum += (b.x + a.x) * (b.y - a.y);
  }
  return Math.abs(sum / 2);
};

export interface NestProgress {
  (percent: number): void;
}

export const nest = (input: NestInput, onProgress?: NestProgress): NestResult => {
  const { fabricWidth, effort } = input;
  const buffer = input.cutterBuffer ?? 0;
  const step = 1 / effort;

  const obstacles: Obstacle[] = [];
  for (const piece of input.placed) {
    const parts = convexPartsOf(piece.geometry).map((part) =>
      translate(orientPoints(part, piece), piece.position),
    );
    obstacles.push(toObstacle(parts));
  }
  for (const zone of input.defectZones) {
    obstacles.push(toObstacle([rectangle(zone.x, zone.y, zone.width, zone.height)]));
  }

  // Largest bounding-box area first: big pieces have the fewest legal homes,
  // so placing them into an empty marker wastes the least fabric.
  const queue = [...input.pieces].sort((a, b) => {
    const areaA = boundsOf(a.geometry);
    const areaB = boundsOf(b.geometry);
    return (
      (areaB.maxX - areaB.minX) * (areaB.maxY - areaB.minY) -
      (areaA.maxX - areaA.minX) * (areaA.maxY - areaA.minY)
    );
  });

  const placements: NestPlacement[] = [];
  const unplaced: string[] = [];
  let placedArea = 0;
  let markerLength = input.placed.reduce((longest, piece) => {
    const bounds = boundsOf(orientedGeometry(piece));
    return Math.max(longest, piece.position.x + bounds.maxX);
  }, 0);
  for (const piece of input.placed) placedArea += areaOf(piece.geometry);

  for (const [index, piece] of queue.entries()) {
    const candidates = candidatesFor(piece, rotationsFor(piece.layDirection, effort));
    let landed = false;

    // Scan x outermost so the marker grows only when the current column is
    // genuinely full — this is what makes it bottom-LEFT fill.
    //
    // TODO(performance): broad-phase spatial grid. This is
    // O(positions x obstacles), positions scale with effort squared, and every
    // obstacle is retested at every candidate position however far away it is.
    // Bucketing obstacles into fabric-width cells and testing only the buckets
    // a candidate touches would make the cost independent of marker length,
    // which is what a 200-piece order at effort 5 needs.
    const maxX = markerLength + Math.max(...candidates.map((c) => c.bounds.maxX - c.bounds.minX)) +
      SCAN_MARGIN;

    for (let x = 0; x <= maxX && !landed; x += step) {
      for (let y = 0; y <= fabricWidth && !landed; y += step) {
        for (const candidate of candidates) {
          const at = { x: x - candidate.bounds.minX, y: y - candidate.bounds.minY };
          if (!fitsFabric(candidate.bounds, at, fabricWidth)) continue;
          if (straddlesSplice(candidate.bounds, at, input.spliceLines)) continue;
          if (collides(candidate, at, buffer, obstacles)) continue;

          placements.push({
            pieceDefId: piece.id,
            position: at,
            rotation: candidate.rotation,
            flipped: false,
          });
          obstacles.push(
            toObstacle(candidate.parts.map((part) => translate(part, at))),
          );
          markerLength = Math.max(markerLength, at.x + candidate.bounds.maxX);
          placedArea += areaOf(piece.geometry);
          landed = true;
          break;
        }
      }
    }

    if (!landed) unplaced.push(piece.id);
    onProgress?.(Math.round(((index + 1) / queue.length) * 100));
  }

  const markerArea = fabricWidth * markerLength;
  return {
    placements,
    utilization: markerArea > 0 ? (placedArea / markerArea) * 100 : 0,
    markerLength,
    unplaced,
  };
};
