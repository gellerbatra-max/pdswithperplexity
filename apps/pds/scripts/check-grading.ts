import {
  gradePiece,
  nestPiece,
  gradeVectors,
  gradeDiagnostics,
  evaluateMeasurement,
  evaluateMeasurementAtSize,
  lengthAlongSegment,
  pointAlongSegment,
  findSegment,
} from '../src/pattern/index.ts';
import type {
  GradeRule,
  MeasurementLink,
  PatternDocument,
  PatternPiece,
  SizeRange,
} from '../src/pattern/index.ts';
import {
  createGradeRule,
  renameGradeRule,
  deleteGradeRule,
  setGradeIncrement,
  setPointsGradeRule,
  useDocumentStore,
  useHistoryStore,
} from '../src/store/index.ts';

/**
 * Regression suite for the grading engine and its command layer.
 *
 * Run it with:
 *
 *   npm run check:grading
 *
 * `pattern/nest.ts` and `pattern/grading.ts` are tested as pure functions
 * against synthetic fixtures, independent of the seed document — the seed
 * exists to make the app demoable, not to pin down what "correct" means.
 * `store/gradeCommands.ts` is tested against the real Zustand stores, because
 * the acceptance bar here is that grading is command-driven with exact
 * undo/redo, not just that the underlying math is right.
 */

let failures = 0;
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) failures += 1;
};

/** Structural identity, independent of key order — same helper as check-roundtrip.ts. */
const shape = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort())
      : v,
  );

/**
 * Document identity for "did this command's undo restore everything",
 * blind to `updatedAt`. `documentStore.applyDocument` stamps a fresh
 * `updatedAt` on *every* write — including the write undo itself performs —
 * so two genuinely identical documents a real undo away from each other will
 * still carry different timestamps. That is correct app behaviour (it is
 * what lets a "last edited" readout be accurate), not something a content
 * comparison should be checking.
 */
const shapeDocument = (document: PatternDocument): string => shape({ ...document, updatedAt: null });

/* --- Size range and rules ---------------------------------------------------- */

const sizeRange: SizeRange = {
  baseSizeId: 'sz-m',
  sizes: [
    { id: 'sz-s', label: 'S', order: 0 },
    { id: 'sz-m', label: 'M', order: 1 },
    { id: 'sz-l', label: 'L', order: 2 },
  ],
};

/** Grades ±10 in X per step away from base — used on one end of the test cubic. */
const ruleWidth: GradeRule = {
  id: 'gr-width',
  code: 'W',
  label: 'Width',
  increments: [
    { sizeId: 'sz-s', dx: -10, dy: 0 },
    { sizeId: 'sz-m', dx: 0, dy: 0 },
    { sizeId: 'sz-l', dx: 10, dy: 0 },
  ],
};

/** Grades ±8 in Y per step — used on the other end, so the two ends disagree. */
const ruleLength: GradeRule = {
  id: 'gr-length',
  code: 'L',
  label: 'Length',
  increments: [
    { sizeId: 'sz-s', dx: 0, dy: -8 },
    { sizeId: 'sz-m', dx: 0, dy: 0 },
    { sizeId: 'sz-l', dx: 0, dy: 8 },
  ],
};

const ruleZero: GradeRule = {
  id: 'gr-zero',
  code: 'Z',
  label: 'No movement',
  increments: sizeRange.sizes.map((s) => ({ sizeId: s.id, dx: 0, dy: 0 })),
};

/** Opens up aggressively at L only — sized to trip the arc-radius diagnostic there and nowhere else. */
const ruleWiden: GradeRule = {
  id: 'gr-widen',
  code: 'WD',
  label: 'Widen a lot',
  increments: [
    { sizeId: 'sz-s', dx: -5, dy: 0 },
    { sizeId: 'sz-m', dx: 0, dy: 0 },
    { sizeId: 'sz-l', dx: 20, dy: 0 },
  ],
};

const ruleMateA: GradeRule = {
  id: 'gr-mate-a',
  code: 'MA',
  label: 'Mate A',
  increments: [
    { sizeId: 'sz-s', dx: -5, dy: 0 },
    { sizeId: 'sz-m', dx: 0, dy: 0 },
    { sizeId: 'sz-l', dx: 5, dy: 0 },
  ],
};

