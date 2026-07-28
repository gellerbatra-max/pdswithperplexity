import type { Vec2 } from '@/geometry';
import { FLATTEN_TOLERANCE_MM, LINE, type SegmentGeometry } from '@/pattern';

/**
 * DXF curve entities → this app's `SegmentGeometry`.
 *
 * Kept apart from `import.ts` for the same reason `ruleTable.ts` is: these are
 * pure geometric conversions with no notion of blocks, layers or documents, and
 * they are worth being able to test — and be wrong about — on their own.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A caveat that belongs at the top, not in a footnote.
 *
 * Every other capability in this importer was built *after* a real file proved
 * what it looks like. This module is the exception. 125 real DXF files were
 * scanned before it was written — every apparel export on hand, from three CAD
 * vendors — and between them they contain **zero** ARC entities, **zero**
 * SPLINE entities, and not one non-zero bulge on a pattern polyline. Apparel
 * CAD pre-flattens: it ships densely-sampled straight lines and lets the
 * receiving system re-fit curves if it wants them.
 *
 * So this code is written against the DXF specification rather than against
 * observed vendor behaviour, and its fixtures are synthetic and labelled as
 * such. What that buys is real: an importer that meets a curve does something
 * exact and reports it, rather than skipping it or silently chording it. What
 * it does not buy is the confidence the rest of the module has. Treat a real
 * curve-bearing file, when one turns up, as a test of this module rather than
 * as routine input.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Whether a conversion was lossless, and what to say about it if not. */
export interface CurveConversion {
  /** Segments to emit, in order. Each `to` is the next segment's start. */
  readonly points: readonly Vec2[];
  /** Geometry for the segment *leaving* `points[i]`. One shorter than `points`. */
  readonly geometry: readonly SegmentGeometry[];
  /** True when the result is the curve, not a stand-in for it. */
  readonly exact: boolean;
  /** Set when `exact` is false: what was done and how closely. */
  readonly approximation?: string;
}

/* --- Bulge ---------------------------------------------------------------- *
 *
 * A polyline vertex's bulge (group 42) describes the arc from *that* vertex to
 * the next one. It is `tan(θ/4)` where θ is the arc's included angle, signed:
 * positive sweeps counter-clockwise in the file's own (y-up) frame.
 *
 * This is an exact circular arc, and `ArcGeometry` stores exactly that, so the
 * conversion loses nothing. Deriving the radius needs the chord, which is why
 * this takes both endpoints rather than living on the vertex reader.          */

/**
 * Bulge → arc, exactly.
 *
 * Returns `LINE` for a zero bulge (which is what a zero bulge means) and for a
 * degenerate chord, where no circle is determined and the chord is the honest
 * answer.
 */
export const bulgeToArc = (from: Vec2, to: Vec2, bulge: number): SegmentGeometry => {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-12) return LINE;

  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  if (chord < 1e-12) return LINE;

  // θ = 4·atan(bulge); radius = (chord/2) / sin(θ/2).
  const theta = 4 * Math.atan(bulge);
  const half = Math.abs(theta) / 2;
  const sinHalf = Math.sin(half);
  if (sinHalf < 1e-12) return LINE;

  return {
    kind: 'arc',
    radius: Math.abs(chord / 2 / sinHalf),
    largeArc: Math.abs(theta) > Math.PI,
    // `clockwise` is in the *consumer's* frame. A positive bulge is
    // counter-clockwise in DXF's y-up space; callers that have already flipped
    // Y must flip the bulge's sign with it (see `import.ts`), so by the time
    // this is called the sign already means what this frame says it means.
    clockwise: theta < 0,
  };
};

/* --- ARC entity ------------------------------------------------------------ *
 *
 * A standalone ARC carries centre, radius and a start/end angle in degrees.
 * DXF always sweeps an ARC counter-clockwise from start to end, so the sweep
 * is `(end - start) mod 360` and never needs a direction flag of its own.     */

export interface ArcEntityResult {
  readonly from: Vec2;
  readonly to: Vec2;
  readonly geometry: SegmentGeometry;
  /** Signed sweep in radians, for diagnostics and tests. */
  readonly sweep: number;
}

