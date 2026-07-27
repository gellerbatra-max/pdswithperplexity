import {
  addNotch,
  insertPointOnSegment,
  removeNotch,
  removePoint,
  setNotchKind,
  setNotchParameter,
  setPointPosition,
  setPointRole,
  setSegmentHandle,
  setSegmentKind,
  setSegmentSeamAllowance,
  translatePiece,
  translatePoints,
} from '../src/pattern/edit.ts';
import { resolveArc, tangentOnSegment } from '../src/pattern/curve.ts';
import {
  boundarySegments,
  lengthAlongSegment,
  outlineLength,
  segmentLength,
} from '../src/pattern/resolve.ts';
import type { PatternPiece } from '../src/pattern/piece.ts';

/**
 * Undo/redo symmetry audit for the geometry edit path.
 *
 * Run it with:
 *
 *   npm run check:roundtrip
 *
 * The commands in `store/geometryCommands.ts` undo by restoring the piece
 * object captured before the edit, which makes exact reversal a property of the
 * *pure* edits underneath rather than of the store: an edit that mutated its
 * input, or that produced a piece structurally different from a re-application,
 * would break undo in a way no type can catch.
 *
 * So this checks two things for every primitive:
 *
 *   1. **Immutability.** The input piece is byte-identical afterwards. If an
 *      edit mutated in place, the captured "before" would already be the after,
 *      and undo would restore nothing while looking like it worked.
 *   2. **Determinism.** Applying the same edit twice to the same input yields
 *      structurally identical results, ids included where they are not freshly
 *      minted. Redo replays commands, so a non-deterministic edit drifts.
 *
 * Plus the round trips that have an exact inverse — insert then delete a point,
 * add then remove a notch — checked on geometry, not just on counts.
 */

let failures = 0;
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) failures += 1;
};

/* --- A fixture with every feature the edits touch --------------------------- */

const buildPiece = (): PatternPiece => ({
  id: 'p1',
  name: 'Fixture',
  points: [
    { id: 'a', position: { x: 0, y: 0 }, role: 'corner', label: 'A' },
    { id: 'b', position: { x: 200, y: 40 }, role: 'curve' },
    { id: 'c', position: { x: 240, y: 300 }, role: 'corner' },
    { id: 'd', position: { x: 10, y: 280 }, role: 'curve' },
  ],
  segments: [
    {
      id: 's1',
      from: 'a',
      to: 'b',
      geometry: { kind: 'cubic', control1: { x: 60, y: -40 }, control2: { x: 150, y: -10 } },
      label: 'Top',
      seamAllowance: 12,
    },
    {
      id: 's2',
      from: 'b',
      to: 'c',
      geometry: { kind: 'cubic', control1: { x: 250, y: 130 }, control2: { x: 260, y: 220 } },
      label: 'Side',
    },
    { id: 's3', from: 'c', to: 'd', geometry: { kind: 'line' }, label: 'Hem' },
    {
      id: 's4',
      from: 'd',
      to: 'a',
      geometry: { kind: 'arc', radius: 180, largeArc: false, clockwise: true },
      label: 'Front',
    },
  ],
  boundary: ['s1', 's2', 's3', 's4'],
  closed: true,
  seamAllowance: 10,
  grainLine: { id: 'g1', kind: 'grain', from: 'a', to: 'c', arrows: 'both' },
  notches: [
    { id: 'n1', segmentId: 's1', t: 0.35, kind: 'slit', depth: 6, width: 2, angle: 0 },
    { id: 'n2', segmentId: 's2', t: 0.6, kind: 'v', depth: 6, width: 2, angle: 0, label: 'Balance' },
  ],
  internalLines: [
    { id: 'i1', role: 'fold', points: ['a', 'c'], closed: false, cut: false, label: 'Fold' },
  ],
  meta: {
    code: 'FX-1',
    category: 'shell',
    fabric: 'Poplin',
    quantity: 2,
    onFold: false,
    mirrored: false,
  },
});

/** Structural identity, independent of key order. */
const shape = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort())
      : v,
  );

/**
 * Every pure edit, as a named thunk. Ones that mint ids are marked, because
 * re-applying them cannot produce identical ids — their commands replay a
 * precomputed piece rather than re-running the factory, and that is the
 * property being relied on.
 */
