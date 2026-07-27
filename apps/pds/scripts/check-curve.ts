import {
  flattenSegment,
  nearestOnSegment,
  pointOnSegment,
  segmentArcLength,
  splitSegment,
  parameterAtLength,
  resolveArc,
  LINE,
  type SegmentGeometry,
} from '../src/pattern/curve.ts';

/**
 * Self-check for the curve math underneath every measurement and every click.
 *
 * Run it with:
 *
 *   npm run check:curve
 *
 * These three functions are load-bearing in ways that are hard to see: arc
 * length feeds every point of measure, the nearest-point solve decides where a
 * split or a notch lands, and the flattening tolerance sets how accurate the
 * seam-allowance offset can be. All of them fail quietly — a slightly wrong
 * length still looks like a length. Every case below has an answer derivable by
 * hand or by brute force.
 *
 * Lives outside `src/` so `tsc -b` does not pull it into the app build; Node
 * strips the types itself, so it needs no dependency.
 */

interface V {
  readonly x: number;
  readonly y: number;
}

let failures = 0;
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) failures += 1;
};

/** Brute-force arc length by dense chord summation — the independent reference. */
const chordLength = (from: V, to: V, geometry: SegmentGeometry, n = 200_000): number => {
  let total = 0;
  let previous = pointOnSegment(from, to, geometry, 0);
  for (let i = 1; i <= n; i += 1) {
    const p = pointOnSegment(from, to, geometry, i / n);
    total += Math.hypot(p.x - previous.x, p.y - previous.y);
    previous = p;
  }
  return total;
};

const cubic = (control1: V, control2: V): SegmentGeometry => ({
  kind: 'cubic',
  control1,
  control2,
});

/* --- Arc length: a cubic laid on its own chord is exactly the chord --------- */

