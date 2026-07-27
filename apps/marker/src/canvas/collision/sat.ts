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

/** One normalised outward normal per edge — the candidate separating axes. */
const axesOf = (polygon: readonly Point[]): Point[] => {
  const axes: Point[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const from = polygon[i];
    const to = polygon[(i + 1) % polygon.length];
    if (!from || !to) continue;
    const edgeX = to.x - from.x;
    const edgeY = to.y - from.y;
    const length = Math.hypot(edgeX, edgeY);
    // Duplicate vertices produce a zero-length edge with no meaningful normal.
    if (length === 0) continue;
    axes.push({ x: -edgeY / length, y: edgeX / length });
  }
  return axes;
};

interface Projection {
  min: number;
  max: number;
}

const project = (polygon: readonly Point[], axis: Point): Projection => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of polygon) {
    const value = point.x * axis.x + point.y * axis.y;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
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
 * Test two polygons in marker space (cm).
 *
 * When they overlap, `mtv` is the shortest translation that moves `a` clear
 * of `b` — apply it to `a` directly, no inversion needed.
 */
export const satCollision = (a: readonly Point[], b: readonly Point[]): CollisionResult => {
  if (a.length < 3 || b.length < 3) return NO_COLLISION;

  let smallestOverlap = Number.POSITIVE_INFINITY;
  let smallestAxis: Point | null = null;

  for (const axis of [...axesOf(a), ...axesOf(b)]) {
    const projectionA = project(a, axis);
    const projectionB = project(b, axis);
    const overlap =
      Math.min(projectionA.max, projectionB.max) - Math.max(projectionA.min, projectionB.min);

    // A gap on any axis proves separation — stop immediately. Touching exactly
    // (overlap 0) is not a collision; pieces laid edge to edge are normal.
    if (overlap <= 0) return NO_COLLISION;

    if (overlap < smallestOverlap) {
      smallestOverlap = overlap;
      smallestAxis = axis;
    }
  }

  if (!smallestAxis) return NO_COLLISION;

  // Axis normals point either way; orient this one away from b so the caller
  // can apply the vector without reasoning about winding order.
  const centreA = centroidOf(a);
  const centreB = centroidOf(b);
  const towardA =
    (centreA.x - centreB.x) * smallestAxis.x + (centreA.y - centreB.y) * smallestAxis.y;
  const sign = towardA < 0 ? -1 : 1;

  return {
    collides: true,
    mtv: { x: smallestAxis.x * smallestOverlap * sign, y: smallestAxis.y * smallestOverlap * sign },
  };
};
