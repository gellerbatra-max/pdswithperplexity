import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importDxfWithDiagnostics } from '../src/io/dxf/import.ts';
import { bulgeToArc, arcEntityToSegment, splineToSegments } from '../src/io/dxf/curves.ts';
import { segmentArcLength, pointOnSegment, flattenSegment } from '../src/pattern/curve.ts';
import type { Vec2 } from '../src/geometry/index.ts';
import type { PatternPiece } from '../src/pattern/index.ts';

/**
 * Regression suite for DXF curve import.
 *
 * Run it with:
 *
 *   npm run check:curves
 *
 * **These fixtures are synthetic** — the only ones in this project that are.
 * 125 real DXF files were scanned before this code was written and not one
 * contains an ARC, a SPLINE, or a non-zero bulge on a pattern polyline;
 * apparel CAD pre-flattens. See `fixtures/dxf/synthetic-curves.dxf.md`.
 *
 * So the expected values here come from the *geometric definitions*, computed
 * independently of `curves.ts`: a bulge arc's mid-height from the DXF
 * definition `sagitta = |bulge| x chord/2`, an arc's length from `r.theta`, a
 * tessellation's error by re-evaluating the curve it replaced. A shared
 * misreading of the spec between the importer and its test still fails.
 */

let failures = 0;
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) failures += 1;
};

const load = (name: string) => {
  const path = fileURLToPath(new URL(`./fixtures/dxf/synthetic-curves-${name}.dxf`, import.meta.url));
  return importDxfWithDiagnostics(readFileSync(path, 'utf8'), { flavour: 'aama', assumeUnit: 'mm' });
};

const positionOf = (piece: PatternPiece, id: string) =>
  piece.points.find((p) => p.id === id)!.position;

/* --- 1. bulge -> arc, against the DXF sagitta definition ------------------- */

{
  // DXF defines bulge as the ratio of the arc's sagitta to half its chord.
  // Every value below is checked that way rather than against the formula the
  // implementation happens to use.
  const A = { x: 0, y: 0 };
  const B = { x: 100, y: 0 };
  for (const bulge of [0.1, 0.5, 1, 2, -0.5]) {
    const geometry = bulgeToArc(A, B, bulge);
    if (geometry.kind !== 'arc') {
      check(`bulge ${bulge} produces an arc`, false, geometry.kind);
      continue;
    }
    const expectedSagitta = Math.abs(bulge) * 50;
    const mid = pointOnSegment(A, B, geometry, 0.5);
    const actualSagitta = Math.hypot(mid.x - 50, mid.y);
    check(
      `bulge ${bulge}: arc height matches sagitta = |bulge| x chord/2`,
      Math.abs(actualSagitta - expectedSagitta) < 1e-9,
      `${actualSagitta.toFixed(9)} vs ${expectedSagitta}`,
    );
    // …and on the correct side of the chord. Sagitta is a magnitude, so the
    // check above passes either way; the sign of the bulge is what says which
    // way, and only this pins it.
    check(
      `bulge ${bulge}: bows to the side the sign asks for`,
      bulge > 0 ? mid.y > 0 : mid.y < 0,
      `apex y=${mid.y.toFixed(6)} for bulge ${bulge}`,
    );
  }

  check('bulge 1 is a semicircle: radius is half the chord', Math.abs((bulgeToArc(A, B, 1) as { radius: number }).radius - 50) < 1e-9, 'ok');
  check('|bulge| > 1 sets largeArc', (bulgeToArc(A, B, 2) as { largeArc: boolean }).largeArc, 'ok');
  check('bulge sign chooses the sweep direction', (bulgeToArc(A, B, 0.5) as { clockwise: boolean }).clockwise === false && (bulgeToArc(A, B, -0.5) as { clockwise: boolean }).clockwise === true, 'ok');
  check('a zero bulge stays a straight line', bulgeToArc(A, B, 0).kind === 'line', 'ok');
  check('a bulge on a zero-length chord degrades to a line, not a NaN arc', bulgeToArc(A, A, 0.5).kind === 'line', 'ok');
}

/* --- 2. ARC entity -------------------------------------------------------- */