/** Deliberately a different rate from `ruleMateA`, so two mated seams pull apart. */
const ruleMateB: GradeRule = {
  id: 'gr-mate-b',
  code: 'MB',
  label: 'Mate B',
  increments: [
    { sizeId: 'sz-s', dx: -15, dy: 0 },
    { sizeId: 'sz-m', dx: 0, dy: 0 },
    { sizeId: 'sz-l', dx: 15, dy: 0 },
  ],
};

const ALL_RULES: readonly GradeRule[] = [
  ruleWidth,
  ruleLength,
  ruleZero,
  ruleWiden,
  ruleMateA,
  ruleMateB,
];

/* --- Fixtures ----------------------------------------------------------------- */

/**
 * A cubic whose two ends carry different rules (so the fix for the averaging
 * bug is actually exercised), a line, an arc with plenty of headroom, and a
 * notch on the cubic.
 */
const buildGradingPiece = (): PatternPiece => ({
  id: 'gp1',
  name: 'Grading Fixture',
  points: [
    { id: 'a', position: { x: 0, y: 0 }, role: 'corner', gradeRuleId: 'gr-width' },
    { id: 'b', position: { x: 100, y: 0 }, role: 'corner', gradeRuleId: 'gr-length' },
    { id: 'c', position: { x: 150, y: 100 }, role: 'corner' },
    { id: 'd', position: { x: 150, y: 200 }, role: 'corner', gradeRuleId: 'gr-width' },
    { id: 'e', position: { x: 0, y: 200 }, role: 'corner' },
  ],
  segments: [
    {
      id: 's-ab',
      from: 'a',
      to: 'b',
      geometry: { kind: 'cubic', control1: { x: 30, y: -20 }, control2: { x: 70, y: -20 } },
    },
    { id: 's-bc', from: 'b', to: 'c', geometry: { kind: 'line' } },
    {
      id: 's-cd',
      from: 'c',
      to: 'd',
      geometry: { kind: 'arc', radius: 60, largeArc: false, clockwise: false },
    },
    { id: 's-de', from: 'd', to: 'e', geometry: { kind: 'line' } },
    { id: 's-ea', from: 'e', to: 'a', geometry: { kind: 'line' } },
  ],
  boundary: ['s-ab', 's-bc', 's-cd', 's-de', 's-ea'],
  closed: true,
  seamAllowance: 10,
  notches: [{ id: 'n1', segmentId: 's-ab', t: 0.5, kind: 'slit', depth: 6, width: 2, angle: 0 }],
  internalLines: [],
  meta: { code: 'GP1', category: 'shell', fabric: 'F', quantity: 1, onFold: false, mirrored: false },
});

/** A tight arc whose radius the `gr-widen` rule pushes past its limit — at L only. */
const buildArcPiece = (): PatternPiece => ({
  id: 'arc-fixture',
  name: 'Arc Fixture',
  points: [
    { id: 'c', position: { x: 0, y: 0 }, role: 'corner' },
    { id: 'd', position: { x: 100, y: 0 }, role: 'corner', gradeRuleId: 'gr-widen' },
    { id: 'e', position: { x: 100, y: -100 }, role: 'corner' },
    { id: 'f', position: { x: 0, y: -100 }, role: 'corner' },
  ],
  segments: [
    { id: 's1', from: 'c', to: 'd', geometry: { kind: 'arc', radius: 52, largeArc: false, clockwise: true } },
    { id: 's2', from: 'd', to: 'e', geometry: { kind: 'line' } },
    { id: 's3', from: 'e', to: 'f', geometry: { kind: 'line' } },
    { id: 's4', from: 'f', to: 'c', geometry: { kind: 'line' } },
  ],
  boundary: ['s1', 's2', 's3', 's4'],
  closed: true,
  seamAllowance: 10,
  notches: [],
  internalLines: [],
  meta: { code: 'ARC', category: 'shell', fabric: 'F', quantity: 1, onFold: false, mirrored: false },
});

