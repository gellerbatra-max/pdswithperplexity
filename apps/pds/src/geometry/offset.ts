import type { Vec2 } from './types';

/**
 * Polygon offsetting — the real thing, not a widened stroke.
 *
 * A stroke centred on the outline covers `d` on both sides and mitres nothing;
 * an offset produces a genuine second curve at distance `d` on one side, which
 * is what a cut line is. This module produces that curve, and it is the input a
 * DXF writer would need.
 *
 * The algorithm is the standard one for a single closed ring:
 *
 *   1. Normalise the ring — drop repeated points, force a known winding.
 *   2. Push every edge along its outward normal.
 *   3. Join consecutive offset edges: mitre where the join is not too sharp,
 *      bevel where it is.
 *   4. Remove the self-intersections that step 3 creates at reflex corners,
 *      by trimming loops as they close.
 *   5. Drop anything left that sits closer to the source than it should.
 *
 * Steps 4 and 5 are what separate this from a naive per-edge push. Offsetting
 * outward past the local radius of curvature of a concave region *must*
 * self-intersect — the loop is real, and it has to be cut out rather than
 * drawn.
 *
 * ## Limits, stated plainly
 *
 * - **One ring in, one ring out.** Outward offset of a simple closed polygon
 *   stays connected, which is the case seam allowance needs. Inward offset can
 *   split a shape into several rings or annihilate it; this returns an empty
 *   array rather than pretending, so callers must handle `[]`.
 * - **Input must be a simple (non-self-intersecting) closed polygon.** Pattern
 *   outlines are; a self-intersecting source is not detected and the result is
 *   undefined.
 * - **Joins are mitre or bevel, never round.** For a flattened curve the
 *   difference is far below plotting tolerance because the sample angles are
 *   tiny. It is visible only at a true hard corner with a very sharp angle,
 *   where the bevel reads as a small chamfer instead of an arc.
 * - **The output is a polyline, not curves.** It is sampled at the density of
 *   the input flattening. Re-fitting Béziers through it is a separate job, and
 *   is what an exporter emitting curve entities would need.
 */

/** Distance below which two points are treated as the same point. */
const EPSILON = 1e-9;

/**
 * How far a mitre may extend, as a multiple of the offset distance, before it
 * is bevelled instead. 2 is a common default: it keeps ordinary corners sharp
 * and only chamfers genuinely spiky ones, where an unbounded mitre would shoot
 * off far from the shape.
 */
const MITRE_LIMIT = 2;

/**
 * How much closer than `distance` a vertex may sit to the source before it is
 * treated as invalid leftover. Slack is needed because the source is itself a
 * sampled approximation of a curve, so exact-distance tests would erode
 * legitimate geometry on tightly curved sections.
 */
const PROXIMITY_TOLERANCE = 0.999;

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

/** Twice the signed area. Sign gives winding; magnitude is unused here. */
const signedArea2 = (ring: readonly Vec2[]): number => {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (!a || !b) continue;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
};

/** Drops consecutive duplicates and any repeated closing point. */
const clean = (ring: readonly Vec2[]): Vec2[] => {
  const out: Vec2[] = [];
  for (const point of ring) {
    const last = out[out.length - 1];
    if (last && Math.hypot(point.x - last.x, point.y - last.y) <= EPSILON) continue;
    out.push(point);
  }
  while (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first && last && Math.hypot(first.x - last.x, first.y - last.y) <= EPSILON) out.pop();
    else break;
  }
  return out;
};

/** Distance from `p` to the segment `a`–`b`. */
const distanceToSegment = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
};