const edits: readonly {
  name: string;
  mintsIds?: boolean;
  run: (piece: PatternPiece) => PatternPiece;
}[] = [
  { name: 'translatePiece', run: (p) => translatePiece(p, { x: 13.5, y: -7.25 }) },
  {
    name: 'translatePoints',
    run: (p) => translatePoints(p, new Map([['b', { x: 5, y: 9 }]])),
  },
  { name: 'setPointPosition', run: (p) => setPointPosition(p, 'c', { x: 300, y: 310 }) },
  { name: 'setPointRole -> corner', run: (p) => setPointRole(p, 'b', 'corner') },
  { name: 'setPointRole -> curve', run: (p) => setPointRole(p, 'c', 'curve') },
  { name: 'setSegmentKind line', run: (p) => setSegmentKind(p, 's1', 'line') },
  { name: 'setSegmentKind cubic', run: (p) => setSegmentKind(p, 's3', 'cubic') },
  { name: 'setSegmentKind arc', run: (p) => setSegmentKind(p, 's3', 'arc') },
  {
    name: 'setSegmentHandle',
    run: (p) => setSegmentHandle(p, 's1', 'control2', { x: 170, y: 90 }),
  },
  { name: 'setSegmentSeamAllowance set', run: (p) => setSegmentSeamAllowance(p, 's2', 7) },
  {
    name: 'setSegmentSeamAllowance clear',
    run: (p) => setSegmentSeamAllowance(p, 's1', undefined),
  },
  { name: 'setNotchParameter', run: (p) => setNotchParameter(p, 'n1', 0.8) },
  { name: 'setNotchKind', run: (p) => setNotchKind(p, 'n2', 'castle') },
  { name: 'removeNotch', run: (p) => removeNotch(p, 'n1') },
  { name: 'addNotch', mintsIds: true, run: (p) => addNotch(p, 's3', 0.4)?.piece ?? p },
  {
    name: 'insertPointOnSegment',
    mintsIds: true,
    run: (p) => insertPointOnSegment(p, 's2', 0.45)?.piece ?? p,
  },
  { name: 'removePoint', mintsIds: true, run: (p) => removePoint(p, 'b')?.piece ?? p },
];

/* --- 1. No edit may mutate its input ---------------------------------------- */

for (const edit of edits) {
  const piece = buildPiece();
  const before = shape(piece);
  const after = edit.run(piece);
  check(
    `${edit.name}: input untouched`,
    shape(piece) === before,
    after === piece ? 'no-op' : 'produced a new piece',
  );
  check(`${edit.name}: returns a new object`, after !== piece || shape(after) === before, 'ok');
}

/* --- 2. Re-applying is deterministic ---------------------------------------- */

for (const edit of edits) {
  const first = edit.run(buildPiece());
  const second = edit.run(buildPiece());
  if (edit.mintsIds) {
    // Ids differ by design; compare everything else structurally.
    const strip = (p: PatternPiece): string =>
      shape({
        points: p.points.map((q) => [q.role, q.position.x.toFixed(9), q.position.y.toFixed(9)]),
        segments: p.segments.map((s) => [s.geometry.kind, s.label ?? '']),
        boundaryLength: p.boundary.length,
        notches: p.notches.map((n) => [n.kind, n.t.toFixed(9)]),
      });
    check(`${edit.name}: deterministic (ids aside)`, strip(first) === strip(second), 'ok');
  } else {
    check(`${edit.name}: deterministic`, shape(first) === shape(second), 'ok');
  }
}

/* --- 3. Round trips that must be exact -------------------------------------- */

