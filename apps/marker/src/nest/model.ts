/**
 * The nesting data model.
 *
 * Every engine — the shelf baseline, the bottom-left fill, whatever comes
 * after — reads this and writes `NestPlan`. The model is the stable part: if
 * something has to give, it is the algorithm that gets simpler, never this.
 *
 * These types deliberately do **not** duplicate `marker/schema.ts`. A
 * `TrayPiece` is what the app stores; a `NestPiece` is what an engine needs to
 * place one, and `nestPieceFrom` is the single conversion between them. Two
 * hand-maintained shapes for the same thing drift, and the drift shows up as
 * pieces landing somewhere other than where collision thinks they are.
 *
 * Pure: no React, no Zustand, no DOM, no clock.
 */

import { boundsOf, type Bounds } from '@/canvas/collision/aabb';
import type { DefectZone, LayDirection, Point, SpliceLine, TrayPiece } from '@/marker/schema';

/* --- The sheet ----------------------------------------------------------- */

/**
 * The fabric being packed.
 *
 * Width runs across (+Y) and is fixed by the roll. Length runs along (+X) and
 * is normally unbounded — a roll is longer than any marker — so `maxLength` is
 * optional and means "this marker may not exceed this", not "the fabric ends".
 */
export interface NestSheet {
  readonly width: number;
  readonly maxLength?: number;
}

/* --- Constraints --------------------------------------------------------- */

/**
 * Which turns a piece may take.
 *
 * This is grain, not preference. A two-way piece cut at 90° is cut across the
 * grain and will hang wrong on the body, so no amount of searching for a
 * tighter marker justifies it.
 */
export type RotationPolicy = 'half-turn' | 'quarter-turn' | 'free';

export const rotationPolicyFor = (layDirection: LayDirection): RotationPolicy =>
  layDirection === '2way' ? 'half-turn' : layDirection === '4way' ? 'quarter-turn' : 'free';

/** A free piece gets 8 angles at effort 1, and 8 more for each step up. */
export const FREE_ANGLES_PER_EFFORT = 8;

export type NestEffort = 1 | 2 | 3 | 4 | 5;

/**
 * The angles a piece may be tried at.
 *
 * Effort subdivides the circle for free-direction pieces only: 8 angles at
 * effort 1 through 40 at effort 5. Grain-constrained pieces ignore it.
 */
export const anglesFor = (policy: RotationPolicy, effort: NestEffort): number[] => {
  if (policy === 'half-turn') return [0, 180];
  if (policy === 'quarter-turn') return [0, 90, 180, 270];

  const count = FREE_ANGLES_PER_EFFORT * effort;
  const step = 360 / count;
  return Array.from({ length: count }, (_, index) => index * step);
};

/**
 * How much fabric must stay clear.
 *
 * `betweenPieces` is the cutter buffer: the knife has width, and two pieces
 * that touch cannot both be cut cleanly. `fromEdge` keeps pieces off the
 * selvedge, which is distorted on most rolls.
 */
export interface SpacingRules {
  readonly betweenPieces: number;
  readonly fromEdge: number;
}

export const NO_SPACING: SpacingRules = { betweenPieces: 0, fromEdge: 0 };

/* --- Input --------------------------------------------------------------- */

/**
 * One piece as an engine sees it.
 *
 * `geometry` is the outline at the origin, unplaced and unrotated — the same
 * convention as `TrayPiece.geometry`, so no engine has to know whether a
 * polygon has already been transformed.
 */
export interface NestPiece {
  readonly id: string;
  readonly geometry: readonly Point[];
  readonly rotation: RotationPolicy;
  /** How many of this piece still need placing. Never below zero. */
  readonly quantity: number;
}

/** The one conversion from what the app stores to what an engine places. */
export const nestPieceFrom = (piece: TrayPiece): NestPiece => ({
  id: piece.id,
  geometry: piece.geometry,
  rotation: rotationPolicyFor(piece.layDirection),
  quantity: Math.max(0, piece.quantity - piece.placed),
});

/**
 * Regions an engine must keep out of.
 *
 * Obstacles are given as polygons rather than as pieces because their origin
 * does not matter to the packer: a defect zone, an already-placed piece and a
 * clamp mark are all just fabric it may not use.
 */
export interface NestObstacle {
  readonly polygon: readonly Point[];
}

export const obstacleFromZone = (zone: DefectZone): NestObstacle => ({
  polygon: [
    { x: zone.x, y: zone.y },
    { x: zone.x + zone.width, y: zone.y },
    { x: zone.x + zone.width, y: zone.y + zone.height },
    { x: zone.x, y: zone.y + zone.height },
  ],
});

/** Everything an engine needs, and nothing about how it should pack. */
export interface NestRequest {
  readonly sheet: NestSheet;
  readonly pieces: readonly NestPiece[];
  readonly spacing: SpacingRules;
  readonly obstacles: readonly NestObstacle[];
  readonly spliceLines: readonly SpliceLine[];
  readonly effort: NestEffort;
}

/* --- Output -------------------------------------------------------------- */

/**
 * Where one piece ended up.
 *
 * `position` is the translation applied after the piece is flipped and then
 * rotated — the canonical order from CLAUDE.md. An engine that reports a
 * position computed in any other order puts the piece somewhere other than
 * where collision detected it.
 */
export interface NestPlacement {
  readonly pieceId: string;
  readonly position: Point;
  readonly rotation: number;
  readonly flipped: boolean;
}

/**
 * The result of a run.
 *
 * `unplaced` carries piece ids, repeated once per copy that found no home, so
 * a caller can tell "one of four did not fit" from "none of them did".
 */
export interface NestPlan {
  readonly placements: readonly NestPlacement[];
  readonly unplaced: readonly string[];
  readonly length: number;
  readonly sheet: NestSheet;
}

/**
 * Progress, reported once per piece.
 *
 * Both engines place one piece at a time and have no finer boundary, so
 * anything more granular would be invented rather than measured.
 */
export interface NestProgress {
  (percent: number): void;
}

export const EMPTY_PLAN = (sheet: NestSheet): NestPlan => ({
  placements: [],
  unplaced: [],
  length: 0,
  sheet,
});

/* --- Shared geometry helpers -------------------------------------------- */

/** Shoelace area. Used for utilisation and waste, so it lives with the model. */
export const polygonArea = (points: readonly Point[]): number => {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if (a && b) sum += (b.x + a.x) * (b.y - a.y);
  }
  return Math.abs(sum / 2);
};

export const boundsSize = (bounds: Bounds): { width: number; height: number } => ({
  width: bounds.maxX - bounds.minX,
  height: bounds.maxY - bounds.minY,
});

/** Expand each piece's quantity into one entry per copy to be placed. */
export const expandQuantities = (pieces: readonly NestPiece[]): NestPiece[] => {
  const expanded: NestPiece[] = [];
  for (const piece of pieces) {
    for (let copy = 0; copy < piece.quantity; copy += 1) {
      expanded.push({ ...piece, quantity: 1 });
    }
  }
  return expanded;
};

/** Bounding-box area, the sort key every engine here starts from. */
export const boxAreaOf = (piece: NestPiece): number => {
  const size = boundsSize(boundsOf(piece.geometry));
  return size.width * size.height;
};