/** Two pieces sharing a mated seam, graded at different rates so it pulls apart. */
const buildMismatchedMates = (): readonly [PatternPiece, PatternPiece] => {
  const a: PatternPiece = {
    id: 'mate-a',
    name: 'Mate A',
    points: [
      { id: 'a1', position: { x: 0, y: 0 }, role: 'corner' },
      { id: 'a2', position: { x: 100, y: 0 }, role: 'corner', gradeRuleId: 'gr-mate-a' },
      { id: 'a3', position: { x: 100, y: 100 }, role: 'corner' },
      { id: 'a4', position: { x: 0, y: 100 }, role: 'corner' },
    ],
    segments: [
      { id: 'a-s1', from: 'a1', to: 'a2', geometry: { kind: 'line' }, mateSegmentId: 'b-s1' },
      { id: 'a-s2', from: 'a2', to: 'a3', geometry: { kind: 'line' } },
      { id: 'a-s3', from: 'a3', to: 'a4', geometry: { kind: 'line' } },
      { id: 'a-s4', from: 'a4', to: 'a1', geometry: { kind: 'line' } },
    ],
    boundary: ['a-s1', 'a-s2', 'a-s3', 'a-s4'],
    closed: true,
    seamAllowance: 10,
    notches: [],
    internalLines: [],
    meta: { code: 'MA', category: 'shell', fabric: 'F', quantity: 1, onFold: false, mirrored: false },
  };
  const b: PatternPiece = {
    id: 'mate-b',
    name: 'Mate B',
    points: [
      { id: 'b1', position: { x: 0, y: 0 }, role: 'corner' },
      { id: 'b2', position: { x: 100, y: 0 }, role: 'corner', gradeRuleId: 'gr-mate-b' },
      { id: 'b3', position: { x: 100, y: 80 }, role: 'corner' },
      { id: 'b4', position: { x: 0, y: 80 }, role: 'corner' },
    ],
    segments: [
      { id: 'b-s1', from: 'b1', to: 'b2', geometry: { kind: 'line' }, mateSegmentId: 'a-s1' },
      { id: 'b-s2', from: 'b2', to: 'b3', geometry: { kind: 'line' } },
      { id: 'b-s3', from: 'b3', to: 'b4', geometry: { kind: 'line' } },
      { id: 'b-s4', from: 'b4', to: 'b1', geometry: { kind: 'line' } },
    ],
    boundary: ['b-s1', 'b-s2', 'b-s3', 'b-s4'],
    closed: true,
    seamAllowance: 10,
    notches: [],
    internalLines: [],
    meta: { code: 'MB', category: 'shell', fabric: 'F', quantity: 1, onFold: false, mirrored: false },
  };
  return [a, b];
};

/** Same shape, same rule on both sides — the negative control for the mating check. */
const buildMatchedMates = (): readonly [PatternPiece, PatternPiece] => {
  const [a, b] = buildMismatchedMates();
  return [
    a,
    { ...b, id: 'mate-b2', points: b.points.map((p) => (p.gradeRuleId ? { ...p, gradeRuleId: 'gr-mate-a' } : p)) },
  ];
};

const timestamp = (): string => new Date().toISOString();

const buildDocument = (
  pieces: readonly PatternPiece[],
  rules: readonly GradeRule[] = ALL_RULES,
  measurements: readonly MeasurementLink[] = [],
): PatternDocument => ({
  schemaVersion: 1,
  id: 'doc-grading-fixture',
  name: 'Grading Fixture Document',
  style: { code: 'TEST', name: 'Test' },
  unit: 'mm',
  sizeRange,
  pieces,
  measurements,
  gradeRules: rules,
  createdAt: timestamp(),
  updatedAt: timestamp(),
});

/* --- 1. Base size round trip -------------------------------------------------- */

{
  const piece = buildGradingPiece();
  const graded = gradePiece(piece, ALL_RULES, sizeRange.baseSizeId);

  check(
    'grading at the base size leaves every point position unchanged',
    graded.points.every((p, i) => {
      const original = piece.points[i]!;
      return p.position.x === original.position.x && p.position.y === original.position.y;
    }),
    'ok',
  );

  const gradedCubic = graded.segments.find((s) => s.id === 's-ab');
  const originalCubic = piece.segments.find((s) => s.id === 's-ab');
  check(
    'grading at the base size leaves cubic handles unchanged',
    gradedCubic?.geometry.kind === 'cubic' &&
      originalCubic?.geometry.kind === 'cubic' &&
      shape(gradedCubic.geometry) === shape(originalCubic.geometry),
    'ok',
  );

  check(
    'grading at the base size leaves an arc segment byte-identical',
    shape(graded.segments.find((s) => s.id === 's-cd')) === shape(piece.segments.find((s) => s.id === 's-cd')),
    'ok',
  );
}