// Insert a point, then delete it: geometry, notches and ids all come back.
{
  const original = buildPiece();
  const inserted = insertPointOnSegment(original, 's2', 0.45);
  const restored = inserted ? removePoint(inserted.piece, inserted.pointId) : null;
  check('insert then delete restores geometry', restored !== null, restored ? 'ok' : 'refused');
  if (restored) {
    const before = outlineLength(original);
    const after = outlineLength(restored.piece);
    check(
      'insert then delete preserves perimeter',
      Math.abs(after - before) < 1e-6,
      `${after.toFixed(9)} vs ${before.toFixed(9)}`,
    );
    check(
      'insert then delete preserves point count',
      restored.piece.points.length === original.points.length,
      `${restored.piece.points.length} vs ${original.points.length}`,
    );
    check(
      'notch ids survive split and merge',
      restored.piece.notches.map((n) => n.id).join() === original.notches.map((n) => n.id).join(),
      restored.piece.notches.map((n) => n.id).join(),
    );
    // Perimeter and point count are necessary but not sufficient — two
    // different cubics can have the same length. The merge is only
    // genuinely exact if the control points themselves come back bit for
    // bit, and the notch riding that edge comes back at the *same*
    // parameter, not just roughly the same place.
    const restoredGeometry = restored.piece.segments.find((s) => s.id === restored.segmentId)?.geometry;
    const originalGeometry = original.segments.find((s) => s.id === 's2')?.geometry;
    check(
      'insert then delete restores the control points exactly',
      shape(restoredGeometry) === shape(originalGeometry),
      `${JSON.stringify(restoredGeometry)} vs ${JSON.stringify(originalGeometry)}`,
    );
    const restoredNotch = restored.piece.notches.find((n) => n.id === 'n2');
    const originalNotch = original.notches.find((n) => n.id === 'n2');
    check(
      'insert then delete restores the notch parameter exactly',
      restoredNotch !== undefined &&
        originalNotch !== undefined &&
        Math.abs(restoredNotch.t - originalNotch.t) < 1e-9,
      `${restoredNotch?.t} vs ${originalNotch?.t}`,
    );
  }
}

/*
 * The same round trip, but for an `arc` segment: split it, then delete the
 * point the split added. Two arcs of one circle are one arc of that circle,
 * so this must come back exactly too — merging two arcs used to fall back to
 * a straight `LINE`, silently discarding the curvature entirely rather than
 * approximating it.
 */
{
  const arcPiece: PatternPiece = {
    id: 'arcp1',
    name: 'ArcFixture',
    points: [
      { id: 'a', position: { x: 0, y: 0 }, role: 'corner' },
      { id: 'c', position: { x: 200, y: 0 }, role: 'corner' },
      { id: 'd', position: { x: 100, y: -150 }, role: 'corner' },
    ],
    segments: [
      { id: 's1', from: 'a', to: 'c', geometry: { kind: 'arc', radius: 130, largeArc: false, clockwise: false } },
      { id: 's2', from: 'c', to: 'd', geometry: { kind: 'line' } },
      { id: 's3', from: 'd', to: 'a', geometry: { kind: 'line' } },
    ],
    boundary: ['s1', 's2', 's3'],
    closed: true,
    seamAllowance: 10,
    notches: [{ id: 'n1', segmentId: 's1', t: 0.7, kind: 'slit', depth: 6, width: 2, angle: 0 }],
    internalLines: [],
    meta: { code: 'ARC', category: 'shell', fabric: 'F', quantity: 1, onFold: false, mirrored: false },
  };

  const originalArcGeometry = arcPiece.segments.find((s) => s.id === 's1')!.geometry;
  const inserted = insertPointOnSegment(arcPiece, 's1', 0.4);
  check('splitting an arc keeps arc geometry on both halves', inserted !== null, inserted ? 'ok' : 'refused');

  if (inserted) {
    const cut = inserted.piece.points.find((p) => p.id === inserted.pointId);
    check(
      'the point cutting an arc is a curve point, not a corner',
      cut?.role === 'curve',
      cut?.role ?? 'missing',
    );

    const restored = removePoint(inserted.piece, inserted.pointId);
    check('deleting it merges the arc back', restored !== null, restored ? 'ok' : 'refused');

    if (restored) {
      const mergedGeometry = restored.piece.segments.find((s) => s.id === restored.segmentId)?.geometry;
      check(
        'arc split then merge restores the exact same arc',
        shape(mergedGeometry) === shape(originalArcGeometry),
        `${JSON.stringify(mergedGeometry)} vs ${JSON.stringify(originalArcGeometry)}`,
      );
      const restoredNotch = restored.piece.notches.find((n) => n.id === 'n1');
      check(
        'arc split then merge restores the notch parameter exactly',
        restoredNotch !== undefined && Math.abs(restoredNotch.t - 0.7) < 1e-9,
        `${restoredNotch?.t} vs 0.7`,
      );
    }
  }
}

