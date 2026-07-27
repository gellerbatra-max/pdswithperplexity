/**
 * Turning DXF polylines into closed contours.
 *
 * Two jobs: expanding bulge arcs into points, and stitching the open segments
 * a CAD system emits back into the loops a piece outline actually is.
 *
 * Pure: input in, geometry out.
 */

import type { Point } from '@/marker/schema';

export interface VertexWithBulge {
  readonly x: number;
  readonly y: number;
  /** tan(included angle / 4). Zero is a straight segment. */
  readonly bulge: number;
}

export interface Path {
  readonly points: Point[];
  readonly closed: boolean;
}

/** Ends closer than this are the same point. Half a millimetre in cm units. */
export const JOIN_TOLERANCE = 0.05;

/** Arc segments per full circle. Enough that a 5 cm armhole reads as a curve. */
const SEGMENTS_PER_TURN = 64;

const MIN_BULGE = 1e-9;

/**
 * Expand one bulged span into points, excluding the end vertex.
 *
 * The DXF bulge is tan(θ/4) where θ is the arc's included angle, signed:
 * positive sweeps counter-clockwise.
 */
export const tessellateBulge = (from: Point, to: Point, bulge: number): Point[] => {
  if (Math.abs(bulge) < MIN_BULGE) return [from];

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chord = Math.hypot(dx, dy);
  if (chord === 0) return [from];

  const included = 4 * Math.atan(bulge);
  const radius = chord / (2 * Math.sin(included / 2));

  // Centre sits off the chord midpoint along its left normal; the cosine
  // carries the sign, so a reflex arc puts the centre on the other side.
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const offset = radius * Math.cos(included / 2);
  const centreX = midX - (dy / chord) * offset;
  const centreY = midY + (dx / chord) * offset;

  const startAngle = Math.atan2(from.y - centreY, from.x - centreX);
  const steps = Math.max(2, Math.ceil((Math.abs(included) / (2 * Math.PI)) * SEGMENTS_PER_TURN));

  // startAngle already points at `from`, and the sweep sign carries the
  // direction, so the radius here is a magnitude only.
  const spokeLength = Math.abs(radius);

  const points: Point[] = [];
  for (let step = 0; step < steps; step += 1) {
    const angle = startAngle + (included * step) / steps;
    points.push({
      x: centreX + spokeLength * Math.cos(angle),
      y: centreY + spokeLength * Math.sin(angle),
    });
  }
  return points;
};

/** Expand a whole vertex list, honouring each vertex's bulge. */
export const expandVertices = (vertices: readonly VertexWithBulge[], closed: boolean): Point[] => {
  if (vertices.length === 0) return [];

  const points: Point[] = [];
  const last = vertices.length - (closed ? 0 : 1);

  for (let i = 0; i < last; i += 1) {
    const from = vertices[i];
    const to = vertices[(i + 1) % vertices.length];
    if (!from || !to) continue;
    points.push(...tessellateBulge({ x: from.x, y: from.y }, { x: to.x, y: to.y }, from.bulge));
  }

  if (!closed) {
    const tail = vertices[vertices.length - 1];
    if (tail) points.push({ x: tail.x, y: tail.y });
  }

  return points;
};

const near = (a: Point, b: Point, tolerance: number): boolean =>
  Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;

const reverse = (points: readonly Point[]): Point[] => [...points].reverse();

const endsOf = (path: readonly Point[]): { head: Point; tail: Point } | null => {
  const head = path[0];
  const tail = path[path.length - 1];
  if (!head || !tail) return null;
  return { head, tail };
};

/**
 * Stitch open paths into closed loops.
 *
 * A pattern piece leaves CAD as a scatter of unordered LINE and LWPOLYLINE
 * segments that happen to meet at their ends. This walks each chain to
 * exhaustion, joining whichever remaining path starts or ends where the
 * current one stopped, and reversing it when only its tail matches.
 *
 * Chains that never close are returned as-is: the caller decides whether an
 * unclosed run is a notch, a grain line, or a broken piece.
 */
export const chainPaths = (paths: readonly Path[], tolerance = JOIN_TOLERANCE): Path[] => {
  const closed: Path[] = paths.filter((path) => path.closed && path.points.length >= 3);
  const open = paths
    .filter((path) => !path.closed && path.points.length >= 2)
    .map((path) => [...path.points]);

  const results: Path[] = [...closed];
  const consumed = new Set<number>();

  for (let i = 0; i < open.length; i += 1) {
    if (consumed.has(i)) continue;
    const start = open[i];
    if (!start) continue;

    consumed.add(i);
    let chain = [...start];

    let extended = true;
    while (extended) {
      extended = false;
      const ends = endsOf(chain);
      if (!ends) break;

      // Already a loop — stop before swallowing an unrelated segment.
      if (chain.length >= 3 && near(ends.head, ends.tail, tolerance)) break;

      for (let j = 0; j < open.length; j += 1) {
        if (consumed.has(j)) continue;
        const candidate = open[j];
        if (!candidate) continue;
        const candidateEnds = endsOf(candidate);
        if (!candidateEnds) continue;

        if (near(ends.tail, candidateEnds.head, tolerance)) {
          chain = [...chain, ...candidate.slice(1)];
        } else if (near(ends.tail, candidateEnds.tail, tolerance)) {
          chain = [...chain, ...reverse(candidate).slice(1)];
        } else if (near(ends.head, candidateEnds.tail, tolerance)) {
          chain = [...candidate.slice(0, -1), ...chain];
        } else if (near(ends.head, candidateEnds.head, tolerance)) {
          chain = [...reverse(candidate).slice(0, -1), ...chain];
        } else {
          continue;
        }

        consumed.add(j);
        extended = true;
        break;
      }
    }

    const ends = endsOf(chain);
    const isClosed = ends !== null && chain.length >= 3 && near(ends.head, ends.tail, tolerance);
    // A closed ring should not repeat its first point.
    if (isClosed) chain.pop();

    results.push({ points: chain, closed: isClosed });
  }

  return results;
};

/** Enclosed area via the shoelace formula. Always positive. */
export const areaOf = (points: readonly Point[]): number => {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if (a && b) sum += (b.x + a.x) * (b.y - a.y);
  }
  return Math.abs(sum / 2);
};
