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
 * How far a flattened polyline may deviate from the true curve, in millimetres.
 *
 * 0.1 mm is well under plotting and cutting resolution, and an order of
 * magnitude finer than any tolerance on a spec sheet. Subdivision is adaptive,
 * so this buys accuracy on long sweeping curves without paying for it on the
 * short ones — the opposite of a fixed step count, which did both badly.
 */
export const FLATTEN_TOLERANCE_MM = 0.1;

/** Stops pathological curves (cusps, coincident controls) subdividing forever. */
const MAX_FLATTEN_DEPTH = 16;

/* --- Arcs ------------------------------------------------------------------- *
 *
 * An arc is stored SVG-style — radius plus two flags, endpoints coming from the
 * segment — because that is the form DXF and SVG both hand over, so an importer
 * can drop one in without re-deriving anything.
 *
 * Everything below works from the *centre* form, resolved on demand. Unlike a
 * cubic, an arc is exactly solvable: its length is r·Δθ, the closest point on it
 * is an angle clamp, and splitting it is splitting an angle. Nothing here
 * approximates, which is why arcs are worth supporting properly rather than
 * quietly treating as their chord.                                             */

interface ArcCentre {
  readonly centre: Vec2;
  readonly radius: number;
  /** Angle at the start endpoint. */
  readonly start: number;
  /** Signed angle swept to the end endpoint; sign carries the direction. */
  readonly sweep: number;
}

/**
 * Endpoint form → centre form, following the SVG conversion.
 *
 * Returns null when the endpoints coincide: there is no unique circle through a
 * single point, and callers degrade to the chord rather than inventing one.
 *
 * A radius too small to span the chord is enlarged to exactly half the chord —
 * the same repair SVG mandates. Silently drawing a straight line instead would
 * be the alternative, and that is the class of quiet wrongness this file exists
 * to avoid.
 */
const arcCentre = (from: Vec2, to: Vec2, geometry: ArcGeometry): ArcCentre | null => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-12) return null;

  const radius = Math.max(Math.abs(geometry.radius), chord / 2);

  // Perpendicular offset from the chord midpoint to the centre.
  const height = Math.sqrt(Math.max(0, radius * radius - (chord / 2) * (chord / 2)));
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const normalX = -dy / chord;
  const normalY = dx / chord;

  // Of the two candidate centres, the flags pick one: a large arc and a
  // clockwise sweep land on opposite sides, so agreeing flags cancel out.
  const side = geometry.largeArc === geometry.clockwise ? -1 : 1;
  const centre = {
    x: midX + side * height * normalX,
    y: midY + side * height * normalY,
  };

  const start = Math.atan2(from.y - centre.y, from.x - centre.x);
  const end = Math.atan2(to.y - centre.y, to.x - centre.x);

  let sweep = end - start;
  const TWO_PI = Math.PI * 2;
  if (geometry.clockwise) {
    while (sweep <= 0) sweep += TWO_PI;
  } else {
    while (sweep >= 0) sweep -= TWO_PI;
  }

  return { centre, radius, start, sweep };
};

const arcPoint = (arc: ArcCentre, t: number): Vec2 => {
  const angle = arc.start + arc.sweep * t;
  return {
    x: arc.centre.x + arc.radius * Math.cos(angle),
    y: arc.centre.y + arc.radius * Math.sin(angle),
  };
};

/**
 * Centre form of a segment's arc, for consumers that need the circle itself —
 * the renderer draws with `ctx.arc` rather than a polyline. Null when the
 * geometry is not an arc, or is degenerate.
 */
export const resolveArc = (
  from: Vec2,
  to: Vec2,
  geometry: SegmentGeometry,
): ArcCentre | null => (geometry.kind === 'arc' ? arcCentre(from, to, geometry) : null);

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

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export interface SplitResult {
  /** Coordinate at `t` — the new point sits here. */
  readonly at: Vec2;
  readonly left: SegmentGeometry;
  readonly right: SegmentGeometry;
}