/*
 * Two arcs that do *not* share a circle cannot merge into one arc exactly —
 * there is no single circle through both. The merge must not paper over that
 * by silently dropping to a straight line (what it used to do for *any* pair
 * of non-cubic edges); it has to produce a curve that is at least tangent-
 * continuous with what was actually there.
 */
{
  const piece: PatternPiece = {
    id: 'arcp2',
    name: 'TwoDifferentArcs',
    points: [
      { id: 'a', position: { x: 0, y: 0 }, role: 'corner' },
      { id: 'b', position: { x: 100, y: 20 }, role: 'corner' },
      { id: 'c', position: { x: 200, y: 0 }, role: 'corner' },
      { id: 'd', position: { x: 100, y: -100 }, role: 'corner' },
    ],
    segments: [
      { id: 's1', from: 'a', to: 'b', geometry: { kind: 'arc', radius: 80, largeArc: false, clockwise: false } },
      { id: 's2', from: 'b', to: 'c', geometry: { kind: 'arc', radius: 80, largeArc: false, clockwise: false } },
      { id: 's3', from: 'c', to: 'd', geometry: { kind: 'line' } },
      { id: 's4', from: 'd', to: 'a', geometry: { kind: 'line' } },
    ],
    boundary: ['s1', 's2', 's3', 's4'],
    closed: true,
    seamAllowance: 10,
    notches: [],
    internalLines: [],
    meta: { code: 'X', category: 'shell', fabric: 'F', quantity: 1, onFold: false, mirrored: false },
  };

  const s1 = piece.segments.find((s) => s.id === 's1')!;
  const s2 = piece.segments.find((s) => s.id === 's2')!;
  const first = resolveArc(piece.points.find((p) => p.id === 'a')!.position, piece.points.find((p) => p.id === 'b')!.position, s1.geometry);
  const second = resolveArc(piece.points.find((p) => p.id === 'b')!.position, piece.points.find((p) => p.id === 'c')!.position, s2.geometry);
  check(
    'fixture is a genuine trap: the two arcs really are on different circles',
    first !== null &&
      second !== null &&
      Math.hypot(first.centre.x - second.centre.x, first.centre.y - second.centre.y) > 1,
    'ok',
  );

  const merged = removePoint(piece, 'b');
  const mergedGeometry = merged?.piece.segments.find((s) => s.id === merged.segmentId)?.geometry;
  check(
    'non-cocircular arcs approximate as a curve, never silently as a line',
    mergedGeometry?.kind === 'cubic',
    mergedGeometry?.kind ?? 'refused',
  );

  if (mergedGeometry?.kind === 'cubic') {
    // The approximation still has to be continuous: the merged cubic's
    // initial tangent must match the *incoming arc's own* tangent at `a`,
    // not the chord from `a` straight across to `c`.
    const a = piece.points.find((p) => p.id === 'a')!.position;
    const b = piece.points.find((p) => p.id === 'b')!.position;
    const trueTangent = tangentOnSegment(a, b, s1.geometry, 0);
    const trueAngle = Math.atan2(trueTangent.y, trueTangent.x);
    const handleAngle = Math.atan2(mergedGeometry.control1.y - a.y, mergedGeometry.control1.x - a.x);
    let diff = Math.abs(trueAngle - handleAngle);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    check(
      'the approximate merge keeps the true arc tangent, not the chord',
      diff < 1e-9,
      `${diff.toExponential(2)} rad off the arc's real tangent`,
    );
  }
}

