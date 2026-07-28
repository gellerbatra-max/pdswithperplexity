/**
 * The one way to run a nesting engine.
 *
 * `runNest(request, engine)` takes a `NestRequest` and returns a `NestPlan`,
 * whichever engine did the work. Callers pick an engine by name and read one
 * result shape; nothing above this module knows that bottom-left fill and the
 * shelf baseline disagree about what a placement is called.
 *
 * The engines are left alone. Where they differ, the difference is absorbed
 * here — an adapter in one file is cheaper to reason about than two engines
 * kept in step by hand, and far cheaper than a UI that branches on which one
 * ran.
 *
 * Pure and synchronous. `nestRunner.ts` is what puts it on a worker.
 */

import { placedGeometry } from '@/marker/pieceGeometry';
import type { DefectZone, PlacedPiece, Point, SpliceLine, TrayPiece } from '@/marker/schema';
import { boundsOf } from '@/canvas/collision/aabb';
import { orientPoints } from '@/canvas/collision/orient';
import { nest, type NestInput, type NestResult } from './heuristic';
import {
  expandQuantities,
  nestPieceFrom,
  obstacleFromZone,
  type NestEffort,
  type NestObstacle,
  type NestPiece,
  type NestPlacement,
  type NestPlan,
  type NestProgress,
  type NestRequest,
  type NestSheet,
  type SpacingRules,
} from './model';
import { compareScores, scorePlan, timeRun, type NestScore } from './scoring';
import { nestShelf } from './shelf';

/**
 * Which engine to run.
 *
 * `shelf` is the deterministic baseline — fast, obvious, and the floor every
 * other engine is measured against. `heuristic` is bottom-left fill, slower
 * and tighter. Named rather than passed as a function so a plan can record
 * which engine produced it and a caller can be given a fixed set to choose
 * from.
 */
export type NestEngine = 'shelf' | 'heuristic';

export const NEST_ENGINES: readonly NestEngine[] = ['shelf', 'heuristic'];

export const ENGINE_LABELS: Record<NestEngine, string> = {
  shelf: 'Shelf (fast)',
  heuristic: 'Bottom-left fill (tight)',
};

/* --- Heuristic adapters -------------------------------------------------- */

/**
 * A placeholder for the fields bottom-left fill does not read.
 *
 * `nest()` touches exactly three things on a `TrayPiece`: `id`, `geometry` and
 * `layDirection`. The rest of the shape exists for the tray UI. Filling it
 * with constants is safe *because* of that, and this is the only place that
 * assumption lives — if the engine ever starts reading `bundle`, the fix is
 * here rather than scattered across callers.
 */
const UNREAD_BY_ENGINE = {
  name: '',
  size: '',
  bundle: '',
  fabricCode: 'A',
} as const;

const layDirectionOf = (piece: NestPiece): TrayPiece['layDirection'] =>
  piece.rotation === 'half-turn' ? '2way' : piece.rotation === 'quarter-turn' ? '4way' : 'free';

const asTrayPiece = (piece: NestPiece): TrayPiece => ({
  ...UNREAD_BY_ENGINE,
  id: piece.id,
  geometry: [...piece.geometry],
  layDirection: layDirectionOf(piece),
  quantity: 1,
  placed: 0,
});

/**
 * An obstacle polygon as a piece already lying on the fabric.
 *
 * The polygon is already in marker space, so the piece gets the identity
 * transform: no flip, no rotation, no offset. `nest()` applies
 * flip → rotate → translate to every obstacle, and identity is what makes
 * that a no-op.
 */
const asPlacedObstacle = (obstacle: NestObstacle, index: number): PlacedPiece => ({
  ...UNREAD_BY_ENGINE,
  id: `obstacle-${index}`,
  pieceDefId: `obstacle-${index}`,
  geometry: [...obstacle.polygon],
  position: { x: 0, y: 0 },
  rotation: 0,
  flipped: false,
  placed: true,
  blocked: false,
});

/**
 * Translate a request into what bottom-left fill expects.
 *
 * Every obstacle becomes a pre-placed piece rather than a defect zone, because
 * a `DefectZone` is an axis-aligned rectangle and an obstacle is any polygon —
 * routing an outline through a rectangle would quietly enlarge it.
 *
 * That choice costs two numbers `nest()` reports and this pipeline does not
 * use: obstacle area lands in its `utilization`, and a far-flung obstacle
 * widens its `markerLength`. Both are recomputed here from the placements, so
 * the only real cost is a wider search when an obstacle sits far down the
 * roll. Placement decisions are identical either way.
 */
export const toHeuristicInput = (request: NestRequest): NestInput => ({
  pieces: expandQuantities(request.pieces).map(asTrayPiece),
  fabricWidth: usableWidth(request.sheet, request.spacing),
  placed: request.obstacles.map(asPlacedObstacle),
  defectZones: [],
  spliceLines: [...request.spliceLines],
  effort: request.effort,
  cutterBuffer: request.spacing.betweenPieces,
});

/**
 * The band a piece may occupy across the fabric.
 *
 * Bottom-left fill has no concept of a selvedge margin, so the margin is
 * applied by shrinking the width it is given and shifting the result back.
 * Taking it off both edges is what the shelf engine does, so the two agree.
 */