/**
 * Splits a segment at parameter `t` into two that together trace exactly the
 * original.
 *
 * For a cubic this is de Casteljau subdivision, which is exact — not a re-fit
 * and not an approximation. That matters: inserting a point on a curved edge
 * must not move the edge. If the outline shifts when you add a point, every
 * measurement taken off it shifts too, and the pattern quietly stops matching
 * the spec sheet. The self-check for this is that piece perimeter is unchanged
 * to floating-point noise after an insert.
 *
 * An arc splits exactly too: both halves keep the radius and direction, and
 * only `largeArc` is recomputed, since either half may now be the short way
 * round. Splitting an arc used to return two straight lines, which silently
 * replaced a curve with its chord the moment a point was inserted on it.
 */
export const splitSegment = (
  from: Vec2,
  to: Vec2,
  geometry: SegmentGeometry,
  t: number,
): SplitResult => {
  if (geometry.kind === 'arc') {
    const arc = arcCentre(from, to, geometry);
    if (!arc) return { at: lerp(from, to, t), left: LINE, right: LINE };
    const at = arcPoint(arc, t);
    const half = (fraction: number): SegmentGeometry => ({
      kind: 'arc',
      radius: arc.radius,
      largeArc: Math.abs(arc.sweep * fraction) > Math.PI,
      clockwise: geometry.clockwise,
    });
    return { at, left: half(t), right: half(1 - t) };
  }

  if (geometry.kind !== 'cubic') {
    return { at: lerp(from, to, t), left: LINE, right: LINE };
  }

  // de Casteljau: repeatedly interpolate the control polygon at t. The points
  // dropping out of each round are the control points of the two halves.
  const a = lerp(from, geometry.control1, t);
  const b = lerp(geometry.control1, geometry.control2, t);
  const c = lerp(geometry.control2, to, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  const at = lerp(d, e, t);

  return {
    at,
    left: { kind: 'cubic', control1: a, control2: d },
    right: { kind: 'cubic', control1: e, control2: c },
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
    case 'arc': {
      const arc = arcCentre(from, to, geometry);
      // Only a degenerate arc — coincident endpoints — falls back to the chord.
      return arc ? arcPoint(arc, t) : lerp(from, to, t);
    }
    case 'line':
    default:
      return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  }
};

/** First derivative of a cubic — the tangent, unnormalised. */
const cubicTangent = (a: Vec2, c1: Vec2, c2: Vec2, b: Vec2, t: number): Vec2 => {
  const u = 1 - t;
  const w0 = 3 * u * u;
  const w1 = 6 * u * t;
  const w2 = 3 * t * t;
  return {
    x: w0 * (c1.x - a.x) + w1 * (c2.x - c1.x) + w2 * (b.x - c2.x),
    y: w0 * (c1.y - a.y) + w1 * (c2.y - c1.y) + w2 * (b.y - c2.y),
  };
};

/** Second derivative of a cubic, needed by the Newton step in `nearestOnSegment`. */
const cubicCurvature = (a: Vec2, c1: Vec2, c2: Vec2, b: Vec2, t: number): Vec2 => {
  const u = 1 - t;
  return {
    x: 6 * u * (c2.x - 2 * c1.x + a.x) + 6 * t * (b.x - 2 * c2.x + c1.x),
    y: 6 * u * (c2.y - 2 * c1.y + a.y) + 6 * t * (b.y - 2 * c2.y + c1.y),
  };
};

/** Tangent at `t`. Straight geometry has a constant tangent along its chord. */
export const tangentOnSegment = (
  from: Vec2,
  to: Vec2,
  geometry: SegmentGeometry,
  t: number,
): Vec2 => {
  if (geometry.kind === 'cubic') {
    return cubicTangent(from, geometry.control1, geometry.control2, to, t);
  }
  if (geometry.kind === 'arc') {
    const arc = arcCentre(from, to, geometry);
    if (arc) {
      const angle = arc.start + arc.sweep * t;
      return {
        x: -arc.radius * Math.sin(angle) * arc.sweep,
        y: arc.radius * Math.cos(angle) * arc.sweep,
      };
    }
  }
  return { x: to.x - from.x, y: to.y - from.y };
};

/**
 * Largest distance from either control point to the chord.
 *
 * The standard flatness measure for a cubic: a Bézier lies inside the convex
 * hull of its control points, so once both handles are within `tolerance` of
 * the chord the chord is within `tolerance` of the curve.
 */
const controlDeviation = (a: Vec2, c1: Vec2, c2: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-12) {
    // Degenerate chord: fall back to raw distance from the shared endpoint.
    return Math.max(Math.hypot(c1.x - a.x, c1.y - a.y), Math.hypot(c2.x - a.x, c2.y - a.y));
  }
  const cross = (p: Vec2): number => Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / chord;
  return Math.max(cross(c1), cross(c2));
};