/* --- 2. Multiple size application -------------------------------------------- */

{
  const piece = buildGradingPiece();
  const nested = nestPiece(piece, ALL_RULES, sizeRange);

  check('nestPiece returns one entry per size', nested.length === sizeRange.sizes.length, `${nested.length}`);
  check(
    'nestPiece is in ascending size order',
    nested.map((n) => n.sizeId).join() === 'sz-s,sz-m,sz-l',
    nested.map((n) => n.sizeId).join(),
  );
  check(
    'nestPiece flags exactly the base size',
    nested.filter((n) => n.isBase).map((n) => n.sizeId).join() === 'sz-m',
    'ok',
  );

  for (const [sizeId, dx] of [
    ['sz-s', -10],
    ['sz-l', 10],
  ] as const) {
    const graded = gradePiece(piece, ALL_RULES, sizeId);
    const a = graded.points.find((p) => p.id === 'a')!;
    check(
      `point 'a' (gr-width) grades to the correct X at ${sizeId}`,
      a.position.x === dx && a.position.y === 0,
      `${a.position.x}, ${a.position.y}`,
    );
    const c = graded.points.find((p) => p.id === 'c')!;
    check(
      `ungraded point 'c' holds its base position at ${sizeId}`,
      c.position.x === 150 && c.position.y === 100,
      `${c.position.x}, ${c.position.y}`,
    );
  }

  check(
    'gradePiece caches: repeat calls for the same size return the same object',
    gradePiece(piece, ALL_RULES, 'sz-l') === gradePiece(piece, ALL_RULES, 'sz-l'),
    'ok',
  );
  check(
    'gradePiece does not cross-contaminate sizes',
    gradePiece(piece, ALL_RULES, 'sz-l') !== gradePiece(piece, ALL_RULES, 'sz-s'),
    'ok',
  );
}

/* --- 3. Cubic handles follow their own anchor, not an average ---------------- */

{
  const piece = buildGradingPiece();
  const graded = gradePiece(piece, ALL_RULES, 'sz-l');
  const original = piece.segments.find((s) => s.id === 's-ab')!;
  const gradedSegment = graded.segments.find((s) => s.id === 's-ab')!;

  if (original.geometry.kind === 'cubic' && gradedSegment.geometry.kind === 'cubic') {
    // 'a' carries gr-width (dx +10 at L), 'b' carries gr-length (dy +8 at L).
    // control1 belongs to 'a': only dx should move. control2 belongs to 'b':
    // only dy should move. The averaging bug this replaces would have moved
    // *both* handles by ((10+0)/2, (0+8)/2) = (5, 4).
    const expectedControl1 = { x: original.geometry.control1.x + 10, y: original.geometry.control1.y };
    const expectedControl2 = { x: original.geometry.control2.x, y: original.geometry.control2.y + 8 };

    check(
      "control1 (owned by 'a') moves by 'a's own delta only",
      gradedSegment.geometry.control1.x === expectedControl1.x &&
        gradedSegment.geometry.control1.y === expectedControl1.y,
      `${shape(gradedSegment.geometry.control1)} vs expected ${shape(expectedControl1)}`,
    );
    check(
      "control2 (owned by 'b') moves by 'b's own delta only",
      gradedSegment.geometry.control2.x === expectedControl2.x &&
        gradedSegment.geometry.control2.y === expectedControl2.y,
      `${shape(gradedSegment.geometry.control2)} vs expected ${shape(expectedControl2)}`,
    );
  } else {
    check('cubic handle fixture resolved to cubic geometry', false, 'geometry kind changed');
  }
}

/* --- 4. Arcs hold their radius while their endpoints grade -------------------- */

{
  const piece = buildGradingPiece();
  for (const sizeId of ['sz-s', 'sz-l'] as const) {
    const graded = gradePiece(piece, ALL_RULES, sizeId);
    const original = piece.segments.find((s) => s.id === 's-cd')!;
    const gradedSegment = graded.segments.find((s) => s.id === 's-cd')!;
    check(
      `arc radius/largeArc/clockwise are unchanged at ${sizeId}`,
      original.geometry.kind === 'arc' &&
        gradedSegment.geometry.kind === 'arc' &&
        shape(gradedSegment.geometry) === shape(original.geometry),
      'ok',
    );
    const d = graded.points.find((p) => p.id === 'd')!;
    const c = graded.points.find((p) => p.id === 'c')!;
    check(
      `arc endpoint 'd' (gr-width) actually moved at ${sizeId}`,
      d.position.x !== 150 || sizeId === 'sz-m',
      `${d.position.x}`,
    );
    check(`arc endpoint 'c' (ungraded) held its position at ${sizeId}`, c.position.x === 150 && c.position.y === 100, 'ok');
  }
}