const a: V = { x: 0, y: 0 };
const b: V = { x: 300, y: 400 }; // 3-4-5, chord = 500
const straightCubic = cubic(
  { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
  { x: b.x - (b.x - a.x) / 3, y: b.y - (b.y - a.y) / 3 },
);

check(
  'line length',
  Math.abs(segmentArcLength(a, b, LINE) - 500) < 1e-12,
  `${segmentArcLength(a, b, LINE)} want 500`,
);
check(
  'degenerate cubic equals its chord',
  Math.abs(segmentArcLength(a, b, straightCubic) - 500) < 1e-9,
  `${segmentArcLength(a, b, straightCubic).toFixed(9)} want 500`,
);

/* --- Arc length: quarter circle, against the analytic value ----------------- */

// The standard cubic approximation to a quarter circle of radius r.
const R = 100;
const K = (4 / 3) * (Math.SQRT2 - 1);
const qFrom: V = { x: R, y: 0 };
const qTo: V = { x: 0, y: R };
const quarter = cubic({ x: R, y: R * K }, { x: R * K, y: R });
const quarterTrue = (Math.PI * R) / 2;
const quarterMeasured = segmentArcLength(qFrom, qTo, quarter);

check(
  'quarter circle length',
  Math.abs(quarterMeasured - quarterTrue) / quarterTrue < 1e-3,
  `${quarterMeasured.toFixed(6)} want ~${quarterTrue.toFixed(6)}`,
);
check(
  'quarter circle matches brute force',
  Math.abs(quarterMeasured - chordLength(qFrom, qTo, quarter)) < 1e-7,
  `quadrature ${quarterMeasured.toFixed(9)} vs chords ${chordLength(qFrom, qTo, quarter).toFixed(9)}`,
);

/* --- Arc length is invariant under splitting -------------------------------- *
 * This is the regression that motivated the quadrature. Summing flattened
 * chords made a split edge *report* a different length even though the geometry
 * had not moved, and every measurement over that seam inherited the drift.     */

const wobbly = cubic({ x: 40, y: 260 }, { x: 250, y: -120 });
const wobblyFrom: V = { x: 0, y: 0 };
const wobblyTo: V = { x: 300, y: 100 };
const whole = segmentArcLength(wobblyFrom, wobblyTo, wobbly);

for (const t of [0.2, 0.5, 0.73]) {
  const split = splitSegment(wobblyFrom, wobblyTo, wobbly, t);
  const halves =
    segmentArcLength(wobblyFrom, split.at, split.left) +
    segmentArcLength(split.at, wobblyTo, split.right);
  check(
    `split at ${t} preserves length`,
    Math.abs(halves - whole) < 1e-6,
    `${halves.toFixed(9)} vs ${whole.toFixed(9)} (Δ ${(halves - whole).toExponential(2)})`,
  );
}

/* --- Nearest point: a point taken off the curve recovers its own parameter -- */

for (const t of [0.05, 0.33, 0.5, 0.87]) {
  const on = pointOnSegment(wobblyFrom, wobblyTo, wobbly, t);
  const found = nearestOnSegment(wobblyFrom, wobblyTo, wobbly, on);
  check(
    `nearest recovers t=${t}`,
    Math.abs(found.t - t) < 1e-6 && found.distance < 1e-6,
    `t=${found.t.toFixed(9)} distance=${found.distance.toExponential(2)}`,
  );
}

/* --- Nearest point: off-curve probe agrees with a brute-force scan ---------- */

const probes: readonly V[] = [
  { x: 150, y: 0 },
  { x: -50, y: 50 },
  { x: 320, y: 140 },
  { x: 100, y: 200 },
];

for (const probe of probes) {
  const found = nearestOnSegment(wobblyFrom, wobblyTo, wobbly, probe);
  let bestDistance = Infinity;
  for (let i = 0; i <= 200_000; i += 1) {
    const p = pointOnSegment(wobblyFrom, wobblyTo, wobbly, i / 200_000);
    const d = Math.hypot(p.x - probe.x, p.y - probe.y);
    if (d < bestDistance) bestDistance = d;
  }
  check(
    `nearest to (${probe.x},${probe.y})`,
    Math.abs(found.distance - bestDistance) < 1e-6,
    `solver ${found.distance.toFixed(9)} vs scan ${bestDistance.toFixed(9)}`,
  );
}

// A straight segment must clamp rather than run off its ends.
check(
  'nearest clamps past the start',
  nearestOnSegment(a, b, LINE, { x: -100, y: -200 }).t === 0,
  't = 0',
);
check(
  'nearest clamps past the end',
  nearestOnSegment(a, b, LINE, { x: 500, y: 700 }).t === 1,
  't = 1',
);

/* --- Flattening honours its tolerance, and adapts to curvature -------------- */

const deviation = (from: V, to: V, geometry: SegmentGeometry, tolerance: number): number => {
  const samples = [from, ...flattenSegment(from, to, geometry, tolerance)];
  let worst = 0;
  for (let i = 0; i <= 20_000; i += 1) {
    const p = pointOnSegment(from, to, geometry, i / 20_000);
    let best = Infinity;
    for (let j = 0; j + 1 < samples.length; j += 1) {
      const u = samples[j]!;
      const v = samples[j + 1]!;
      const dx = v.x - u.x;
      const dy = v.y - u.y;
      const lengthSquared = dx * dx + dy * dy;
      let s = lengthSquared < 1e-12 ? 0 : ((p.x - u.x) * dx + (p.y - u.y) * dy) / lengthSquared;
      s = Math.max(0, Math.min(1, s));
      const d = Math.hypot(p.x - (u.x + dx * s), p.y - (u.y + dy * s));
      if (d < best) best = d;
    }
    if (best > worst) worst = best;
  }
  return worst;
};

for (const tolerance of [0.5, 0.1, 0.01]) {
  const worst = deviation(qFrom, qTo, quarter, tolerance);
  check(
    `flatten within ${tolerance}mm`,
    worst <= tolerance,
    `worst deviation ${worst.toFixed(6)}mm over ${flattenSegment(qFrom, qTo, quarter, tolerance).length} samples`,
  );
}

// Adaptive means a nearly-straight edge costs almost nothing, where a fixed
// step count spent the same sixteen samples on it as on a deep armhole.
const gentleFrom: V = { x: 0, y: 0 };
const gentleTo: V = { x: 40, y: 0 };
const gentle = cubic({ x: 13.4, y: 0.02 }, { x: 26.7, y: 0.02 });
const gentleCount = flattenSegment(gentleFrom, gentleTo, gentle).length;
const curvyCount = flattenSegment(qFrom, qTo, quarter).length;

check(
  'adaptive: gentle edge is cheap',
  gentleCount <= 2,
  `${gentleCount} sample(s) for a 40mm near-straight edge`,
);
check(
  'adaptive: curved edge gets more samples',
  curvyCount > gentleCount,
  `${curvyCount} samples for a 100mm quarter circle vs ${gentleCount}`,
);

/* --- Arcs: exactly solvable, so every answer here is analytic --------------- */

const arc = (radius: number, largeArc: boolean, clockwise: boolean): SegmentGeometry => ({
  kind: 'arc',
  radius,
  largeArc,
  clockwise,
});

// Quarter circle radius 100, centre at the origin: (100,0) -> (0,100).
const aFrom: V = { x: 100, y: 0 };
const aTo: V = { x: 0, y: 100 };
const quarterArc = arc(100, false, false);
const quarterArcLength = segmentArcLength(aFrom, aTo, quarterArc);

check(
  'arc length is r·theta',
  Math.abs(quarterArcLength - (Math.PI * 100) / 2) < 1e-9,
  `${quarterArcLength.toFixed(9)} want ${((Math.PI * 100) / 2).toFixed(9)}`,
);
check(
  'arc length beats its chord',
  quarterArcLength > Math.hypot(aTo.x - aFrom.x, aTo.y - aFrom.y),
  `${quarterArcLength.toFixed(3)} vs chord ${Math.hypot(aTo.x - aFrom.x, aTo.y - aFrom.y).toFixed(3)}`,
);

/*
 * Two circles of a given radius pass through any two points, and the flags pick
 * one — so nothing here may assume where the centre landed. The invariants that
 * actually matter are that the arc passes through both endpoints and never
 * leaves its own circle.
 */
const centre = resolveArc(aFrom, aTo, quarterArc);
check('arc resolves to a centre', centre !== null, centre ? `r=${centre.radius}` : 'null');

let worstRadius = 0;
for (let i = 0; i <= 500; i += 1) {
  const q = pointOnSegment(aFrom, aTo, quarterArc, i / 500);
  worstRadius = Math.max(
    worstRadius,
    Math.abs(Math.hypot(q.x - (centre?.centre.x ?? 0), q.y - (centre?.centre.y ?? 0)) - 100),
  );
}
check('arc stays on its circle', worstRadius < 1e-9, `worst radial error ${worstRadius.toExponential(2)}`);

const arcStart = pointOnSegment(aFrom, aTo, quarterArc, 0);
const arcEnd = pointOnSegment(aFrom, aTo, quarterArc, 1);
check(
  'arc meets both endpoints',
  Math.hypot(arcStart.x - aFrom.x, arcStart.y - aFrom.y) < 1e-9 &&
    Math.hypot(arcEnd.x - aTo.x, arcEnd.y - aTo.y) < 1e-9,
  `start Δ${Math.hypot(arcStart.x - aFrom.x, arcStart.y - aFrom.y).toExponential(1)}, end Δ${Math.hypot(arcEnd.x - aTo.x, arcEnd.y - aTo.y).toExponential(1)}`,
);

// The sweep flag chooses which side the arc bulges; both are quarter arcs.
const mirrored = resolveArc(aFrom, aTo, arc(100, false, true));
check(
  'sweep flag flips the centre',
  mirrored !== null && centre !== null &&
    Math.hypot(mirrored.centre.x - centre.centre.x, mirrored.centre.y - centre.centre.y) > 1,
  centre && mirrored
    ? `(${centre.centre.x.toFixed(1)},${centre.centre.y.toFixed(1)}) vs (${mirrored.centre.x.toFixed(1)},${mirrored.centre.y.toFixed(1)})`
    : 'unresolved',
);
check(
  'both sweeps are quarter arcs',
  Math.abs(segmentArcLength(aFrom, aTo, arc(100, false, true)) - (Math.PI * 100) / 2) < 1e-9,
  `${segmentArcLength(aFrom, aTo, arc(100, false, true)).toFixed(6)}`,
);

// A radius too small to span the chord is repaired to a half-circle, not
// silently drawn as a straight line.
const tooSmall = segmentArcLength(aFrom, aTo, arc(10, false, false));
const halfCircle = (Math.PI * Math.hypot(aTo.x - aFrom.x, aTo.y - aFrom.y)) / 2;
check(
  'undersized radius becomes a half-circle',
  Math.abs(tooSmall - halfCircle) < 1e-9,
  `${tooSmall.toFixed(6)} want ${halfCircle.toFixed(6)}`,
);

// The large-arc flag must take the long way round: 3/4 of the circle.
const largeArcLength = segmentArcLength(aFrom, aTo, arc(100, true, false));
check(
  'largeArc takes the long way',
  Math.abs(largeArcLength - (3 * Math.PI * 100) / 2) < 1e-9,
  `${largeArcLength.toFixed(6)} want ${((3 * Math.PI * 100) / 2).toFixed(6)}`,
);

// Splitting an arc must keep it an arc, and preserve total length.
for (const t of [0.25, 0.5, 0.8]) {
  const split = splitSegment(aFrom, aTo, quarterArc, t);
  const halves =
    segmentArcLength(aFrom, split.at, split.left) + segmentArcLength(split.at, aTo, split.right);
  check(
    `arc split at ${t} stays an arc`,
    split.left.kind === 'arc' && split.right.kind === 'arc',
    `${split.left.kind} / ${split.right.kind}`,
  );
  check(
    `arc split at ${t} preserves length`,
    Math.abs(halves - quarterArcLength) < 1e-9,
    `${halves.toFixed(9)} vs ${quarterArcLength.toFixed(9)}`,
  );
}

// Flattening an arc must honour tolerance — it used to emit a single chord.
for (const tolerance of [0.5, 0.05]) {
  const samples = flattenSegment(aFrom, aTo, quarterArc, tolerance);
  const cx = centre?.centre.x ?? 0;
  const cy = centre?.centre.y ?? 0;
  let worst = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const u = i === 0 ? aFrom : samples[i - 1]!;
    const v = samples[i]!;
    // Sagitta of this chord measured against the arc's own circle.
    worst = Math.max(worst, Math.abs(100 - Math.hypot((u.x + v.x) / 2 - cx, (u.y + v.y) / 2 - cy)));
  }
  check(
    `arc flattens within ${tolerance}mm`,
    worst <= tolerance && samples.length > 1,
    `worst ${worst.toFixed(6)}mm over ${samples.length} samples`,
  );
}