/**
 * Flatten a segment to a polyline. Excludes `from` and includes `to`, so
 * consecutive segments concatenate without duplicating shared endpoints.
 *
 * Subdivision is adaptive: the curve is split at its midpoint until each piece
 * is flat to `tolerance`. A gentle 5 mm edge emits a point or two where the old
 * fixed 16 steps emitted sixteen; a 200 mm armhole gets the samples it actually
 * needs instead of visibly faceting.
 *
 * **Samples are not evenly spaced in `t`.** Nothing may infer a parameter from
 * a sample's index — use `nearestOnSegment` to go from a position back to `t`.
 */
export const flattenSegment = (
  from: Vec2,
  to: Vec2,
  geometry: SegmentGeometry,
  tolerance: number = FLATTEN_TOLERANCE_MM,
): Vec2[] => {
  if (geometry.kind === 'arc') {
    const arc = arcCentre(from, to, geometry);
    if (!arc) return [to];
    // Sagitta of a chord subtending angle a on radius r is r(1 - cos(a/2)).
    // Invert it for the largest step that still sits within tolerance, so an
    // arc is sampled to the same standard as a cubic rather than being emitted
    // as a single straight chord.
    const ratio = Math.max(-1, Math.min(1, 1 - tolerance / arc.radius));
    const maxStep = 2 * Math.acos(ratio);
    const steps = Math.max(1, Math.ceil(Math.abs(arc.sweep) / Math.max(maxStep, 1e-6)));
    const out: Vec2[] = [];
    for (let i = 1; i <= steps; i += 1) out.push(arcPoint(arc, i / steps));
    return out;
  }

  if (geometry.kind !== 'cubic') return [to];

  const out: Vec2[] = [];

  const emit = (a: Vec2, c1: Vec2, c2: Vec2, b: Vec2, depth: number): void => {
    if (depth >= MAX_FLATTEN_DEPTH || controlDeviation(a, c1, c2, b) <= tolerance) {
      out.push(b);
      return;
    }
    // de Casteljau at the midpoint: exact, so subdividing never moves the curve.
    const p01 = lerp(a, c1, 0.5);
    const p12 = lerp(c1, c2, 0.5);
    const p23 = lerp(c2, b, 0.5);
    const p012 = lerp(p01, p12, 0.5);
    const p123 = lerp(p12, p23, 0.5);
    const mid = lerp(p012, p123, 0.5);
    emit(a, p01, p012, mid, depth + 1);
    emit(mid, p123, p23, b, depth + 1);
  };

  emit(from, geometry.control1, geometry.control2, to, 0);
  return out;
};

/* --- Arc length ------------------------------------------------------------- */

/**
 * 5-point Gauss–Legendre nodes and weights on [-1, 1].
 *
 * Exact for polynomials up to degree 9. The integrand here is |B'(t)|, a square
 * root rather than a polynomial, so this is not exact — but applied over enough
 * subintervals it converges far faster than counting chords, and unlike chord
 * summation it never systematically *under*-reports (chords always cut corners).
 */
const GL_NODES = [
  -0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664,
] as const;
const GL_WEIGHTS = [
  0.23692688505618908, 0.47862867049936647, 0.5688888888888889, 0.47862867049936647,
  0.23692688505618908,
] as const;

/** Relative convergence target for the adaptive quadrature. */
const ARC_LENGTH_TOLERANCE = 1e-12;
/** Interval counts double until they agree; 2^9 = 512 intervals is the ceiling. */
const MAX_ARC_REFINEMENTS = 9;

/** Composite Gauss–Legendre over `intervals` equal subintervals of [0, 1]. */
const quadrature = (speed: (t: number) => number, intervals: number): number => {
  const half = 1 / (2 * intervals);
  let total = 0;
  for (let i = 0; i < intervals; i += 1) {
    const centre = (2 * i + 1) * half;
    for (let n = 0; n < GL_NODES.length; n += 1) {
      total += (GL_WEIGHTS[n] ?? 0) * speed(centre + half * (GL_NODES[n] ?? 0));
    }
  }
  return total * half;
};

