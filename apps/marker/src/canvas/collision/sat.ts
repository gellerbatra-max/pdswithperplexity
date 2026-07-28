/**
 * Narrow phase: Separating Axis Theorem, with a minimum translation vector.
 *
 * Only runs on pairs the AABB phase could not separate. Pure — no React, no
 * Zustand, no side effects.
 *
 * TODO(step-9): SAT is only sound for CONVEX polygons. Garment pieces are
 * routinely concave — an armhole, a crotch curve, a notched hem — and for
 * those this reports a collision across the concave span even when the pieces
 * are clear of each other. The fix is convex decomposition at import time, so
 * each piece carries a set of convex parts and every part is tested here. That
 * belongs with the DXF importer, which is where a piece first gets built.
 * Until then, nesting concave pieces will leave more fabric than it should.
 */

import type { Point } from '@/marker/schema';

export interface CollisionResult {
  collides: boolean;
  /** Shortest push that separates the first polygon from the second. */
  mtv?: Point;
}

const NO_COLLISION: CollisionResult = { collides: false };

/*
 * The axis loop below is written out rather than built from helper arrays.
 *
 * It used to call `axesOf(a)` and `axesOf(b)`, spread both into a third array,
 * and allocate a `{min, max}` per projection — around twenty-five objects per
 * call. Auto-nest makes millions of these calls in a single run, and the
 * garbage that produced cost more than the arithmetic did.
 *
 * The arithmetic itself is unchanged: same normals, same order (a's edges then
 * b's), same comparisons, so the numbers out are the numbers that came out
 * before.
 */

/** Project a polygon onto an axis, into the caller's scalars. */
let projectedMin = 0;
let projectedMax = 0;
const projectOnto = (polygon: readonly Point[], axisX: number, axisY: number): void => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of polygon) {
    const value = point.x * axisX + point.y * axisY;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  projectedMin = min;
  projectedMax = max;
};

const centroidOf = (polygon: readonly Point[]): Point => {
  let x = 0;
  let y = 0;
  for (const point of polygon) {
    x += point.x;
    y += point.y;
  }
  return { x: x / polygon.length, y: y / polygon.length };
};

/**
 * Test two polygons in marker space (cm), optionally requiring a gap.
 *
 * `minGap` inflates the test by that much on every axis, so a pair merely
 * closer than the cutter buffer reports as colliding and the `mtv` pushes them
 * to exactly the buffer apart. With the default of zero this is plain SAT.
 *
 * When they collide, `mtv` is the shortest translation that moves `a` clear
 * of `b` — apply it to `a` directly, no inversion needed.
 */
export const satCollision = (
  a: readonly Point[],
  b: readonly Point[],
  minGap = 0,
): CollisionResult => {
  if (a.length < 3 || b.length < 3) return NO_COLLISION;

  let smallestOverlap = Number.POSITIVE_INFINITY;
  let smallestAxisX = 0;
  let smallestAxisY = 0;
  let haveAxis = false;

  for (let side = 0; side < 2; side += 1) {
    const edges = side === 0 ? a : b;
    for (let i = 0; i < edges.length; i += 1) {
      const from = edges[i];
      const to = edges[(i + 1) % edges.length];
      if (!from || !to) continue;
      const edgeX = to.x - from.x;
      const edgeY = to.y - from.y;
      const length = Math.hypot(edgeX, edgeY);
      // Duplicate vertices produce a zero-length edge with no meaningful normal.
      if (length === 0) continue;
      const axisX = -edgeY / length;
      const axisY = edgeX / length;

      projectOnto(a, axisX, axisY);
      const minA = projectedMin;
      const maxA = projectedMax;
      projectOnto(b, axisX, axisY);
      const overlap = Math.min(maxA, projectedMax) - Math.max(minA, projectedMin) + minGap;

      // A gap on any axis proves separation — stop immediately. Touching
      // exactly (overlap 0) is not a collision; pieces laid edge to edge are
      // normal.
      if (overlap <= 0) return NO_COLLISION;

      if (overlap < smallestOverlap) {
        smallestOverlap = overlap;
        smallestAxisX = axisX;
        smallestAxisY = axisY;
        haveAxis = true;
      }
    }
  }

  if (!haveAxis) return NO_COLLISION;

  // Axis normals point either way; orient this one away from b so the caller
  // can apply the vector without reasoning about winding order.
  const centreA = centroidOf(a);
  const centreB = centroidOf(b);
  const towardA =
    (centreA.x - centreB.x) * smallestAxisX + (centreA.y - centreB.y) * smallestAxisY;
  const sign = towardA < 0 ? -1 : 1;

  return {
    collides: true,
    mtv: { x: smallestAxisX * smallestOverlap * sign, y: smallestAxisY * smallestOverlap * sign },
  };
};

/**
 * How far apart two convex polygons are. Zero when they touch or overlap.
 *
 * The widest gap over all edge normals: for convex shapes separated along an
 * edge that is their true distance, and for vertex-to-vertex pairs it is an
 * underestimate. Underestimating is the safe direction — a buffer check built
 * on it holds pieces slightly further apart than asked, never closer.
 */
export const separation = (a: readonly Point[], b: readonly Point[]): number => {
  if (a.length < 3 || b.length < 3) return 0;

  let widestGap = 0;
  for (let side = 0; side < 2; side += 1) {
    const edges = side === 0 ? a : b;
    for (let i = 0; i < edges.length; i += 1) {
      const from = edges[i];
      const to = edges[(i + 1) % edges.length];
      if (!from || !to) continue;
      const edgeX = to.x - from.x;
      const edgeY = to.y - from.y;
      const length = Math.hypot(edgeX, edgeY);
      if (length === 0) continue;
      const axisX = -edgeY / length;
      const axisY = edgeX / length;

      projectOnto(a, axisX, axisY);
      const minA = projectedMin;
      const maxA = projectedMax;
      projectOnto(b, axisX, axisY);
      const gap = Math.max(minA, projectedMin) - Math.min(maxA, projectedMax);
      if (gap > widestGap) widestGap = gap;
    }
  }
  return widestGap;
};