/*
 * Two cubics that only happen to meet — not collinear through the joint —
 * must not be treated as an undone split, even though the *distance* ratio
 * between the joint and the two inner handles falls inside (0, 1) here just
 * as it would for a real split. Collinearity, not a ratio computable from
 * any three points, is what tells the two cases apart.
 */
{
  const piece: PatternPiece = {
    id: 'cubp1',
    name: 'IndependentCubics',
    points: [
      { id: 'a', position: { x: 0, y: 0 }, role: 'corner' },
      { id: 'b', position: { x: 100, y: 50 }, role: 'curve' },
      { id: 'c', position: { x: 200, y: 0 }, role: 'corner' },
      { id: 'd', position: { x: 100, y: -150 }, role: 'corner' },
    ],
    segments: [
      {
        id: 's1',
        from: 'a',
        to: 'b',
        geometry: { kind: 'cubic', control1: { x: 20, y: -30 }, control2: { x: 60, y: 200 } },
      },
      {
        id: 's2',
        from: 'b',
        to: 'c',
        geometry: { kind: 'cubic', control1: { x: 105, y: -80 }, control2: { x: 180, y: -20 } },
      },
      { id: 's3', from: 'c', to: 'd', geometry: { kind: 'line' } },
      { id: 's4', from: 'd', to: 'a', geometry: { kind: 'line' } },
    ],
    boundary: ['s1', 's2', 's3', 's4'],
    closed: true,
    seamAllowance: 10,
    notches: [],
    internalLines: [],
    meta: { code: 'X', category: 'shell', fabric: 'F', quantity: 1, onFold: false, mirrored: false },
  };

  const s1 = piece.segments.find((s) => s.id === 's1')!;
  const s2 = piece.segments.find((s) => s.id === 's2')!;
  if (s1.geometry.kind === 'cubic' && s2.geometry.kind === 'cubic') {
    const d = s1.geometry.control2;
    const e = s2.geometry.control1;
    const joint = piece.points.find((p) => p.id === 'b')!.position;
    const span = Math.hypot(e.x - d.x, e.y - d.y);
    const distanceOnlyRatio = Math.hypot(joint.x - d.x, joint.y - d.y) / span;
    check(
      'fixture is a genuine trap: the distance-only ratio looks like a valid split parameter',
      distanceOnlyRatio > 0 && distanceOnlyRatio < 1,
      distanceOnlyRatio.toFixed(4),
    );

    const merged = removePoint(piece, 'b');
    const mergedGeometry = merged?.piece.segments.find((s) => s.id === merged.segmentId)?.geometry;

    const incomingLength = segmentLength(piece, s1);
    const outgoingLength = segmentLength(piece, s2);
    const expectedShare = incomingLength / (incomingLength + outgoingLength);
    const from = piece.points.find((p) => p.id === 'a')!.position;
    const expectedControl1 = {
      x: from.x + (s1.geometry.control1.x - from.x) / expectedShare,
      y: from.y + (s1.geometry.control1.y - from.y) / expectedShare,
    };

    check(
      'non-collinear cubics fall back to arc-length share, not the trap ratio',
      mergedGeometry?.kind === 'cubic' &&
        Math.abs(mergedGeometry.control1.x - expectedControl1.x) < 1e-6 &&
        Math.abs(mergedGeometry.control1.y - expectedControl1.y) < 1e-6,
      mergedGeometry?.kind === 'cubic'
        ? `${JSON.stringify(mergedGeometry.control1)} vs expected ${JSON.stringify(expectedControl1)}`
        : (mergedGeometry?.kind ?? 'refused'),
    );
  }
}

/*
 * A notch keeps its identity *and its physical position* across a split.
 *
 * Distance along the seam has to be measured with `lengthAlongSegment`, not
 * `segmentLength * t`: arc length is not proportional to the curve parameter on
 * anything but a straight edge, so multiplying would compare two different
 * quantities and report drift that is not there.
 */
{
  const original = buildPiece();
  const notch = original.notches.find((n) => n.segmentId === 's1')!;
  const segment = original.segments.find((s) => s.id === 's1')!;
  const before = lengthAlongSegment(original, segment, notch.t);

  const inserted = insertPointOnSegment(original, 's1', 0.5);
  check('split keeps the notch', inserted !== null, inserted ? 'ok' : 'refused');
  if (inserted) {
    const moved = inserted.piece.notches.find((n) => n.id === notch.id);
    check('notch id survives the split', moved !== undefined, moved?.id ?? 'lost');
    if (moved) {
      const halves = boundarySegments(inserted.piece).filter(
        (s) => s.id === inserted.segmentIds[0] || s.id === inserted.segmentIds[1],
      );
      const owning = halves.find((s) => s.id === moved.segmentId)!;
      const preceding =
        moved.segmentId === inserted.segmentIds[1]
          ? segmentLength(inserted.piece, halves.find((s) => s.id === inserted.segmentIds[0])!)
          : 0;
      const after = preceding + lengthAlongSegment(inserted.piece, owning, moved.t);
      check(
        'notch stays put along the seam',
        Math.abs(after - before) < 1e-6,
        `${after.toFixed(6)}mm vs ${before.toFixed(6)}mm`,
      );
    }
  }
}