/**
 * Arc length of a segment.
 *
 * Integrates the speed |B'(t)| rather than summing flattened chords, because a
 * chord sum depends on how finely the curve happened to be sampled: splitting an
 * edge in two used to make it *report* a different length even though the
 * geometry had not moved, and every point of measure inherited that.
 *
 * The interval count doubles until two successive estimates agree, so accuracy
 * is driven by the curve rather than by a constant that happened to suit the
 * seed pattern. A gentle edge converges in one or two rounds; a long
 * near-cusp one keeps going until it earns its answer.
 *
 * A circular arc is not integrated at all — its length is r·Δθ exactly.
 */
export const segmentArcLength = (
  from: Vec2,
  to: Vec2,
  geometry: SegmentGeometry,
): number => {
  if (geometry.kind === 'arc') {
    const arc = arcCentre(from, to, geometry);
    if (arc) return Math.abs(arc.radius * arc.sweep);
    return Math.hypot(to.x - from.x, to.y - from.y);
  }

  if (geometry.kind !== 'cubic') return Math.hypot(to.x - from.x, to.y - from.y);

  const { control1, control2 } = geometry;
  const speed = (t: number): number => {
    const d = cubicTangent(from, control1, control2, to, t);
    return Math.hypot(d.x, d.y);
  };

  let intervals = 2;
  let previous = quadrature(speed, intervals);
  for (let i = 0; i < MAX_ARC_REFINEMENTS; i += 1) {
    intervals *= 2;
    const next = quadrature(speed, intervals);
    if (Math.abs(next - previous) <= ARC_LENGTH_TOLERANCE * Math.max(1, Math.abs(next))) {
      return next;
    }
    previous = next;
  }
  return previous;
};

/**
 * Parameter at a given arc length along a segment — the inverse of
 * `segmentArcLength`.
 *
 * Needed because a notch is specified in millimetres from the seam start but
 * stored as a curve parameter, and the two are not proportional on anything
 * but a straight edge. Solved by bisection on the (monotonic) length function,
 * which cannot overshoot the way Newton can near a near-stationary point.
 */
export const parameterAtLength = (
  from: Vec2,
  to: Vec2,
  geometry: SegmentGeometry,
  length: number,
): number => {
  const total = segmentArcLength(from, to, geometry);
  if (total <= 1e-12) return 0;
  if (length <= 0) return 0;
  if (length >= total) return 1;

  // Straight and circular geometry are parameterised proportionally to length,
  // so the answer is closed-form; only a cubic needs solving.
  if (geometry.kind !== 'cubic') return length / total;

  let low = 0;
  let high = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    const split = splitSegment(from, to, geometry, mid);
    const covered = segmentArcLength(from, split.at, split.left);
    if (Math.abs(covered - length) <= 1e-9) return mid;
    if (covered < length) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
};

/* --- Closest point ---------------------------------------------------------- */

export interface NearestResult {
  readonly t: number;
  readonly position: Vec2;
  readonly distance: number;
}

const NEWTON_STEPS = 16;

/**
 * Scan resolution for the bracketing pass, derived from the curve rather than
 * fixed.
 *
 * A cubic has at most three local minima of distance-to-a-point, but they can
 * sit arbitrarily close together on a curve that doubles back on itself. Tying
 * the sample count to the control polygon's length keeps the scan fine enough
 * to separate them on a large or convoluted edge, where a constant 24 samples
 * was tuned for the seed pattern and would step straight over a minimum on a
 * dense imported outline.
 */
const scanStepsFor = (a: Vec2, c1: Vec2, c2: Vec2, b: Vec2, tolerance: number): number => {
  const polygon =
    Math.hypot(c1.x - a.x, c1.y - a.y) +
    Math.hypot(c2.x - c1.x, c2.y - c1.y) +
    Math.hypot(b.x - c2.x, b.y - c2.y);
  return Math.max(16, Math.min(512, Math.ceil(polygon / Math.max(tolerance * 10, 1e-6))));
};