{
  for (const [a0, a1, expectDeg] of [[0, 90, 90], [0, 180, 180], [0, 270, 270], [270, 45, 135]] as const) {
    const r = arcEntityToSegment({ x: 0, y: 0 }, 50, a0, a1);
    if (!r) {
      check(`ARC ${a0}->${a1} resolves`, false, 'null');
      continue;
    }
    // Independent expectation: arc length is r x theta, full stop.
    const expected = ((expectDeg * Math.PI) / 180) * 50;
    check(
      `ARC ${a0}->${a1}: length is r x theta`,
      Math.abs(segmentArcLength(r.from, r.to, r.geometry) - expected) < 1e-6,
      `${segmentArcLength(r.from, r.to, r.geometry).toFixed(6)} vs ${expected.toFixed(6)}`,
    );
    check(
      `ARC ${a0}->${a1}: largeArc set iff the sweep exceeds 180deg`,
      (r.geometry.kind === 'arc' && r.geometry.largeArc) === expectDeg > 180,
      'ok',
    );
  }
  check('a full-circle ARC has no two ends and is refused', arcEntityToSegment({ x: 0, y: 0 }, 50, 90, 90) === null, 'ok');
  check('a zero-radius ARC is refused', arcEntityToSegment({ x: 0, y: 0 }, 0, 0, 90) === null, 'ok');
}

/* --- 3. SPLINE ------------------------------------------------------------ */

{
  const cps = [{ x: 0, y: 0 }, { x: 10, y: 40 }, { x: 60, y: 40 }, { x: 80, y: 0 }];
  const exact = splineToSegments({ degree: 3, controlPoints: cps, knots: [0, 0, 0, 0, 1, 1, 1, 1], closed: false });
  check('a degree-3 SPLINE with 4 control points is exact', exact?.exact === true, String(exact?.exact));
  check(
    'its control points become the cubic\'s handles, unchanged',
    exact !== null && exact.geometry[0]?.kind === 'cubic' &&
      JSON.stringify((exact.geometry[0] as { control1: unknown; control2: unknown }).control1) === JSON.stringify(cps[1]) &&
      JSON.stringify((exact.geometry[0] as { control1: unknown; control2: unknown }).control2) === JSON.stringify(cps[2]),
    JSON.stringify(exact?.geometry[0]),
  );

  // A curve that is not one Bezier must be chorded, and the chording must
  // actually meet the tolerance it claims. Checked by measuring the real
  // curve's distance from the chords that replaced it.
  const nurbs = {
    degree: 3,
    controlPoints: [
      { x: 0, y: 0 }, { x: 20, y: 60 }, { x: 50, y: -40 },
      { x: 90, y: 60 }, { x: 120, y: -20 }, { x: 150, y: 20 },
    ],
    knots: [0, 0, 0, 0, 1, 2, 3, 3, 3, 3],
    closed: false,
  };
  for (const tolerance of [0.5, 0.1, 0.01]) {
    const out = splineToSegments(nurbs, tolerance);
    if (!out) {
      check(`NURBS at tolerance ${tolerance} evaluates`, false, 'null');
      continue;
    }
    check(`a general NURBS is reported as approximated at tolerance ${tolerance}`, !out.exact && out.approximation !== undefined, out.approximation ?? '');

    // Re-evaluate the true curve densely and measure how far it strays from
    // the emitted chain. This is the claim the diagnostic makes, tested.
    let worst = 0;
    const dense = splineToSegments(nurbs, tolerance / 200)!.points;
    for (const p of dense) {
      let best = Infinity;
      for (let i = 0; i + 1 < out.points.length; i += 1) {
        const a = out.points[i]!;
        const b = out.points[i + 1]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l2 = dx * dx + dy * dy;
        const t = l2 < 1e-24 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
        best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
      }
      worst = Math.max(worst, best);
    }
    check(`…and the chords really are within ${tolerance}mm of the curve`, worst <= tolerance, `worst deviation ${worst.toFixed(6)}mm`);
  }

  check(
    'a tighter tolerance produces more segments',
    splineToSegments(nurbs, 0.01)!.points.length > splineToSegments(nurbs, 0.5)!.points.length,
    'ok',
  );
  check('an inconsistent knot vector is refused, not guessed at', splineToSegments({ degree: 3, controlPoints: cps, knots: [0, 1, 2], closed: false }) === null, 'ok');
  check('too few control points for the degree is refused', splineToSegments({ degree: 3, controlPoints: cps.slice(0, 2), knots: [0, 0, 0, 0, 1, 1], closed: false }) === null, 'ok');
}

