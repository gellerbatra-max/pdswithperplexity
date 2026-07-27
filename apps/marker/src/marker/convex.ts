/**
 * Convex decomposition.
 *
 * SAT — the collision narrow phase — is only sound for convex polygons, and
 * garment pieces are routinely concave: armholes, crotch curves, notched hems.
 * Tested as a single outline, a concave piece reports a collision across the
 * hollow even when the pieces are clear, and nesting leaves fabric behind.
 *
 * Splitting happens at import because that is where a piece is first built,
 * and the cost is paid once per file instead of once per drag event.
 *
 * This is ear-clipping into triangles followed by a greedy merge of adjacent
 * parts that stay convex. Not an optimal decomposition — Hertel-Mehlhorn or
 * Keil would produce fewer parts — but it is O(n²) with no dependencies, and
 * for the few hundred vertices a tessellated piece carries that is immaterial.
 *
 * Pure: input in, parts out.
 */

import type { Point } from '@/marker/schema';

/** Below this, an angle is treated as straight rather than reflex. */
const EPSILON = 1e-9;

const cross = (o: Point, a: Point, b: Point): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Signed area — positive when the ring winds counter-clockwise. */
export const signedArea = (points: readonly Point[]): number => {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if (a && b) sum += (b.x + a.x) * (b.y - a.y);
  }
  return -sum / 2;
};

export const isConvex = (points: readonly Point[]): boolean => {
  if (points.length < 4) return true;
  let sign = 0;
  for (let i = 0; i < points.length; i += 1) {
    const o = points[i];
    const a = points[(i + 1) % points.length];
    const b = points[(i + 2) % points.length];
    if (!o || !a || !b) continue;
    const turn = cross(o, a, b);
    if (Math.abs(turn) < EPSILON) continue;
    const current = turn > 0 ? 1 : -1;
    if (sign === 0) sign = current;
    else if (sign !== current) return false;
  }
  return true;
};

const pointInTriangle = (p: Point, a: Point, b: Point, c: Point): boolean => {
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  const hasNegative = d1 < -EPSILON || d2 < -EPSILON || d3 < -EPSILON;
  const hasPositive = d1 > EPSILON || d2 > EPSILON || d3 > EPSILON;
  return !(hasNegative && hasPositive);
};

/**
 * Ear clipping. Expects a counter-clockwise ring with no holes.
 *
 * Returns an empty list if the ring is degenerate or self-intersecting — the
 * caller falls back to the outline and warns, rather than emitting garbage
 * that would silently corrupt collision.
 */
const earClip = (ring: readonly Point[]): Point[][] => {
  const indices = ring.map((_, index) => index);
  const triangles: Point[][] = [];

  // Each successful clip removes one vertex; the guard catches a ring that
  // cannot be reduced, which means it was not a simple polygon.
  let guard = indices.length * indices.length;

  while (indices.length > 3 && guard-- > 0) {
    let clipped = false;

    for (let i = 0; i < indices.length; i += 1) {
      const prevIndex = indices[(i + indices.length - 1) % indices.length];
      const currIndex = indices[i];
      const nextIndex = indices[(i + 1) % indices.length];
      if (prevIndex === undefined || currIndex === undefined || nextIndex === undefined) continue;

      const prev = ring[prevIndex];
      const curr = ring[currIndex];
      const next = ring[nextIndex];
      if (!prev || !curr || !next) continue;

      // Reflex corners cannot be ears.
      if (cross(prev, curr, next) <= EPSILON) continue;

      let containsOther = false;
      for (const otherIndex of indices) {
        if (otherIndex === prevIndex || otherIndex === currIndex || otherIndex === nextIndex) {
          continue;
        }
        const other = ring[otherIndex];
        if (other && pointInTriangle(other, prev, curr, next)) {
          containsOther = true;
          break;
        }
      }
      if (containsOther) continue;

      triangles.push([prev, curr, next]);
      indices.splice(i, 1);
      clipped = true;
      break;
    }

    if (!clipped) return [];
  }

  if (indices.length === 3) {
    const [a, b, c] = indices;
    if (a !== undefined && b !== undefined && c !== undefined) {
      const pa = ring[a];
      const pb = ring[b];
      const pc = ring[c];
      if (pa && pb && pc) triangles.push([pa, pb, pc]);
    }
  }

  return triangles;
};

const sharedEdge = (a: readonly Point[], b: readonly Point[]): [number, number] | null => {
  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    if (!a1 || !a2) continue;
    for (let j = 0; j < b.length; j += 1) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (!b1 || !b2) continue;
      // Shared edges run in opposite directions on adjacent parts.
      if (a1.x === b2.x && a1.y === b2.y && a2.x === b1.x && a2.y === b1.y) return [i, j];
    }
  }
  return null;
};

const mergeAcross = (a: readonly Point[], b: readonly Point[], at: [number, number]): Point[] => {
  const [i, j] = at;
  const merged: Point[] = [];
  for (let k = 1; k <= a.length; k += 1) {
    const point = a[(i + k) % a.length];
    if (point) merged.push(point);
  }
  for (let k = 1; k < b.length; k += 1) {
    const point = b[(j + k) % b.length];
    if (point) merged.push(point);
  }
  // Drop the duplicated endpoints the shared edge leaves behind.
  return merged.filter(
    (point, index) =>
      index === 0 ||
      point.x !== merged[index - 1]?.x ||
      point.y !== merged[index - 1]?.y,
  );
};

export interface Decomposition {
  readonly parts: Point[][];
  /** False when the outline could not be split and is used whole. */
  readonly ok: boolean;
}

/**
 * Split a polygon into convex parts.
 *
 * A convex input comes straight back as one part. A decomposition that fails
 * returns the original outline with `ok: false`, so collision still works —
 * conservatively, and with a warning — rather than not at all.
 */
export const decompose = (outline: readonly Point[]): Decomposition => {
  if (outline.length < 3) return { parts: [], ok: false };
  if (isConvex(outline)) return { parts: [[...outline]], ok: true };

  // Ear clipping wants a counter-clockwise ring.
  const ring = signedArea(outline) < 0 ? [...outline].reverse() : [...outline];

  const triangles = earClip(ring);
  if (triangles.length === 0) return { parts: [[...outline]], ok: false };

  const parts: Point[][] = triangles.map((triangle) => [...triangle]);

  // Greedy merge: repeatedly fuse any adjacent pair whose union stays convex.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < parts.length; i += 1) {
      for (let j = i + 1; j < parts.length; j += 1) {
        const a = parts[i];
        const b = parts[j];
        if (!a || !b) continue;
        const edge = sharedEdge(a, b);
        if (!edge) continue;

        const candidate = mergeAcross(a, b, edge);
        if (candidate.length < 3 || !isConvex(candidate)) continue;

        parts.splice(j, 1);
        parts.splice(i, 1, candidate);
        merged = true;
        break outer;
      }
    }
  }

  return { parts, ok: true };
};