// Nearest point on an arc is a radial projection: a probe pushed straight out
// from the centre through a point of the arc must land back on that point.
if (centre) {
  const midAngle = centre.start + centre.sweep * 0.4;
  const onArc = {
    x: centre.centre.x + 100 * Math.cos(midAngle),
    y: centre.centre.y + 100 * Math.sin(midAngle),
  };
  const outward = {
    x: centre.centre.x + 250 * Math.cos(midAngle),
    y: centre.centre.y + 250 * Math.sin(midAngle),
  };
  const nearArc = nearestOnSegment(aFrom, aTo, quarterArc, outward);
  check(
    'nearest on arc is radial',
    Math.abs(nearArc.distance - 150) < 1e-9 &&
      Math.hypot(nearArc.position.x - onArc.x, nearArc.position.y - onArc.y) < 1e-9,
    `distance ${nearArc.distance.toFixed(9)} want 150, t=${nearArc.t.toFixed(4)}`,
  );

  // A probe beyond the start endpoint must clamp to it rather than wrapping
  // round the circle to the far side.
  const behind = {
    x: centre.centre.x + 250 * Math.cos(centre.start - centre.sweep * 0.5),
    y: centre.centre.y + 250 * Math.sin(centre.start - centre.sweep * 0.5),
  };
  const clamped = nearestOnSegment(aFrom, aTo, quarterArc, behind);
  check(
    'nearest on arc clamps to an endpoint',
    clamped.t === 0 || clamped.t === 1,
    `t = ${clamped.t}`,
  );
}