/** Axis-aligned bounding box of a point set. */
const boundsOf = (points: readonly Vec2[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};

/**
 * Rough average spacing between consecutive points, from the point count and
 * the bounding-box diagonal. Used only to size grid cells: it does not need to
 * be exact, just the right order of magnitude so each cell holds a handful of
 * edges rather than one or thousands.
 */
const averageSpacing = (points: readonly Vec2[]): number => {
  if (points.length < 2) return 1;
  const { minX, minY, maxX, maxY } = boundsOf(points);
  const diagonal = Math.hypot(maxX - minX, maxY - minY);
  if (diagonal <= EPSILON) return 1;
  return diagonal / Math.sqrt(points.length);
};

/**
 * Uniform grid over 2D segments, keyed by every cell each segment's bounding
 * box touches.
 *
 * Both self-intersection trimming and the proximity filter below are, at
 * heart, "what else is near this edge / point" queries. A brute-force answer
 * checks every earlier edge; the loops this module removes are local in
 * space (an offset can only fold back on itself within roughly its own
 * distance), so a grid sized to that locality turns the same query into a
 * lookup of a handful of buckets instead of a scan of everything accepted so
 * far. Segments are inserted and removed by an integer id so the ring being
 * trimmed can evict edges that a later cut discards.
 */
class SegmentGrid {
  private readonly cellSize: number;
  private readonly cells = new Map<string, Set<number>>();
  private readonly occupies = new Map<number, readonly string[]>();

  constructor(cellSize: number) {
    this.cellSize = cellSize > EPSILON ? cellSize : 1;
  }

  private keysFor(minX: number, minY: number, maxX: number, maxY: number): string[] {
    const ixMin = Math.floor(minX / this.cellSize);
    const ixMax = Math.floor(maxX / this.cellSize);
    const iyMin = Math.floor(minY / this.cellSize);
    const iyMax = Math.floor(maxY / this.cellSize);
    const keys: string[] = [];
    for (let ix = ixMin; ix <= ixMax; ix += 1) {
      for (let iy = iyMin; iy <= iyMax; iy += 1) {
        keys.push(`${ix}:${iy}`);
      }
    }
    return keys;
  }

  insert(id: number, a: Vec2, b: Vec2): void {
    const keys = this.keysFor(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y));
    for (const key of keys) {
      let bucket = this.cells.get(key);
      if (!bucket) {
        bucket = new Set();
        this.cells.set(key, bucket);
      }
      bucket.add(id);
    }
    this.occupies.set(id, keys);
  }

  remove(id: number): void {
    const keys = this.occupies.get(id);
    if (!keys) return;
    for (const key of keys) {
      const bucket = this.cells.get(key);
      if (!bucket) continue;
      bucket.delete(id);
      if (bucket.size === 0) this.cells.delete(key);
    }
    this.occupies.delete(id);
  }

  /** Every inserted id whose cell footprint overlaps the given box. */
  query(minX: number, minY: number, maxX: number, maxY: number): Set<number> {
    const found = new Set<number>();
    for (const key of this.keysFor(minX, minY, maxX, maxY)) {
      const bucket = this.cells.get(key);
      if (!bucket) continue;
      for (const id of bucket) found.add(id);
    }
    return found;
  }

  /** Every inserted id within `radiusCells` grid cells of `p` (Chebyshev, not Euclidean). */
  queryAround(p: Vec2, radiusCells: number): Set<number> {
    const cx = Math.floor(p.x / this.cellSize);
    const cy = Math.floor(p.y / this.cellSize);
    const found = new Set<number>();
    for (let ix = cx - radiusCells; ix <= cx + radiusCells; ix += 1) {
      for (let iy = cy - radiusCells; iy <= cy + radiusCells; iy += 1) {
        const bucket = this.cells.get(`${ix}:${iy}`);
        if (!bucket) continue;
        for (const id of bucket) found.add(id);
      }
    }
    return found;
  }
}

/**
 * Proper crossing point of two segments, or null.
 *
 * Endpoint touches and collinear overlaps deliberately return null: in loop
 * trimming, consecutive edges always share an endpoint, and treating that as a
 * crossing would cut the ring apart at every vertex.
 */
const intersectSegments = (a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null => {
  const rx = a2.x - a1.x;
  const ry = a2.y - a1.y;
  const sx = b2.x - b1.x;
  const sy = b2.y - b1.y;

  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) <= EPSILON) return null;

  const t = ((b1.x - a1.x) * sy - (b1.y - a1.y) * sx) / denominator;
  const u = ((b1.x - a1.x) * ry - (b1.y - a1.y) * rx) / denominator;

  if (t <= EPSILON || t >= 1 - EPSILON || u <= EPSILON || u >= 1 - EPSILON) return null;
  return { x: a1.x + rx * t, y: a1.y + ry * t };
};

/**
 * Removes self-intersections by trimming each loop at the moment it closes.
 *
 * Walking the raw ring, whenever the newest edge crosses an edge already
 * accepted, everything between the two is a loop: it is discarded and replaced
 * by the crossing point. This is the step that turns an overlapping naive
 * offset into a simple ring.
 *
 * A `SegmentGrid` stands in for the brute-force "every earlier edge" scan.
 * It holds every accepted edge except the one immediately before `current` —
 * exactly the set the original scan considered, since that edge shares an
 * endpoint with the new one by construction and can never produce a real
 * crossing. Right before each new point is appended, the edge that is about
 * to stop being "immediately preceding" is inserted; when a cut discards a
 * span of the ring, the same span is evicted from the grid. Candidates within
 * a matching cell are still verified with the exact `intersectSegments` test
 * and, when several match, the earliest one wins — a grid cell is a
 * proximity filter, not a substitute for the real test, so this produces the
 * same ring the O(n²) version did, just without visiting edges nowhere near
 * the new one.
 */
const trimLoops = (ring: readonly Vec2[]): Vec2[] => {
  const out: Vec2[] = [];
  const grid = new SegmentGrid(averageSpacing(ring));

  for (const next of ring) {
    const current = out[out.length - 1];
    if (!current) {
      out.push(next);
      continue;
    }

    const candidates = grid.query(
      Math.min(current.x, next.x),
      Math.min(current.y, next.y),
      Math.max(current.x, next.x),
      Math.max(current.y, next.y),
    );

    let cutAt = -1;
    let cutPoint: Vec2 | null = null;

    if (candidates.size > 0) {
      for (const i of [...candidates].sort((a, b) => a - b)) {
        const a = out[i];
        const b = out[i + 1];
        if (!a || !b) continue;
        const hit = intersectSegments(current, next, a, b);
        if (hit) {
          cutAt = i;
          cutPoint = hit;
          break;
        }
      }
    }

    if (cutPoint && cutAt >= 0) {
      for (let i = cutAt; i <= out.length - 2; i += 1) grid.remove(i);
      out.length = cutAt + 1;
      out.push(cutPoint);
    }

    // The edge ending at `current` is about to stop being "immediately
    // preceding" once `next` lands, so it joins the grid now.
    const pendingIndex = out.length - 2;
    const pendingA = out[pendingIndex];
    const pendingB = out[pendingIndex + 1];
    if (pendingIndex >= 0 && pendingA && pendingB) grid.insert(pendingIndex, pendingA, pendingB);

    out.push(next);
  }

  return out;
};