/* --- 4. End to end: the kernel receives real curves ------------------------ */

{
  const bulgeDoc = load('bulge');
  const piece = bulgeDoc.document.pieces[0]!;
  const kinds = piece.segments.map((s) => s.geometry.kind);
  check('a bulge fixture imports one piece', bulgeDoc.document.pieces.length === 1, `${bulgeDoc.document.pieces.length}`);
  check('exactly the bulged edge is an arc; the rest stay lines', JSON.stringify(kinds) === JSON.stringify(['line', 'line', 'arc', 'line']), JSON.stringify(kinds));

  const arcSeg = piece.segments.find((s) => s.geometry.kind === 'arc')!;
  const from = positionOf(piece, arcSeg.from);
  const to = positionOf(piece, arcSeg.to);
  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  const length = segmentArcLength(from, to, arcSeg.geometry);
  check(
    'the geometry kernel measures it as a semicircle, not as its chord',
    Math.abs(length - (Math.PI * chord) / 2) < 1e-6 && length > chord * 1.5,
    `arc length ${length.toFixed(6)} vs chord ${chord.toFixed(6)}`,
  );
  check(
    'flattening the imported arc yields a genuinely curved polyline',
    flattenSegment(from, to, arcSeg.geometry).length > 4,
    `${flattenSegment(from, to, arcSeg.geometry).length} points`,
  );
  check(
    'points either side of a curved segment are curve points, not corners',
    piece.points.filter((p) => p.role === 'curve').length === 2,
    `${piece.points.filter((p) => p.role === 'curve').length}`,
  );
  {
    /*
     * Which *way* the arc bows. This is the check that matters and the one
     * that is easiest to leave out: radius, chord length and sagitta
     * magnitude are all identical whichever side the arc swings to, so a
     * handedness bug sails past every one of them. It has to be pinned to an
     * absolute position.
     *
     * The fixture's bulged edge runs (100,100) -> (0,100) in the file with a
     * bulge of +1 — counter-clockwise in DXF's y-up frame, centre (50,100),
     * bowing through (50,150), which is *outside* a square spanning y 0..100.
     * In piece space that endpoint pair is (100,-100) -> (0,-100) and the
     * apex must still be outside, at (50,-150). If it lands at (50,-50) the
     * arc has been mirrored into the piece.
     */
    const apex = pointOnSegment(from, to, arcSeg.geometry, 0.5);
    const expected: Vec2 = { x: 50, y: -150 };
    check(
      'the arc bows to the side the file drew it on, not mirrored into the piece',
      Math.abs(apex.x - expected.x) < 1e-6 && Math.abs(apex.y - expected.y) < 1e-6,
      `apex ${JSON.stringify(apex)} expected ${JSON.stringify(expected)}`,
    );
  }
  check('exact reconstruction is reported', bulgeDoc.issues.some((i) => i.code === 'curve-preserved-exactly' && i.message.includes('bulge arc')), 'ok');
  check('nothing is reported as approximated', !bulgeDoc.issues.some((i) => i.code === 'curve-approximated'), 'ok');
}

