import type { Vec2 } from '@/geometry';

/**
 * Segment geometry — how a segment gets from its start point to its end point.
 *
 * A discriminated union so new curve families (conic, NURBS, offset-of) can be
 * added without changing any existing member. Endpoints are never stored here;
 * they live on the segment as point references, so moving a point updates every
 * segment that touches it.
 */

export interface LineGeometry {
  readonly kind: 'line';
}

/** Cubic Bézier. Control handles are absolute positions in piece space. */
export interface CubicGeometry {
  readonly kind: 'cubic';
  readonly control1: Vec2;
  readonly control2: Vec2;
}

/** Circular arc, described the way SVG does — endpoints come from the segment. */
export interface ArcGeometry {
  readonly kind: 'arc';
  readonly radius: number;
  readonly largeArc: boolean;
  readonly clockwise: boolean;
}

export type SegmentGeometry = LineGeometry | CubicGeometry | ArcGeometry;

export const LINE: LineGeometry = { kind: 'line' };

/**
 * Default flattening resolution.
 *
 * TODO(geometry-editing): make this adaptive. A fixed 16 samples over-samples
 * short segments and visibly faceted long ones; flatness-based subdivision
 * would fix both and cut hit-test cost. See DEVELOPMENT.md.
 */
export const FLATTEN_STEPS = 16;

const cubicAt = (a: Vec2, c1: Vec2, c2: Vec2, b: Vec2, t: number): Vec2 => {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: a.x * w0 + c1.x * w1 + c2.x * w2 + b.x * w3,
    y: a.y * w0 + c1.y * w1 + c2.y * w2 + b.y * w3,
  };
};

/**
 * Point on a segment at parameter `t` (0 at `from`, 1 at `to`).
 * Used for notch placement and measurement sampling.
 */
export const pointOnSegment = (
  from: Vec2,
  to: Vec2,
  geometry: SegmentGeometry,
  t: number,
): Vec2 => {
  switch (geometry.kind) {
    case 'cubic':
      return cubicAt(from, geometry.control1, geometry.control2, to, t);
    case 'arc':
    case 'line':
    default:
      // Arcs fall back to the chord until an arc solver lands.
      return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  }
};

/**
 * Flatten a segment to a polyline. Excludes `from` and includes `to`, so
 * consecutive segments concatenate without duplicating shared endpoints.
 */
export const flattenSegment = (
  from: Vec2,
  to: Vec2,
  geometry: SegmentGeometry,
  steps: number = FLATTEN_STEPS,
): Vec2[] => {
  if (geometry.kind === 'line') return [to];
  const out: Vec2[] = [];
  for (let i = 1; i <= steps; i += 1) {
    out.push(pointOnSegment(from, to, geometry, i / steps));
  }
  return out;
};