/* --- 5. Notches ride the regrade for free ------------------------------------ */

{
  const piece = buildGradingPiece();
  const before = lengthAlongSegment(piece, piece.segments.find((s) => s.id === 's-ab')!, 0.5);

  const graded = gradePiece(piece, ALL_RULES, 'sz-l');
  const notch = graded.notches.find((n) => n.id === 'n1');
  check('grading does not touch notch identity or parameter', notch?.t === 0.5, `${notch?.t}`);

  const gradedSegment = findSegment(graded, 's-ab')!;
  const at = pointAlongSegment(graded, gradedSegment, notch!.t);
  const after = lengthAlongSegment(graded, gradedSegment, notch!.t);
  check(
    'the notch resolves to a real position on the regraded curve',
    at !== null && Number.isFinite(at.x) && Number.isFinite(at.y),
    `${shape(at)}`,
  );
  check(
    "the notch's distance along the seam changes when the curve it rides does",
    Math.abs(after - before) > 1,
    `${before.toFixed(2)}mm -> ${after.toFixed(2)}mm`,
  );
}

/* --- 6. gradeVectors ----------------------------------------------------------- */

{
  const piece = buildGradingPiece();
  const vectors = gradeVectors(piece, ALL_RULES, sizeRange);
  const forA = vectors.find((v) => v.pointId === 'a');
  check(
    "gradeVectors spans smallest to largest size for a graded point ('a')",
    forA !== undefined && forA.from.x === -10 && forA.to.x === 10,
    `${shape(forA)}`,
  );
  check(
    'gradeVectors omits points that do not move across the range',
    vectors.every((v) => v.pointId !== 'c' && v.pointId !== 'e'),
    'ok',
  );
}

/* --- 7. Grade diagnostics: arc radius repair ---------------------------------- */

{
  const arcPiece = buildArcPiece();
  const doc = buildDocument([arcPiece]);
  const findings = gradeDiagnostics(doc, arcPiece.id);
  const arcFindings = findings.filter((f) => f.code === 'grade-arc-repair');

  check(
    'arc radius diagnostic fires at L (chord opens past 2x radius)',
    arcFindings.some((f) => f.sizeId === 'sz-l'),
    arcFindings.map((f) => f.sizeId).join(),
  );
  check(
    'arc radius diagnostic does not fire at S (chord stays within 2x radius)',
    !arcFindings.some((f) => f.sizeId === 'sz-s'),
    arcFindings.map((f) => f.sizeId).join(),
  );
  check('arc radius diagnostic never fires at the base size', !arcFindings.some((f) => f.sizeId === 'sz-m'), 'ok');

  const wellBehaved = buildGradingPiece();
  const noFindings = gradeDiagnostics(buildDocument([wellBehaved]), wellBehaved.id).filter(
    (f) => f.code === 'grade-arc-repair',
  );
  check('a generously-radiused arc under moderate grading raises nothing', noFindings.length === 0, `${noFindings.length}`);
}

/* --- 8. Grade diagnostics: mated seams -------------------------------------- */

{
  const [a, b] = buildMismatchedMates();
  const findings = gradeDiagnostics(buildDocument([a, b])).filter((f) => f.code === 'grade-mate-mismatch');
  check(
    'mismatched mates are flagged at both non-base sizes',
    findings.some((f) => f.sizeId === 'sz-s') && findings.some((f) => f.sizeId === 'sz-l'),
    findings.map((f) => f.sizeId).join(),
  );
  check('mismatched mates are not flagged at the base size', !findings.some((f) => f.sizeId === 'sz-m'), 'ok');

  const [ma, mb] = buildMatchedMates();
  const matched = gradeDiagnostics(buildDocument([ma, mb])).filter((f) => f.code === 'grade-mate-mismatch');
  check('mates graded on the same rule never mismatch', matched.length === 0, `${matched.length}`);
}