/**
 * ARC entity → endpoints plus arc geometry, exactly.
 *
 * A full circle (start ≡ end) has no endpoint form — a segment needs two
 * distinct ends — so it returns null rather than silently becoming a
 * 359.99° arc or a zero-length one. `import.ts` reports those.
 */
export const arcEntityToSegment = (
  centre: Vec2,
  radius: number,
  startDegrees: number,
  endDegrees: number,
): ArcEntityResult | null => {
  if (!Number.isFinite(radius) || radius <= 0) return null;

  const start = (startDegrees * Math.PI) / 180;
  const end = (endDegrees * Math.PI) / 180;

  // DXF sweeps counter-clockwise; normalise into (0, 2π).
  let sweep = end - start;
  while (sweep <= 0) sweep += Math.PI * 2;
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
  if (sweep < 1e-12 || Math.abs(sweep - Math.PI * 2) < 1e-12) return null;

  return {
    from: { x: centre.x + radius * Math.cos(start), y: centre.y + radius * Math.sin(start) },
    to: { x: centre.x + radius * Math.cos(end), y: centre.y + radius * Math.sin(end) },
    geometry: { kind: 'arc', radius, largeArc: sweep > Math.PI, clockwise: false },
    sweep,
  };
};

/* --- SPLINE ---------------------------------------------------------------- *
 *
 * The one curve family this app's geometry cannot hold exactly in general. A
 * DXF SPLINE is a NURBS curve: degree, a knot vector, control points, and
 * optionally weights. `SegmentGeometry` has line, cubic and arc — enough for
 * one specific and very common case, and not enough for the rest.
 *
 *   exact       degree 3, four control points, unweighted, clamped. That *is*
 *               a cubic Bézier, control points and all, so it converts with
 *               nothing lost.
 *   approximate everything else. Evaluated with de Boor and subdivided until
 *               it is within `FLATTEN_TOLERANCE_MM` of the true curve, then
 *               emitted as a chain of straight segments. Reported as
 *               approximated, with the tolerance, every time.
 *
 * Fitting cubics to a general NURBS would look better in the model and be
 * harder to be sure of; chording to a stated tolerance is a claim that can be
 * checked. Until a real file makes the difference matter, the checkable one
 * wins.                                                                       */

export interface SplineInput {
  readonly degree: number;
  readonly controlPoints: readonly Vec2[];
  readonly knots: readonly number[];
  readonly weights?: readonly number[];
  /** Group 70 bit 1: the curve closes on itself. */
  readonly closed: boolean;
}

/** True when every weight is equal — a rational spline that is really polynomial. */
const isUnweighted = (weights: readonly number[] | undefined, count: number): boolean => {
  if (!weights || weights.length === 0) return true;
  if (weights.length !== count) return false;
  return weights.every((w) => Math.abs(w - weights[0]!) < 1e-12);
};

/** Clamped means the end knots repeat `degree + 1` times, pinning the ends. */
const isClamped = (knots: readonly number[], degree: number): boolean => {
  if (knots.length < 2 * (degree + 1)) return false;
  const first = knots[0]!;
  const last = knots[knots.length - 1]!;
  for (let i = 0; i <= degree; i += 1) {
    if (Math.abs(knots[i]! - first) > 1e-9) return false;
    if (Math.abs(knots[knots.length - 1 - i]! - last) > 1e-9) return false;
  }
  return true;
};

/**
 * Evaluates a NURBS at parameter `t` with de Boor's algorithm.
 *
 * Weights are carried through in homogeneous coordinates, so a rational spline
 * evaluates correctly rather than being silently treated as polynomial.
 */