/* --- Nearest point on a curve that doubles back ----------------------------- *
 * The case a single-best-sample scan gets wrong: two minima of comparable
 * depth, where the sampled winner is not the true nearest.                     */

const hookFrom: V = { x: 0, y: 0 };
const hookTo: V = { x: 20, y: 0 };
const hook = cubic({ x: 400, y: 120 }, { x: -380, y: 120 });

for (const q of [
  { x: 10, y: 40 },
  { x: 60, y: 70 },
  { x: -30, y: 55 },
  { x: 10, y: 95 },
]) {
  const found = nearestOnSegment(hookFrom, hookTo, hook, q);
  let bestDistance = Infinity;
  for (let i = 0; i <= 400_000; i += 1) {
    const s = pointOnSegment(hookFrom, hookTo, hook, i / 400_000);
    const d = Math.hypot(s.x - q.x, s.y - q.y);
    if (d < bestDistance) bestDistance = d;
  }
  check(
    `nearest on doubled-back curve at (${q.x},${q.y})`,
    Math.abs(found.distance - bestDistance) < 1e-6,
    `solver ${found.distance.toFixed(9)} vs scan ${bestDistance.toFixed(9)}`,
  );
}

/* --- Inverse arc length ----------------------------------------------------- */

for (const fraction of [0.1, 0.25, 0.5, 0.9]) {
  const total = segmentArcLength(wobblyFrom, wobblyTo, wobbly);
  const target = total * fraction;
  const t = parameterAtLength(wobblyFrom, wobblyTo, wobbly, target);
  const split = splitSegment(wobblyFrom, wobblyTo, wobbly, t);
  const reached = segmentArcLength(wobblyFrom, split.at, split.left);
  check(
    `parameterAtLength at ${fraction} of the seam`,
    Math.abs(reached - target) < 1e-6,
    `reached ${reached.toFixed(6)}mm want ${target.toFixed(6)}mm`,
  );
}

check(
  'parameterAtLength is proportional on a line',
  Math.abs(parameterAtLength(a, b, LINE, 125) - 0.25) < 1e-12,
  `${parameterAtLength(a, b, LINE, 125)}`,
);
check(
  'parameterAtLength clamps past the end',
  parameterAtLength(a, b, LINE, 9999) === 1,
  't = 1',
);

console.log(
  failures === 0 ? '\nAll curve checks passed.' : `\n${failures} curve check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