/* --- 9. Measurement under grade ------------------------------------------------ */

{
  const piece = buildGradingPiece();
  const link: MeasurementLink = {
    id: 'm1',
    code: 'M-01',
    label: 'A to E',
    kind: 'point-to-point',
    refs: [{ pieceId: piece.id, pointIds: ['a', 'e'] }],
    includeSeamAllowance: false,
  };
  const doc = buildDocument([piece], ALL_RULES, [link]);

  const atBase = evaluateMeasurementAtSize(doc, link, 'sz-m');
  check(
    'evaluateMeasurementAtSize at the base size matches evaluateMeasurement',
    atBase === evaluateMeasurement(doc, link),
    `${atBase} vs ${evaluateMeasurement(doc, link)}`,
  );

  const atL = evaluateMeasurementAtSize(doc, link, 'sz-l');
  // Independently graded: 'a' carries gr-width (+10 at L), 'e' is ungraded.
  const gradedPiece = gradePiece(piece, ALL_RULES, 'sz-l');
  const a = gradedPiece.points.find((p) => p.id === 'a')!;
  const e = gradedPiece.points.find((p) => p.id === 'e')!;
  const expected = Math.hypot(e.position.x - a.position.x, e.position.y - a.position.y);
  check(
    'evaluateMeasurementAtSize at L matches an independently graded distance',
    atL !== null && Math.abs(atL - expected) < 1e-9,
    `${atL} vs ${expected}`,
  );
  check('the graded measurement actually differs from the base', atL !== evaluateMeasurement(doc, link), `${atL}`);
}

/* --- 10. Commands: undo/redo exactness ---------------------------------------- */

/** Fresh document + reset history, so command tests don't see each other's state. */
const withFreshStore = (build: () => PatternDocument, run: () => void): void => {
  useDocumentStore.getState().setDocument(build());
  useHistoryStore.getState().reset();
  run();
};

withFreshStore(
  () => buildDocument([buildGradingPiece()]),
  () => {
    const before = useDocumentStore.getState().document;

    const id = createGradeRule('NEW', 'New rule');
    const afterCreate = useDocumentStore.getState().document;
    check(
      'createGradeRule adds a rule with every size held at zero',
      afterCreate.gradeRules.find((r) => r.id === id)?.increments.every((i) => i.dx === 0 && i.dy === 0) ?? false,
      'ok',
    );

    useHistoryStore.getState().undo();
    check(
      'undo createGradeRule restores the document exactly',
      shapeDocument(useDocumentStore.getState().document) === shapeDocument(before),
      'ok',
    );

    useHistoryStore.getState().redo();
    check(
      'redo createGradeRule replays the same rule id',
      useDocumentStore.getState().document.gradeRules.some((r) => r.id === id),
      'ok',
    );
  },
);

withFreshStore(
  () => buildDocument([buildGradingPiece()]),
  () => {
    const before = useDocumentStore.getState().document;

    renameGradeRule('gr-width', { code: 'WID', label: 'Chest width' });
    const renamed = useDocumentStore.getState().document.gradeRules.find((r) => r.id === 'gr-width');
    check('renameGradeRule updates code and label', renamed?.code === 'WID' && renamed.label === 'Chest width', shape(renamed));

    useHistoryStore.getState().undo();
    check(
      'undo renameGradeRule restores the document exactly',
      shapeDocument(useDocumentStore.getState().document) === shapeDocument(before),
      'ok',
    );
  },
);

withFreshStore(
  () => buildDocument([buildGradingPiece()]),
  () => {
    const before = useDocumentStore.getState().document;

    setGradeIncrement('gr-width', 'sz-l', 25, 3);
    const rule = useDocumentStore.getState().document.gradeRules.find((r) => r.id === 'gr-width');
    const increment = rule?.increments.find((i) => i.sizeId === 'sz-l');
    check('setGradeIncrement writes the new dx/dy', increment?.dx === 25 && increment.dy === 3, shape(increment));

    setGradeIncrement('gr-width', 'sz-m', 99, 99);
    check(
      'setGradeIncrement refuses to write a non-zero increment at the base size',
      useDocumentStore.getState().document.gradeRules.find((r) => r.id === 'gr-width')?.increments.find((i) => i.sizeId === 'sz-m')
        ?.dx !== 99,
      'ok',
    );

    useHistoryStore.getState().undo();
    check(
      'undo setGradeIncrement restores the document exactly',
      shapeDocument(useDocumentStore.getState().document) === shapeDocument(before),
      'ok',
    );
  },
);

