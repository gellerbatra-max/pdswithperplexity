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
import { anglesFor, polygonArea, rotationPolicyFor, type NestEffort } from './model';
import { cellSizeFor, SpatialIndex } from './spatialIndex';

export type { NestEffort };

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

/**
 * Angles this piece may be tried at.
 *
 * The rule lives in `model.ts` so both engines turn pieces the same way; this
 * is the lay-direction spelling of it, kept because callers hold a
 * `TrayPiece`, not a policy.
 */
export const rotationsFor = (layDirection: LayDirection, effort: NestEffort): number[] =>
  anglesFor(rotationPolicyFor(layDirection), effort);

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
  /**
   * Somewhere to put `parts` shifted to the position being tried.
   *
   * The search asks about millions of positions, and building a fresh polygon
   * for each one was the single largest cost in the run — far more than the
   * SAT test it fed. The same buffer is refilled instead. Safe because
   * `collides` runs to completion before the next position is considered, and
   * nothing keeps a reference to the points afterwards.
   */
  readonly scratch: Point[][];
}

const candidatesFor = (piece: TrayPiece, rotations: readonly number[]): Candidate[] => {
  const parts = convexPartsOf(piece.geometry);
  const candidates: Candidate[] = [];

  for (const rotation of rotations) {
    const spin = { rotation, flipped: false };
    const oriented = orientPoints(piece.geometry, spin);
    const turned = parts.map((part) => orientPoints(part, spin));
    candidates.push({
      rotation,
      parts: turned,
      bounds: boundsOf(oriented),
      scratch: turned.map((part) => part.map(() => ({ x: 0, y: 0 }))),
    });
  }

  return candidates;
};

/** Refill a candidate's scratch buffer with its outline at `at`. */
const shiftInto = (candidate: Candidate, at: Point): Point[][] => {
  for (let i = 0; i < candidate.parts.length; i += 1) {
    const source = candidate.parts[i];
    const target = candidate.scratch[i];
    if (!source || !target) continue;
    for (let j = 0; j < source.length; j += 1) {
      const point = source[j];
      const slot = target[j];
      if (!point || !slot) continue;
      slot.x = point.x + at.x;
      slot.y = point.y + at.y;
    }
  }
  return candidate.scratch;
};

const fitsFabric = (bounds: Bounds, at: Point, fabricWidth: number): boolean =>
  at.y + bounds.minY >= 0 && at.y + bounds.maxY <= fabricWidth && at.x + bounds.minX >= 0;

const straddlesSplice = (bounds: Bounds, at: Point, splices: readonly SpliceLine[]): boolean => {
  const left = at.x + bounds.minX;
  const right = at.x + bounds.maxX;
  return splices.some((splice) => left < splice.x && right > splice.x);
};

/**
 * Does this candidate at this position hit anything already down?
 *
 * Three filters, cheapest first: the grid narrows to obstacles sharing a cell,
 * the AABB test drops the rest of the near misses, and SAT decides the ones
 * that are actually close. The grid changes only which pairs reach the AABB
 * test — every obstacle that overlaps `searchBounds` is still visited — so the
 * answer is the same one a full scan gives.
 */
const collides = (
  candidate: Candidate,
  at: Point,
  buffer: number,
  obstacles: SpatialIndex<Obstacle>,
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

  /**
   * Filled at most once per position, and only if something is near enough to
   * need it — a position with nothing around it never builds an outline.
   */
  let moved: Point[][] | null = null;

  return obstacles.forEachNear(searchBounds, (obstacle) => {
    // Broad phase: sharing a cell is not overlapping, and SAT is the
    // expensive half.
    if (!overlaps(searchBounds, obstacle.bounds)) return false;

    const parts = moved ?? (moved = shiftInto(candidate, at));
    for (const part of parts) {
      for (const obstaclePart of obstacle.parts) {
        if (satCollision(part, obstaclePart).collides) return true;
        // Expanding the search bounds only decides which pairs get tested; the
        // gap itself has to be measured, or pieces come to rest touching and
        // the cutter has nothing to follow.
        if (buffer > 0 && separation(part, obstaclePart) < buffer) return true;
      }
    }
    return false;
  });
};

export interface NestProgress {
  (percent: number): void;
}

export const nest = (input: NestInput, onProgress?: NestProgress): NestResult => {
  const { fabricWidth, effort } = input;
  const buffer = input.cutterBuffer ?? 0;
  const step = 1 / effort;

  const initial: Obstacle[] = [];
  for (const piece of input.placed) {
    const parts = convexPartsOf(piece.geometry).map((part) =>
      translate(orientPoints(part, piece), piece.position),
    );
    initial.push(toObstacle(parts));
  }
  for (const zone of input.defectZones) {
    initial.push(toObstacle([rectangle(zone.x, zone.y, zone.width, zone.height)]));
  }

  // Sized from the pieces this run will handle, not from what is already down:
  // an empty marker has no obstacles to measure, and the pieces about to be
  // placed are what the grid will end up holding.
  const obstacles = new SpatialIndex<Obstacle>(
    cellSizeFor(
      [...input.pieces.map((piece) => boundsOf(piece.geometry)), ...initial.map((o) => o.bounds)],
      fabricWidth,
    ),
  );
  for (const obstacle of initial) obstacles.insert(obstacle.bounds, obstacle);

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

  /**
   * The furthest along the roll a splice can push a legal start.
   *
   * `markerLength` only ever measures fabric something is lying on, so it does
   * not see splices — a splice occupies nothing. But a piece that fits in no
   * gap between splices has to begin at or after the last one, and scanning to
   * `markerLength + width` would stop short of it and call the piece unplaced
   * with clear fabric past the splice never tried.
   *
   * Beyond the last splice nothing constrains the piece, so reaching one full
   * piece-width past it is enough. Computed once: splices do not move during a
   * run.
   */
  const spliceReach = input.spliceLines.reduce(
    (furthest, splice) => Math.max(furthest, splice.x),
    0,
  );

  const placements: NestPlacement[] = [];
  const unplaced: string[] = [];
  let placedArea = 0;
  let markerLength = input.placed.reduce((longest, piece) => {
    const bounds = boundsOf(orientedGeometry(piece));
    return Math.max(longest, piece.position.x + bounds.maxX);
  }, 0);
  for (const piece of input.placed) placedArea += polygonArea(piece.geometry);

  for (const [index, piece] of queue.entries()) {
    const candidates = candidatesFor(piece, rotationsFor(piece.layDirection, effort));
    let landed = false;

    // Scan x outermost so the marker grows only when the current column is
    // genuinely full — this is what makes it bottom-LEFT fill.
    //
    // The obstacle set is behind a spatial grid, so a candidate is only tested
    // against what shares a cell with it rather than against everything placed
    // so far. Positions still scale with effort squared; what no longer scales
    // is the cost of each one.
    const maxX = Math.max(markerLength, spliceReach) +
      Math.max(...candidates.map((c) => c.bounds.maxX - c.bounds.minX)) +
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
          const placedObstacle = toObstacle(candidate.parts.map((part) => translate(part, at)));
          obstacles.insert(placedObstacle.bounds, placedObstacle);
          markerLength = Math.max(markerLength, at.x + candidate.bounds.maxX);
          placedArea += polygonArea(piece.geometry);
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