// Adding then removing a notch is exact.
{
  const original = buildPiece();
  const added = addNotch(original, 's3', 0.4);
  const removed = added ? removeNotch(added.piece, added.notchId) : null;
  check(
    'add then remove notch restores the piece',
    removed !== null && shape(removed) === shape(original),
    removed ? 'identical' : 'failed',
  );
}

// Line -> curve -> line returns the original straight edge.
{
  const original = buildPiece();
  const curved = setSegmentKind(original, 's3', 'cubic');
  const straightened = setSegmentKind(curved, 's3', 'line');
  check(
    'line -> curve -> line is exact',
    shape(straightened) === shape(original),
    'identical',
  );
}

/*
 * Marking a point smooth must actually enforce tangency, not just relabel it.
 * Point `b` joins two cubics, so both handles exist to be aligned; a point with
 * a straight edge on one side has no handle to swing and is left alone, which
 * is why the fixture's `c` is the wrong subject for this.
 */
{
  const original = buildPiece();
  const cornered = setPointRole(original, 'b', 'corner');
  // Break the tangency deliberately while it is a corner.
  const kinked = setSegmentHandle(cornered, 's2', 'control1', { x: 320, y: 20 });

  const anchor = kinked.points.find((p) => p.id === 'b')!.position;
  const angleTo = (v: { x: number; y: number }): number =>
    Math.atan2(v.y - anchor.y, v.x - anchor.x);
  const incoming = kinked.segments.find((s) => s.id === 's1')!.geometry;
  const kinkedOut = kinked.segments.find((s) => s.id === 's2')!.geometry;
  const opposition = (a: number, b: number): number => {
    let d = a - (b + Math.PI);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d);
  };

  check(
    'corner allows a kink',
    incoming.kind === 'cubic' &&
      kinkedOut.kind === 'cubic' &&
      opposition(angleTo(kinkedOut.control1), angleTo(incoming.control2)) > 0.05,
    'kinked',
  );

  const smoothed = setPointRole(kinked, 'b', 'curve');
  const smoothedOut = smoothed.segments.find((s) => s.id === 's2')!.geometry;
  const smoothedIn = smoothed.segments.find((s) => s.id === 's1')!.geometry;

  check(
    'making a point smooth enforces tangency',
    smoothedIn.kind === 'cubic' &&
      smoothedOut.kind === 'cubic' &&
      opposition(angleTo(smoothedOut.control1), angleTo(smoothedIn.control2)) < 1e-9,
    smoothedIn.kind === 'cubic' && smoothedOut.kind === 'cubic'
      ? `${opposition(angleTo(smoothedOut.control1), angleTo(smoothedIn.control2)).toExponential(2)} rad off opposite`
      : 'not cubic',
  );

  check(
    'smoothing preserves the neighbour handle length',
    smoothedOut.kind === 'cubic' &&
      kinkedOut.kind === 'cubic' &&
      Math.abs(
        Math.hypot(smoothedOut.control1.x - anchor.x, smoothedOut.control1.y - anchor.y) -
          Math.hypot(kinkedOut.control1.x - anchor.x, kinkedOut.control1.y - anchor.y),
      ) < 1e-9,
    'length kept',
  );

  check(
    'role toggles back to corner',
    setPointRole(smoothed, 'b', 'corner').points.find((p) => p.id === 'b')?.role === 'corner',
    'corner',
  );
}

console.log(
  failures === 0
    ? '\nAll round-trip checks passed.'
    : `\n${failures} round-trip check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