/**
 * Closest point on a segment to `p`, and the parameter where it falls.
 *
 * Picking an edge, splitting one and placing a notch all read this, so it has
 * to be the true closest point rather than the nearest flattening sample.
 *
 * Every local minimum found by the bracketing scan is refined, not just the
 * global best. On a curve that doubles back the deepest sampled point and the
 * true nearest point can sit in different basins, and refining only the sampled
 * winner would confidently return the wrong one. Newton runs on
 * d/dt |B(t) − p|², clamped to [0, 1], falling back to its bracket when a step
 * escapes or the second derivative vanishes — so a cusp degrades to scan
 * accuracy instead of diverging.
 *
 * Lines and arcs are closed-form and never reach the solver.
 */
export const nearestOnSegment = (
  from: Vec2,
  to: Vec2,
  geometry: SegmentGeometry,
  p: Vec2,
  tolerance: number = FLATTEN_TOLERANCE_MM,
): NearestResult => {
  if (geometry.kind === 'arc') {
    const arc = arcCentre(from, to, geometry);
    if (arc) {
      // Project onto the circle, then clamp the angle into the swept range.
      const angle = Math.atan2(p.y - arc.centre.y, p.x - arc.centre.x);
      let along = (angle - arc.start) / arc.sweep;
      // `along` is periodic; bring it into [0,1] by whole turns before clamping.
      const turn = (Math.PI * 2) / Math.abs(arc.sweep);
      while (along < 0) along += turn;
      while (along > 1 && along - turn > -1e-12) along -= turn;
      const t = Math.min(1, Math.max(0, along));
      const position = arcPoint(arc, t);
      return { t, position, distance: Math.hypot(p.x - position.x, p.y - position.y) };
    }
  }

  if (geometry.kind !== 'cubic') {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared < 1e-12
        ? 0
        : Math.min(1, Math.max(0, ((p.x - from.x) * dx + (p.y - from.y) * dy) / lengthSquared));
    const position = { x: from.x + dx * t, y: from.y + dy * t };
    return { t, position, distance: Math.hypot(p.x - position.x, p.y - position.y) };
  }

  const { control1, control2 } = geometry;
  const at = (t: number): Vec2 => cubicAt(from, control1, control2, to, t);
  const distanceSquared = (t: number): number => {
    const q = at(t);
    return (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
  };

  const refine = (seed: number): number => {
    let t = seed;
    for (let i = 0; i < NEWTON_STEPS; i += 1) {
      const q = at(t);
      const d1 = cubicTangent(from, control1, control2, to, t);
      const d2 = cubicCurvature(from, control1, control2, to, t);
      const dx = q.x - p.x;
      const dy = q.y - p.y;

      // f(t) = |B(t) - p|^2; minimise by driving f'(t) to zero.
      const first = 2 * (dx * d1.x + dy * d1.y);
      const second = 2 * (d1.x * d1.x + d1.y * d1.y + dx * d2.x + dy * d2.y);
      if (Math.abs(second) < 1e-12) break;

      const next = t - first / second;
      if (!Number.isFinite(next) || next < 0 || next > 1) break;
      if (Math.abs(next - t) < 1e-15) return next;
      t = next;
    }
    return t;
  };

  const steps = scanStepsFor(from, control1, control2, to, tolerance);
  let bestT = 0;
  let bestDistance = distanceSquared(0);

  const consider = (candidate: number): void => {
    const d = distanceSquared(candidate);
    if (d < bestDistance) {
      bestDistance = d;
      bestT = candidate;
    }
  };

  let previous = bestDistance;
  let current = distanceSquared(1 / steps);
  consider(1 / steps);

  for (let i = 1; i < steps; i += 1) {
    const next = distanceSquared((i + 1) / steps);
    consider((i + 1) / steps);
    // A sampled interior minimum: refine from it, and keep the result only if
    // it genuinely improves on every sample seen so far.
    if (current <= previous && current <= next) consider(refine(i / steps));
    previous = current;
    current = next;
  }

  // The endpoints are minima too when the curve runs away from `p`.
  consider(refine(0));
  consider(refine(1));

  const position = at(bestT);
  return {
    t: bestT,
    position,
    distance: Math.hypot(p.x - position.x, p.y - position.y),
  };
};