const usableWidth = (sheet: NestSheet, spacing: SpacingRules): number =>
  Math.max(0, sheet.width - spacing.fromEdge * 2);

/** Far edge of the furthest piece this run placed. */
const lengthOf = (placements: readonly NestPlacement[], pieces: readonly NestPiece[]): number => {
  let longest = 0;
  for (const placement of placements) {
    const source = pieces.find((piece) => piece.id === placement.pieceId);
    if (!source) continue;
    const bounds = boundsOf(
      orientPoints(source.geometry, {
        rotation: placement.rotation,
        flipped: placement.flipped,
      }),
    );
    longest = Math.max(longest, placement.position.x + bounds.maxX);
  }
  return longest;
};

/**
 * Bottom-left fill's result, in the shared shape.
 *
 * Two things are normalised. `pieceDefId` becomes `pieceId`, which is what the
 * model calls it. And the y offset taken off for the selvedge margin is added
 * back, because the engine packed into a narrower sheet that started at zero.
 */
export const planFromHeuristic = (
  result: NestResult,
  request: NestRequest,
  pieces: readonly NestPiece[],
): NestPlan => {
  const offsetY = request.spacing.fromEdge;
  const placements: NestPlacement[] = result.placements.map((placement) => ({
    pieceId: placement.pieceDefId,
    position: { x: placement.position.x, y: placement.position.y + offsetY },
    rotation: placement.rotation,
    flipped: placement.flipped,
  }));

  return {
    placements,
    unplaced: [...result.unplaced],
    length: lengthOf(placements, pieces),
    sheet: request.sheet,
  };
};

/* --- The entry point ----------------------------------------------------- */

/**
 * Run one engine over one request.
 *
 * Deterministic: the same request and engine give the same plan every time.
 * Nothing here reads a clock or a random source, and both engines sort their
 * queue by a total order before placing anything.
 */
export const runNest = (
  request: NestRequest,
  engine: NestEngine,
  onProgress?: NestProgress,
): NestPlan => {
  if (engine === 'shelf') return nestShelf(request, onProgress);

  const expanded = expandQuantities(request.pieces);
  const result = nest(toHeuristicInput(request), onProgress);
  return planFromHeuristic(result, request, expanded);
};

/* --- Scored runs --------------------------------------------------------- */

export interface ScoredRun {
  readonly engine: NestEngine;
  readonly plan: NestPlan;
  readonly score: NestScore;
}

/** Run one engine and score what it produced, timing the run itself. */
export const runScored = (
  request: NestRequest,
  engine: NestEngine,
  onProgress?: NestProgress,
): ScoredRun => {
  const expanded = expandQuantities(request.pieces);
  const { value: plan, ms } = timeRun(() => runNest(request, engine, onProgress));
  return { engine, plan, score: scorePlan(plan, expanded, ms) };
};

/**
 * Run every engine over the same request and rank the results.
 *
 * Best first, by `compareScores`. This is the point of a shared request shape:
 * two engines can be handed identical work and judged on the same numbers.
 *
 * Sequential rather than parallel — they are CPU-bound and synchronous, so
 * running them at once would only interleave badly and make the timings lie.
 */
export const compareEngines = (
  request: NestRequest,
  engines: readonly NestEngine[] = NEST_ENGINES,
): ScoredRun[] =>
  engines
    .map((engine) => runScored(request, engine))
    .sort((a, b) => {
      const byScore = compareScores(a.score, b.score);
      // Ties keep the declared engine order, so the winner never depends on
      // which of two equal plans happened to be scored first.
      return byScore !== 0 ? byScore : engines.indexOf(a.engine) - engines.indexOf(b.engine);
    });

/* --- Boundaries ---------------------------------------------------------- */

/**
 * Build a request from what a marker document holds.
 *
 * The conversion lives here so a caller assembling a run does not have to know
 * that placed pieces and defect zones are both just obstacles to an engine.
 */
export const requestFromMarker = (marker: {
  readonly fabricWidth: number;
  readonly cutterBuffer: number;
  readonly pieces: readonly PlacedPiece[];
  readonly defectZones: readonly DefectZone[];
  readonly spliceLines: readonly SpliceLine[];
  readonly trayPieces: readonly TrayPiece[];
}, effort: NestEffort, edgeMargin = 0): NestRequest => ({
  sheet: { width: marker.fabricWidth },
  pieces: marker.trayPieces.map(nestPieceFrom).filter((piece) => piece.quantity > 0),
  spacing: { betweenPieces: marker.cutterBuffer, fromEdge: edgeMargin },
  obstacles: [
    ...marker.pieces.map((piece) => ({ polygon: placedGeometry(piece) })),
    ...marker.defectZones.map(obstacleFromZone),
  ],
  spliceLines: [...marker.spliceLines],
  effort,
});

/** What `markerStore.applyPlacements` expects. The store's name, not ours. */
export interface StorePlacement {
  readonly pieceDefId: string;
  readonly position: Point;
  readonly rotation: number;
  readonly flipped: boolean;
}

export const toStorePlacements = (plan: NestPlan): StorePlacement[] =>
  plan.placements.map((placement) => ({
    pieceDefId: placement.pieceId,
    position: placement.position,
    rotation: placement.rotation,
    flipped: placement.flipped,
  }));
