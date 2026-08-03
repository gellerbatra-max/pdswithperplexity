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
import { satCollision, separation } from '@/canvas/collision/sat';
import { convexPartsOf } from '@/canvas/collision/convexParts';
import { translate } from '@/marker/pieceGeometry';
import type { Point } from '@/marker/schema';
import {
  NO_HAZARDS,
  polygonArea,
  type NestHazards,
  type NestPiece,
  type NestPlacement,
  type NestPlan,
} from './model';

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
  /** How many pieces landed. Zero means there is no marker here to judge. */
  readonly placementCount: number;
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
 * 1 means every piece is inside the fabric, clear of everything already on it,
 * and far enough from its neighbours for the knife. Each fault takes a share
 * off, so the number degrades rather than collapsing: a plan with one bad
 * piece in forty should not score the same as one that is bad throughout.
 *
 * This is a safety measure, not a quality one. A tight marker with a single
 * overlap is worthless — the overlap has to be found and fixed before anything
 * is cut — so utilisation is only worth reading once stability is 1.
 *
 * The faults, in the order they are checked:
 *
 * 1. A placement naming a piece that is not in the set. Unverifiable, so not safe.
 * 2. Off the fabric, past `maxLength`, or inside the selvedge margin.
 * 3. Overlapping an obstacle, or closer to one than the cutter buffer allows.
 * 4. Overlapping another piece, or closer to it than the cutter buffer allows.
 *
 * `hazards` is what the engine was given. Scoring asks exactly the questions
 * the engines ask while placing — same buffer, same obstacles, same
 * measured-gap rule — because a scorer that is stricter fails every honest
 * plan, and one that is laxer certifies a piece laid over a defect. Defaulting
 * to `NO_HAZARDS` scores geometry alone, which is all a caller with no request
 * in hand can honestly ask for.
 *
 * Faults counted per placement, so the worst a piece can do is count once
 * however many things it overlaps. Otherwise one badly placed piece in a dense
 * marker drags the score further than a scattering of separate faults, which
 * inverts how much work each takes to fix.
 */
export const stabilityOf = (
  plan: NestPlan,
  pieces: readonly NestPiece[],
  hazards: NestHazards = NO_HAZARDS,
): number => {
  const outlines = plan.placements.map((placement) => outlineOf(placement, pieces));
  if (outlines.length === 0) return 1;

  const { betweenPieces, fromEdge } = hazards.spacing;
  // Convex parts, because SAT on a concave outline reports overlaps that are
  // not there and would fail a perfectly good marker. Split once per shape
  // here rather than once per pair below.
  const parts = outlines.map((outline) => (outline ? convexPartsOf(outline) : null));
  const obstacles = hazards.obstacles.map((obstacle) => convexPartsOf(obstacle.polygon));

  const faulty = new Set<number>();

  outlines.forEach((outline, index) => {
    if (!outline) {
      // A placement naming a piece that is not in the set cannot be verified,
      // and an unverifiable placement is not a safe one.
      faulty.add(index);
      return;
    }
    const bounds = boundsOf(outline);
    // `fromEdge` keeps pieces off the selvedge, which is distorted on most
    // rolls — as real a boundary as the edge itself. At the default of zero
    // this is the plain width check it replaced.
    if (bounds.minY < fromEdge || bounds.maxY > plan.sheet.width - fromEdge) faulty.add(index);
    if (bounds.minX < 0) faulty.add(index);
    if (plan.sheet.maxLength !== undefined && bounds.maxX > plan.sheet.maxLength) {
      faulty.add(index);
    }

    const own = parts[index];
    if (own && obstacles.some((obstacle) => tooClose(own, obstacle, betweenPieces))) {
      faulty.add(index);
    }
  });

  for (let i = 0; i < parts.length; i += 1) {
    for (let j = i + 1; j < parts.length; j += 1) {
      const a = parts[i];
      const b = parts[j];
      if (!a || !b) continue;
      if (tooClose(a, b, betweenPieces)) {
        faulty.add(i);
        faulty.add(j);
      }
    }
  }

  return (outlines.length - faulty.size) / outlines.length;
};

/**
 * Do these two shapes overlap, or sit closer than the knife needs?
 *
 * The gap is measured rather than inferred from the overlap test, which is how
 * the engines do it: expanding a bounding box decides which pairs are worth
 * testing, but only `separation` can say whether two pieces come to rest
 * touching with nothing for the cutter to follow.
 */
const tooClose = (
  a: readonly (readonly Point[])[],
  b: readonly (readonly Point[])[],
  gap: number,
): boolean => {
  for (const partA of a) {
    for (const partB of b) {
      if (satCollision(partA, partB).collides) return true;
      if (gap > 0 && separation(partA, partB) < gap) return true;
    }
  }
  return false;
};

/**
 * Score a plan.
 *
 * `runtimeMs` is passed in rather than measured here: scoring runs long after
 * the nest finished, and a clock read at this point would time the scoring.
 *
 * `hazards` are what the engine was given — see `stabilityOf`. It trails
 * `runtimeMs` so that every existing call keeps its meaning; `runScored` is
 * the caller that has a request in hand, and it always passes both.
 */
export const scorePlan = (
  plan: NestPlan,
  pieces: readonly NestPiece[],
  runtimeMs: number | null = null,
  hazards: NestHazards = NO_HAZARDS,
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
    placementCount: plan.placements.length,
    stability: stabilityOf(plan, pieces, hazards),
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
 * 0. Did it lay anything at all. A plan that placed nothing is not a marker.
 * 1. Stability. An unsafe marker is not a candidate at any utilisation.
 * 2. Pieces left over. A marker missing four pieces is not a marker.
 * 3. Utilisation. Once it is safe and complete, less fabric wins.
 *
 * Rule 0 exists because stability is *vacuous* on an empty plan: there is
 * nothing laid, so nothing can be unsafe, and `stabilityOf` honestly reports
 * 1. Without this gate that vacuous 1 wins rule 1 outright and the later rules
 * never run — so in `best` mode an engine that placed nothing would beat one
 * that placed everything with a single fixable overlap. It is the empty case
 * only; a plan that laid one piece of ten is still ranked on its merits by
 * rules 1–3.
 *
 * Returns negative when `a` is the better plan, so it sorts best-first.
 * Deterministic and total: every comparison is on a number already on the
 * score, so equal scores compare equal however they were produced. Runtime is
 * deliberately not a tiebreak — a marker is cut for weeks and nested once, so
 * a second of nesting never outweighs a centimetre of cloth.
 */
export const compareScores = (a: NestScore, b: NestScore): number => {
  const aLaidNothing = a.placementCount === 0;
  const bLaidNothing = b.placementCount === 0;
  if (aLaidNothing !== bLaidNothing) return aLaidNothing ? 1 : -1;

  if (a.stability !== b.stability) return b.stability - a.stability;
  if (a.unplacedCount !== b.unplacedCount) return a.unplacedCount - b.unplacedCount;
  return b.utilization - a.utilization;
};