{
  const arcDoc = load('arc');
  const piece = arcDoc.document.pieces[0]!;
  const kinds = piece.segments.map((s) => s.geometry.kind);
  check('an ARC entity joins the boundary chain between two polylines', JSON.stringify(kinds) === JSON.stringify(['line', 'arc', 'line', 'line']), JSON.stringify(kinds));
  const arcSeg = piece.segments[1]!;
  check(
    'the chained ARC keeps its true radius',
    arcSeg.geometry.kind === 'arc' && Math.abs(arcSeg.geometry.radius - 50) < 1e-9,
    JSON.stringify(arcSeg.geometry),
  );
  {
    // Same handedness check for a standalone ARC entity. The fixture sweeps
    // centre (100,50) r=50 from 270deg to 90deg — counter-clockwise, so
    // through (150,50), bulging away from the piece. X is untouched by the
    // Y-flip, so the apex must be at x=150; x=50 means it was mirrored.
    const a = positionOf(piece, arcSeg.from);
    const b = positionOf(piece, arcSeg.to);
    const apex = pointOnSegment(a, b, arcSeg.geometry, 0.5);
    check(
      'a standalone ARC sweeps the way DXF says it does (counter-clockwise)',
      Math.abs(apex.x - 150) < 1e-6 && Math.abs(apex.y - -50) < 1e-6,
      `apex ${JSON.stringify(apex)} expected {"x":150,"y":-50}`,
    );
  }
  check('the ARC is reported as exact', arcDoc.issues.some((i) => i.code === 'curve-preserved-exactly' && i.message.includes('ARC')), 'ok');
  check('the layer report shows the ARC as a curve, not as skipped', arcDoc.layers.some((l) => l.entity === 'ARC' && l.treatment === 'curve'), JSON.stringify(arcDoc.layers.filter((l) => l.entity === 'ARC')));
}

{
  const cubicDoc = load('spline-cubic');
  const piece = cubicDoc.document.pieces[0]!;
  check('a 2-point boundary closed by a curve is a piece, not a degenerate ring', cubicDoc.document.pieces.length === 1, `${cubicDoc.document.pieces.length}`);
  check('the SPLINE became a real cubic segment', piece.segments.some((s) => s.geometry.kind === 'cubic'), JSON.stringify(piece.segments.map((s) => s.geometry.kind)));
  const cubic = piece.segments.find((s) => s.geometry.kind === 'cubic')!;
  check(
    'its handles were flipped into piece space with the points, not left in file space',
    cubic.geometry.kind === 'cubic' && cubic.geometry.control1.y < 0 && cubic.geometry.control2.y < 0,
    JSON.stringify(cubic.geometry),
  );
  check(
    'the kernel measures the cubic as longer than its chord',
    segmentArcLength(positionOf(piece, cubic.from), positionOf(piece, cubic.to), cubic.geometry) > 100,
    'ok',
  );
  check('it is reported as exact, not approximated', cubicDoc.issues.some((i) => i.code === 'curve-preserved-exactly' && i.message.includes('cubic SPLINE')) && !cubicDoc.issues.some((i) => i.code === 'curve-approximated'), 'ok');
}

{
  const nurbsDoc = load('spline-nurbs');
  const piece = nurbsDoc.document.pieces[0]!;
  check('a general NURBS still imports as a piece', nurbsDoc.document.pieces.length === 1, `${nurbsDoc.document.pieces.length}`);
  check('it arrives as many straight segments, since the model cannot hold it', piece.segments.length > 20 && piece.segments.every((s) => s.geometry.kind === 'line'), `${piece.segments.length} segments`);
  check(
    'the approximation is reported, with its tolerance',
    nurbsDoc.issues.some((i) => i.code === 'curve-approximated' && i.severity === 'warning' && i.message.includes('0.1mm')),
    nurbsDoc.issues.find((i) => i.code === 'curve-approximated')?.message ?? 'missing',
  );
  check('nothing claims it was preserved exactly', !nurbsDoc.issues.some((i) => i.code === 'curve-preserved-exactly'), 'ok');
}

/* --- 5. Curve support is inert on files that have no curves ---------------- */

{
  for (const name of ['5109s-sp27-pattern', 'tshirt-demo-aama', '8178v-accumark']) {
    const path = fileURLToPath(new URL(`./fixtures/dxf/${name}.dxf`, import.meta.url));
    const { document } = importDxfWithDiagnostics(readFileSync(path, 'utf8'), { flavour: 'aama', assumeUnit: 'mm' });
    check(
      `${name}: every segment is still a straight line`,
      document.pieces.every((p) => p.segments.every((s) => s.geometry.kind === 'line')),
      'ok',
    );
    check(
      `${name}: every boundary point is still a corner`,
      document.pieces.every((p) => p.points.filter((pt) => pt.role === 'curve').length === 0),
      'ok',
    );
  }
}

console.log(failures === 0 ? '\nAll DXF curve checks passed.' : `\n${failures} DXF curve check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
