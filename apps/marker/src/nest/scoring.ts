/**
 * Scoring a nest plan.
 *
 * One number per question a marker maker actually asks: how much of the fabric
 * did we use, how much did we throw away, how safely is it laid, and how long
 * did it take. Enough to compare two engines on the same order and say which
 * one won.
 *
 * Local and cheap — a few polygon areas and a pass over the placements. No
 * model, no service, no training. Deliberately: a score that needs a network
 * call cannot be used to pick an engine inside a worker.
 *
 * Pure apart from `timeRun`, which is the one function that reads a clock.
 */

import { boundsOf } from '@/canvas/collision/aabb';
import { orientPoints } from '@/canvas/collision/orient';
import { satCollision } from '@/canvas/collision/sat';
import { convexPartsOf } from '@/canvas/collision/convexParts';
import { translate } from '@/marker/pieceGeometry';
import type { Point } from '@/marker/schema';
import { polygonArea, type NestPiece, type NestPlacement, type NestPlan } from './model';

export interface NestScore {
  /** Placed area over marker area, as a percentage. */
  readonly utilization: number;
  /** Marker area not covered by a piece, in square centimetres. */
  readonly wasteArea: number;
  /** Total area of the pieces that landed, in square centimetres. */
  readonly placedArea: number;
  /** Marker area consumed: sheet width × the length the plan reached. */
  readonly markerArea: number;
  /** Length the plan reached along the fabric, in centimetres. */
  readonly length: number;
  /** How many pieces found no home. */
  readonly unplacedCount: number;
  /** 0–1. See `stabilityOf`. */
  readonly stability: number;
  /** Milliseconds the run took, or null when it was not timed. */
  readonly runtimeMs: number | null;
}

/** The outline of a placement, in marker space. */
export const outlineOf = (
  placement: NestPlacement,
  pieces: readonly NestPiece[],
): Point[] | null => {
  const source = pieces.find((piece) => piece.id === placement.pieceId);
  if (!source) return null;
  return translate(
    orientPoints(source.geometry, {
      rotation: placement.rotation,
      flipped: placement.flipped,
    }),
    placement.position,
  );
};

/**
 * Is this plan safe to cut?
 *
 * 1 means every piece is inside the fabric and no two touch. Each fault takes
 * a share off, so the number degrades rather than collapsing: a plan with one
 * bad piece in forty should not score the same as one that is bad throughout.
 *
 * This is a safety measure, not a quality one. A tight marker with a single
 * overlap is worthless — the overlap has to be found and fixed before anything
 * is cut — so utilisation is only worth reading once stability is 1.
 *
 * Faults counted per placement, so the worst a piece can do is count once
 * however many things it overlaps. Otherwise one badly placed piece in a dense
 * marker drags the score further than a scattering of separate faults, which
 * inverts how much work each takes to fix.
 */
export const stabilityOf = (plan: NestPlan, pieces: readonly NestPiece[]): number => {
  const outlines = plan.placements.map((placement) => outlineOf(placement, pieces));
  if (outlines.length === 0) return 1;

  const faulty = new Set<number>();

  outlines.forEach((outline, index) => {
    if (!outline) {
      // A placement naming a piece that is not in the set cannot be verified,
      // and an unverifiable placement is not a safe one.
      faulty.add(index);
      return;
    }
    const bounds = boundsOf(outline);
    if (bounds.minY < 0 || bounds.maxY > plan.sheet.width || bounds.minX < 0) faulty.add(index);
    if (plan.sheet.maxLength !== undefined && bounds.maxX > plan.sheet.maxLength) {
      faulty.add(index);
    }
  });

  for (let i = 0; i < outlines.length; i += 1) {
    for (let j = i + 1; j < outlines.length; j += 1) {
      const a = outlines[i];
      const b = outlines[j];
      if (!a || !b) continue;
      // Convex parts, because SAT on a concave outline reports overlaps that
      // are not there and would fail a perfectly good marker.
      if (partsOverlap(a, b)) {
        faulty.add(i);
        faulty.add(j);
      }
    }
  }

  return (outlines.length - faulty.size) / outlines.length;
};

const partsOverlap = (a: readonly Point[], b: readonly Point[]): boolean => {
  for (const partA of convexPartsOf(a)) {
    for (const partB of convexPartsOf(b)) {
      if (satCollision(partA, partB).collides) return true;
    }
  }
  return false;
};

/**
 * Score a plan.
 *
 * `runtimeMs` is passed in rather than measured here: scoring runs long after
 * the nest finished, and a clock read at this point would time the scoring.
 */
export const scorePlan = (
  plan: NestPlan,
  pieces: readonly NestPiece[],
  runtimeMs: number | null = null,
): NestScore => {
  let placedArea = 0;
  for (const placement of plan.placements) {
    const outline = outlineOf(placement, pieces);
    if (outline) placedArea += polygonArea(outline);
  }

  const markerArea = plan.sheet.width * plan.length;

  return {
    utilization: markerArea > 0 ? (placedArea / markerArea) * 100 : 0,
    // Never negative: pieces that overlap can cover more than the marker holds,
    // and "minus four square metres of waste" is not a fact about any fabric.
    wasteArea: Math.max(0, markerArea - placedArea),
    placedArea,
    markerArea,
    length: plan.length,
    unplacedCount: plan.unplaced.length,
    stability: stabilityOf(plan, pieces),
    runtimeMs,
  };
};

/**
 * Time a run.
 *
 * The one place a clock is read. Kept out of `runNest` so the pipeline stays
 * pure and its output stays comparable between runs — a plan that carried its
 * own timing would never equal itself.
 */
export const timeRun = <T>(run: () => T): { readonly value: T; readonly ms: number } => {
  const started = performance.now();
  const value = run();
  return { value, ms: performance.now() - started };
};

/**
 * Which plan to prefer.
 *
 * Ordered by what would stop a marker reaching the cutting room, not by which
 * number is prettiest:
 *
 * 1. Stability. An unsafe marker is not a candidate at any utilisation.
 * 2. Pieces left over. A marker missing four pieces is not a marker.
 * 3. Utilisation. Once it is safe and complete, less fabric wins.
 *
 * Returns negative when `a` is the better plan, so it sorts best-first.
 * Runtime is deliberately not a tiebreak: a marker is cut for weeks and nested
 * once, so a second of nesting never outweighs a centimetre of cloth.
 */
export const compareScores = (a: NestScore, b: NestScore): number => {
  if (a.stability !== b.stability) return b.stability - a.stability;
  if (a.unplacedCount !== b.unplacedCount) return a.unplacedCount - b.unplacedCount;
  return b.utilization - a.utilization;
};