const deBoor = (spline: SplineInput, t: number): Vec2 => {
  const { degree, controlPoints, knots } = spline;
  const n = controlPoints.length;
  const weights = spline.weights?.length === n ? spline.weights : undefined;

  // Knot span containing t, clamped to the last valid span.
  let span = degree;
  while (span < n - 1 && knots[span + 1]! <= t) span += 1;

  // Working set in homogeneous coordinates (wx, wy, w).
  const dx: number[] = [];
  const dy: number[] = [];
  const dw: number[] = [];
  for (let j = 0; j <= degree; j += 1) {
    const index = span - degree + j;
    const point = controlPoints[Math.min(Math.max(index, 0), n - 1)]!;
    const w = weights ? weights[Math.min(Math.max(index, 0), n - 1)]! : 1;
    dx.push(point.x * w);
    dy.push(point.y * w);
    dw.push(w);
  }

  for (let r = 1; r <= degree; r += 1) {
    for (let j = degree; j >= r; j -= 1) {
      const i = span - degree + j;
      const lo = knots[i]!;
      const hi = knots[i + degree - r + 1]!;
      const denom = hi - lo;
      const a = denom <= 1e-12 ? 0 : (t - lo) / denom;
      dx[j] = (1 - a) * dx[j - 1]! + a * dx[j]!;
      dy[j] = (1 - a) * dy[j - 1]! + a * dy[j]!;
      dw[j] = (1 - a) * dw[j - 1]! + a * dw[j]!;
    }
  }

  const w = dw[degree]!;
  return w === 0
    ? { x: dx[degree]!, y: dy[degree]! }
    : { x: dx[degree]! / w, y: dy[degree]! / w };
};

/** Perpendicular distance from `p` to the segment `a`–`b`. */
const distanceToChord = (p: Vec2, a: Vec2, b: Vec2): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-24) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
};

/** Guards against a pathological curve subdividing without end. */
const MAX_SPLINE_DEPTH = 14;

/**
 * Adaptive subdivision: keeps halving a parameter interval until its chord is
 * within `tolerance` of the curve through it. Same principle as
 * `flattenSegment` in `pattern/curve.ts`, applied to a de Boor evaluator.
 */
const subdivide = (
  spline: SplineInput,
  t0: number,
  t1: number,
  p0: Vec2,
  p1: Vec2,
  tolerance: number,
  depth: number,
  into: Vec2[],
): void => {
  const tm = (t0 + t1) / 2;
  const pm = deBoor(spline, tm);
  if (depth >= MAX_SPLINE_DEPTH || distanceToChord(pm, p0, p1) <= tolerance) {
    into.push(p1);
    return;
  }
  subdivide(spline, t0, tm, p0, pm, tolerance, depth + 1, into);
  subdivide(spline, tm, t1, pm, p1, tolerance, depth + 1, into);
};

/**
 * SPLINE → segments, exactly where the model can hold it and to a stated
 * tolerance where it cannot.
 *
 * Returns null when the entity carries too little to evaluate — fewer control
 * points than its degree requires, or a knot vector that does not match.
 * `import.ts` reports those rather than drawing a straight line through them.
 */
export const splineToSegments = (
  spline: SplineInput,
  tolerance: number = FLATTEN_TOLERANCE_MM,
): CurveConversion | null => {
  const { degree, controlPoints, knots } = spline;
  if (degree < 1 || controlPoints.length < degree + 1) return null;
  if (knots.length !== controlPoints.length + degree + 1) return null;

  // The exactly-representable case: a lone cubic Bézier wearing NURBS clothes.
  if (
    degree === 3 &&
    controlPoints.length === 4 &&
    !spline.closed &&
    isUnweighted(spline.weights, 4) &&
    isClamped(knots, 3)
  ) {
    return {
      points: [controlPoints[0]!, controlPoints[3]!],
      geometry: [{ kind: 'cubic', control1: controlPoints[1]!, control2: controlPoints[2]! }],
      exact: true,
    };
  }

  const start = knots[degree]!;
  const end = knots[knots.length - 1 - degree]!;
  if (!(end > start)) return null;

  const p0 = deBoor(spline, start);
  const p1 = deBoor(spline, end);
  const points: Vec2[] = [p0];
  subdivide(spline, start, end, p0, p1, tolerance, 0, points);

  return {
    points,
    geometry: points.slice(1).map(() => LINE),
    exact: false,
    approximation:
      `evaluated as a degree-${degree} NURBS and chorded to within ${tolerance}mm ` +
      `(${points.length - 1} straight segments)`,
  };
};