withFreshStore(
  () => buildDocument([buildGradingPiece()]),
  () => {
    const before = useDocumentStore.getState().document;

    setPointsGradeRule('gp1', ['c', 'e'], 'gr-zero');
    const afterAssign = useDocumentStore.getState().document.pieces[0]!;
    check(
      'setPointsGradeRule assigns a rule to every point in the list',
      afterAssign.points.find((p) => p.id === 'c')?.gradeRuleId === 'gr-zero' &&
        afterAssign.points.find((p) => p.id === 'e')?.gradeRuleId === 'gr-zero',
      'ok',
    );

    setPointsGradeRule('gp1', ['c'], undefined);
    const cleared = useDocumentStore.getState().document.pieces[0]!.points.find((p) => p.id === 'c');
    check(
      'clearing a grade rule removes the field rather than setting it undefined',
      cleared !== undefined && !('gradeRuleId' in cleared),
      shape(cleared),
    );

    useHistoryStore.getState().undo();
    useHistoryStore.getState().undo();
    check(
      'undoing both assignments restores the document exactly',
      shapeDocument(useDocumentStore.getState().document) === shapeDocument(before),
      'ok',
    );

    useHistoryStore.getState().redo();
    useHistoryStore.getState().redo();
    check(
      'redoing both assignments reaches the same state as the first time',
      shape(useDocumentStore.getState().document.pieces[0]!.points.find((p) => p.id === 'c')) === shape(cleared),
      'ok',
    );
  },
);

/** deleteGradeRule must cascade across every piece that references it, and undo exactly. */
withFreshStore(
  () => buildDocument([buildGradingPiece(), buildArcPiece()]),
  () => {
    // Put gr-width on the arc piece too, so the cascade has to cross pieces.
    setPointsGradeRule('arc-fixture', ['e'], 'gr-width');
    const before = useDocumentStore.getState().document;
    const usersBefore = before.pieces.flatMap((p) => p.points.filter((pt) => pt.gradeRuleId === 'gr-width'));
    check('fixture actually has gr-width on points across two pieces', usersBefore.length >= 2, `${usersBefore.length}`);

    deleteGradeRule('gr-width');
    const after = useDocumentStore.getState().document;
    check('deleteGradeRule removes the rule', !after.gradeRules.some((r) => r.id === 'gr-width'), 'ok');
    check(
      'deleteGradeRule un-assigns it from every point, on every piece',
      after.pieces.every((p) => p.points.every((pt) => pt.gradeRuleId !== 'gr-width')),
      'ok',
    );
    // Scoped to the piece each point actually belongs to — 'd' exists on both
    // fixtures, and the arc piece's 'd' legitimately keeps its *own* rule
    // (gr-widen), which is a different point that happens to share an id
    // with gp1's, not a leftover from this deletion.
    const gp1After = after.pieces.find((p) => p.id === 'gp1')!;
    check(
      "the un-assigned points on gp1 had the field removed, not set undefined",
      ['a', 'd'].every((id) => {
        const point = gp1After.points.find((p) => p.id === id);
        return point !== undefined && !('gradeRuleId' in point);
      }),
      shape(gp1After.points),
    );
    const arcAfter = after.pieces.find((p) => p.id === 'arc-fixture')!;
    check(
      "the un-assigned point on arc-fixture ('e') had the field removed too",
      (() => {
        const point = arcAfter.points.find((p) => p.id === 'e');
        return point !== undefined && !('gradeRuleId' in point);
      })(),
      shape(arcAfter.points.find((p) => p.id === 'e')),
    );
    check(
      "arc-fixture's 'd' — a different point that only shares an id — keeps its own rule",
      arcAfter.points.find((p) => p.id === 'd')?.gradeRuleId === 'gr-widen',
      shape(arcAfter.points.find((p) => p.id === 'd')),
    );

    useHistoryStore.getState().undo();
    check(
      'undo deleteGradeRule restores the rule and every cascaded assignment exactly',
      shapeDocument(useDocumentStore.getState().document) === shapeDocument(before),
      'ok',
    );
  },
);

console.log(failures === 0 ? '\nAll grading checks passed.' : `\n${failures} grading check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