export interface OffsetOptions {
  /**
   * Per-edge distances, parallel to the input ring: entry `i` applies to the
   * edge leaving vertex `i`. Lets one outline carry different allowances on
   * different seams, which is how real pieces are specified. Falls back to the
   * scalar `distance` when absent.
   */
  readonly distances?: readonly number[];
}

/**
 * Offsets a closed ring outward by `distance` (millimetres, like all geometry
 * here). Negative distances offset inward.
 *
 * Returns `[]` when the input is degenerate or the offset consumes the shape.
 * Callers must treat that as "no allowance to draw", not as an error.
 */
export const offsetRing = (
  source: readonly Vec2[],
  distance: number,
  options: OffsetOptions = {},
): Vec2[] => {
  const ring = clean(source);
  if (ring.length < 3) return [];

  // Force a consistent winding so "outward" has one meaning. With positive
  // signed area the interior lies to the left of each directed edge, so the
  // rightward normal (dy, -dx) points out.
  const reversed = signedArea2(ring) < 0;
  const oriented = reversed ? [...ring].reverse() : ring;
  const distances = options.distances
    ? reversed
      ? [...options.distances].reverse()
      : options.distances
    : undefined;

  const count = oriented.length;

  /** Offset endpoints of every edge, kept per-edge so joins can be built. */
  const edges: { readonly a: Vec2; readonly b: Vec2; readonly d: number }[] = [];

  for (let i = 0; i < count; i += 1) {
    const a = oriented[i];
    const b = oriented[(i + 1) % count];
    if (!a || !b) continue;

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length <= EPSILON) continue;

    const d = distances?.[i] ?? distance;
    const nx = (dy / length) * d;
    const ny = (-dx / length) * d;

    edges.push({
      a: { x: a.x + nx, y: a.y + ny },
      b: { x: b.x + nx, y: b.y + ny },
      d,
    });
  }

  if (edges.length < 3) return [];

  // Join consecutive offset edges. Where they meet cleanly the mitre point is
  // used; where the mitre would spike, both endpoints are emitted instead,
  // which is a bevel.
  const raw: Vec2[] = [];

  for (let i = 0; i < edges.length; i += 1) {
    const previous = edges[(i - 1 + edges.length) % edges.length];
    const current = edges[i];
    if (!previous || !current) continue;

    const mitre = intersectLines(previous.a, previous.b, current.a, current.b);
    const limit = Math.abs(current.d) * MITRE_LIMIT;

    if (mitre && Math.hypot(mitre.x - current.a.x, mitre.y - current.a.y) <= limit) {
      raw.push(mitre);
    } else {
      raw.push(previous.b, current.a);
    }
  }

  const trimmed = trimLoops(clean(raw));
  if (trimmed.length < 3) return [];

  // Anything still sitting closer to the source than the allowance is leftover
  // from a region that folded over itself and did not produce a crossing.
  //
  // A brute-force check tests every trimmed point against every source edge.
  // Cells are sized to at least the threshold distance, so anything within
  // range of a point sits in that point's cell or its immediate neighbours —
  // a 5×5 block (one cell of margin either side) is enough to catch it, which
  // turns the scan from every point against every edge into every point
  // against a small, bounded neighbourhood.
  const threshold = Math.abs(distance) * PROXIMITY_TOLERANCE;
  const proximityGrid = new SegmentGrid(Math.max(threshold, averageSpacing(oriented), EPSILON));
  for (let i = 0; i < oriented.length; i += 1) {
    const a = oriented[i];
    const b = oriented[(i + 1) % oriented.length];
    if (a && b) proximityGrid.insert(i, a, b);
  }
  const isFarEnough = (p: Vec2): boolean => {
    for (const i of proximityGrid.queryAround(p, 2)) {
      const a = oriented[i];
      const b = oriented[(i + 1) % oriented.length];
      if (a && b && distanceToSegment(p, a, b) < threshold) return false;
    }
    return true;
  };
  const kept = trimmed.filter(isFarEnough);

  const result = clean(kept);
  if (result.length < 3) return [];

  return reversed ? result.reverse() : result;
};

/** Infinite-line intersection, used for mitre joins. Null when parallel. */
const intersectLines = (a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): Vec2 | null => {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) <= EPSILON) return null;
  const t = ((b1.x - a1.x) * s.y - (b1.y - a1.y) * s.x) / denominator;
  return { x: a1.x + r.x * t, y: a1.y + r.y * t };
};
