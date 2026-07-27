import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  importDxf,
  importDxfWithDiagnostics,
  describeImportPlan,
  type LayerUsageRow,
} from '../src/io/dxf/import.ts';
import { jsonAdapter } from '../src/io/json.ts';
import { FormatParseError } from '../src/io/errors.ts';
import type { PatternDocument } from '../src/pattern/index.ts';

/**
 * Regression suite for DXF import, run against a real production file rather
 * than a synthetic fixture.
 *
 * Run it with:
 *
 *   npm run check:dxf
 *
 * `scripts/fixtures/dxf/5109s-sp27-pattern.dxf` is a real AAMA/ASTM-style
 * export (5 blocks, INSERT placement, $INSUNITS in inches) supplied for this
 * work — not written for this test. Every expected value below is derived
 * independently from the file's own raw group codes (transcribed once, by
 * hand, into `RAW_VERTICES`/`INSERTS`) and re-computed here with a second,
 * from-scratch implementation of the coordinate transform — not by calling
 * back into `import.ts` — so a bug shared between the importer and its test
 * would still be caught.
 *
 * Two real files are covered — fixture 1 below, then `tshirt-demo-aama.dxf`
 * from § 14 on. Two is still not the "small representative set" real
 * production import needs, but it is past the point where a single writer's
 * habits look like the format: the second file immediately exposed a SEQEND
 * desync (§ 21) that fixture 1 structurally could not, and contradicted the
 * layer table in three places. See DEVELOPMENT.md for what a third file —
 * ideally one with an actual notch — would unlock.
 */

let failures = 0;
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) failures += 1;
};

const FIXTURE_PATH = fileURLToPath(
  new URL('./fixtures/dxf/5109s-sp27-pattern.dxf', import.meta.url),
);
const fixture = readFileSync(FIXTURE_PATH, 'utf8');

/* --- Independent reference data, transcribed from the fixture's own group codes ---
 *
 * Raw vertex list per block, in file order, in the file's native unit
 * (inches) — exactly what group codes 10/20 say, duplicates and all. Insert
 * points are exactly what the ENTITIES section's INSERT entities say. Every
 * block's own base point is (0,0), so it does not appear here.
 */

const RAW_VERTICES: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>> = {
  'AW27-213 -COST-5109S': [
    [0, 3.9037], [1.3454, 7.9438], [11.6208, 9.7603], [30.3863, 7.7886], [30.3863, 0],
    [1.0418, 0], [1.0418, 0], [1.0391, 0.698], [1.0423, 1.3457], [1.0376, 1.7423],
    [1.0045, 2.1703], [0.9122, 2.6757], [0.7828, 3.0207], [0.5858, 3.3783], [0.2898, 3.6806],
    [0, 3.9037],
  ],
  'AW27-213 -COSTAH BIN-5109S_M': [
    [1.2178, 26.7789], [1.2178, 0], [0.0001, 0], [0.0001, 26.7789], [0, 0.9999],
    [0.0001, 26.7789], [1.2178, 26.7789],
  ],
  'AW27-213 -COSTFNT-5109S': [
    [0, 3.7807], [1.3949, 7.9647], [11.6597, 9.7599], [30.428, 7.7886], [30.428, 0],
    [4.2492, 0], [4.2492, 0], [0, 3.7807],
  ],
  'AW27-213 -COSTNK BND-5109S_M': [
    [0.5682, 19.8983], [1.1364, 20.0399], [1.1364, 0], [0.5682, 0.1419], [0, 0],
    [0, 20.0399], [0.5682, 19.8983],
  ],
  'AW27-213 -COSTSID-5109S': [
    [19.7976, 0], [0, 2.0803], [19.9047, 2.3153], [19.9047, 2.3153], [19.7976, 0],
    [0, 2.0803], [19.7976, 0],
  ],
};

const INSERTS: Readonly<Record<string, readonly [number, number]>> = {
  'AW27-213 -COST-5109S': [0, 0],
  'AW27-213 -COSTAH BIN-5109S_M': [32.3863, 0],
  'AW27-213 -COSTFNT-5109S': [35.6041, 0],
  'AW27-213 -COSTNK BND-5109S_M': [68.0321, 0],
  'AW27-213 -COSTSID-5109S': [71.1685, 0],
};

const PIECE_NAMES = Object.keys(RAW_VERTICES);

/** Structural shape of a document's pieces, blind to freshly-minted ids. */
const pieceShape = (doc: PatternDocument): string =>
  JSON.stringify(
    doc.pieces.map((p) => ({
      name: p.name,
      points: p.points.map((pt) => [pt.role, pt.position.x.toFixed(9), pt.position.y.toFixed(9)]),
      segmentKinds: p.segments.map((s) => s.geometry.kind),
      closed: p.closed,
      meta: p.meta,
    })),
  );

const MM_PER_INCH = 25.4;
const EPS = 1e-9;

/**
 * A from-scratch re-derivation of "raw vertices → app point space": translate
 * by the insert point, collapse a consecutive duplicate, drop a closing
 * duplicate, flip Y, convert to mm. Written independently of `import.ts` —
 * it does not call anything from it — so this test does not just check the
 * importer against itself.
 */
const expectedPoints = (name: string): { readonly x: number; readonly y: number }[] => {
  const [insertX, insertY] = INSERTS[name]!;
  const world = RAW_VERTICES[name]!.map(([x, y]) => ({ x: x + insertX, y: y + insertY }));

  const collapsed: { x: number; y: number }[] = [];
  for (const p of world) {
    const last = collapsed[collapsed.length - 1];
    if (last && Math.abs(last.x - p.x) < EPS && Math.abs(last.y - p.y) < EPS) continue;
    collapsed.push(p);
  }
  let result = collapsed;
  if (result.length > 1) {
    const first = result[0]!;
    const last = result[result.length - 1]!;
    if (Math.abs(first.x - last.x) < EPS && Math.abs(first.y - last.y) < EPS) {
      result = result.slice(0, -1);
    }
  }
  return result.map((p) => ({ x: p.x * MM_PER_INCH, y: -p.y * MM_PER_INCH }));
};

/* --- 1. Parse the real file --------------------------------------------- */

const { document, issues } = importDxfWithDiagnostics(fixture, { flavour: 'aama', assumeUnit: 'mm' });

check('imports exactly 5 pieces', document.pieces.length === 5, `${document.pieces.length}`);
check(
  'piece names match the BLOCK names exactly',
  PIECE_NAMES.every((name) => document.pieces.some((p) => p.name === name)),
  document.pieces.map((p) => p.name).join(' | '),
);

/* --- 2. Geometry, verified against an independent re-derivation --------- */

for (const name of PIECE_NAMES) {
  const piece = document.pieces.find((p) => p.name === name);
  const expected = expectedPoints(name);

  check(`"${name}": point count matches independent derivation`, piece?.points.length === expected.length, `${piece?.points.length} vs ${expected.length}`);

  if (piece && piece.points.length === expected.length) {
    const mismatches = piece.points.filter((p, i) => {
      const e = expected[i]!;
      return Math.abs(p.position.x - e.x) > 1e-6 || Math.abs(p.position.y - e.y) > 1e-6;
    });
    check(`"${name}": every point matches the independently computed mm position`, mismatches.length === 0, `${mismatches.length} mismatch(es)`);

    check(`"${name}": every point is a corner (no curve entity in the source)`, piece.points.every((p) => p.role === 'corner'), 'ok');
    check(`"${name}": every segment is a straight line`, piece.segments.every((s) => s.geometry.kind === 'line'), 'ok');
    check(`"${name}": boundary is closed and covers every segment once`, piece.closed && piece.boundary.length === piece.segments.length, `${piece.boundary.length} vs ${piece.segments.length}`);
  }
}

/* --- 3. Units -------------------------------------------------------------- */

check(
  'units were read from $INSUNITS as inches (code 1)',
  issues.some((i) => i.code === 'units-read' && i.message.includes('code 1')),
  issues.find((i) => i.code === 'units-read')?.message ?? 'missing',
);

/* --- 4. Vertex-cleanup diagnostics, per piece ------------------------------ */

const expectDedupOn = new Set(['AW27-213 -COST-5109S', 'AW27-213 -COSTFNT-5109S', 'AW27-213 -COSTSID-5109S']);
for (const name of PIECE_NAMES) {
  const flagged = issues.some((i) => i.code === 'duplicate-vertex-collapsed' && i.message.includes(`"${name}"`));
  check(
    `"${name}": duplicate-vertex diagnostic ${expectDedupOn.has(name) ? 'present' : 'absent'} as expected`,
    flagged === expectDedupOn.has(name),
    `${flagged}`,
  );
}

/* --- 5. Self-overlap diagnostics, per piece -------------------------------- */

const expectSelfOverlap = new Set(['AW27-213 -COSTAH BIN-5109S_M', 'AW27-213 -COSTSID-5109S']);
for (const name of PIECE_NAMES) {
  const piece = document.pieces.find((p) => p.name === name)!;
  const flagged = issues.some((i) => i.code === 'self-overlapping-boundary' && i.pieceId === piece.id);
  check(
    `"${name}": self-overlapping-boundary diagnostic ${expectSelfOverlap.has(name) ? 'present' : 'absent'} as expected`,
    flagged === expectSelfOverlap.has(name),
    `${flagged}`,
  );
}

/* --- 6. Metadata: honest defaults, flagged rather than invented ------------ */

check(
  'every piece defaults to category "shell", empty fabric, quantity 1',
  document.pieces.every(
    (p) => p.meta.category === 'shell' && p.meta.fabric === '' && p.meta.quantity === 1 && !p.meta.onFold && !p.meta.mirrored,
  ),
  'ok',
);
check(
  'seam allowance defaults to 0 (net line only — no allowance layer in the source)',
  document.pieces.every((p) => p.seamAllowance === 0),
  'ok',
);
check(
  'a warning explains the defaulted metadata rather than presenting it as read',
  issues.some((i) => i.code === 'metadata-not-in-source' && i.severity === 'warning'),
  'ok',
);
check(
  'a warning names the layer table as unverified',
  issues.some((i) => i.code === 'unverified-layer-map'),
  'ok',
);

/* --- 7. The strict-interface importDxf succeeds on a well-formed file ------ */

{
  let thrown: unknown = null;
  let strictResult: PatternDocument | null = null;
  try {
    strictResult = importDxf(fixture, { flavour: 'aama', assumeUnit: 'mm' });
  } catch (error) {
    thrown = error;
  }
  check('importDxf does not throw on a file with only warnings/info issues', thrown === null, String(thrown));
  check(
    // A fresh call mints fresh ids (same convention as insertPointOnSegment
    // et al.), so this is a structural comparison, not a byte-identical one.
    'importDxf returns the same document shape importDxfWithDiagnostics computed',
    strictResult !== null && pieceShape(strictResult) === pieceShape(document),
    'ok',
  );
}

/* --- 8. Determinism: re-importing the same buffer gives the same shape ----- */

{
  const second = importDxfWithDiagnostics(fixture, { flavour: 'aama', assumeUnit: 'mm' });
  check('re-importing the same buffer is deterministic (ids aside)', pieceShape(document) === pieceShape(second.document), 'ok');
}

/* --- 9. Round-trips losslessly through the app's own JSON format ----------- */

{
  const serialized = jsonAdapter.serialize!(document);
  const roundTripped = jsonAdapter.deserialize!(serialized);
  check(
    'the imported document round-trips exactly through the native JSON format',
    JSON.stringify(roundTripped) === JSON.stringify(document),
    'ok',
  );
}

/* --- 10. Unsupported entities are skipped with a clear warning, not hidden - */

{
  // A synthetic CIRCLE, spliced into the real file's ENTITIES section — this
  // tests robustness against an entity kind the real fixture happens not to
  // contain, using a minimal, valid DXF snippet. It is not a claim that a
  // second real file has been checked.
  // The fixture uses CRLF line endings (a real export, not hand-written) —
  // splice using whichever line break it actually contains, rather than
  // assuming one.
  const eol = fixture.includes('\r\n') ? '\r\n' : '\n';
  const circleSnippet = ['0', 'CIRCLE', '8', '1', '10', '0', '20', '0', '30', '0', '40', '5'].join(eol);
  const tail = ['0', 'ENDSEC', '0', 'EOF'].join(eol);
  const lastTail = fixture.lastIndexOf(tail);
  check('fixture has the expected ENTITIES-closing tail to splice before', lastTail >= 0, `${lastTail}`);
  const withCircle = fixture.slice(0, lastTail) + circleSnippet + eol + fixture.slice(lastTail);

  const result = importDxfWithDiagnostics(withCircle, { flavour: 'aama', assumeUnit: 'mm' });
  check('an unrecognised entity does not change how many pieces import', result.document.pieces.length === 5, `${result.document.pieces.length}`);
  check(
    'an unrecognised entity produces a warning naming it, not a silent skip',
    result.issues.some((i) => i.code === 'unsupported-entity' && i.message.includes('CIRCLE')),
    result.issues.filter((i) => i.code === 'unsupported-entity').map((i) => i.message).join(' | ') || 'none found',
  );
}

/* --- 11. Malformed input fails loudly, not silently ------------------------ */

{
  let thrown: unknown = null;
  try {
    importDxf('this is not a dxf file', { flavour: 'aama', assumeUnit: 'mm' });
  } catch (error) {
    thrown = error;
  }
  check('garbage input throws FormatParseError rather than an unlabeled error', thrown instanceof FormatParseError, thrown ? (thrown as Error).constructor.name : 'did not throw');
}

{
  const emptyButValid = '0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF';
  let thrown: unknown = null;
  try {
    importDxf(emptyButValid, { flavour: 'aama', assumeUnit: 'mm' });
  } catch (error) {
    thrown = error;
  }
  check(
    'a well-formed file with zero pieces throws rather than returning an empty document',
    thrown instanceof FormatParseError,
    thrown ? (thrown as Error).constructor.name : 'did not throw',
  );
}

/* --- 12. Strict mode promotes every warning, not just the early ones ------- */

{
  // Regression guard for a real bug caught during review: strict mode used to
  // be applied mid-pipeline, so it missed the metadata warning and every
  // validateImportedDocument finding (self-overlapping-boundary among them)
  // pushed after that point. It must see everything.
  const strict = importDxfWithDiagnostics(fixture, { flavour: 'aama', assumeUnit: 'mm', strict: true });
  check('strict mode leaves no warnings, only errors and info', !strict.issues.some((i) => i.severity === 'warning'), strict.issues.filter((i) => i.severity === 'warning').map((i) => i.code).join(', ') || 'none');
  check(
    'strict mode promotes the late-pushed metadata warning to an error',
    strict.issues.some((i) => i.code === 'metadata-not-in-source' && i.severity === 'error'),
    strict.issues.find((i) => i.code === 'metadata-not-in-source')?.severity ?? 'missing',
  );
  check(
    "strict mode promotes validateImportedDocument's self-overlap finding to an error",
    strict.issues.some((i) => i.code === 'self-overlapping-boundary' && i.severity === 'error'),
    strict.issues.find((i) => i.code === 'self-overlapping-boundary')?.severity ?? 'missing',
  );
  let thrown: unknown = null;
  try {
    importDxf(fixture, { flavour: 'aama', assumeUnit: 'mm', strict: true });
  } catch (error) {
    thrown = error;
  }
  check('importDxf throws under strict mode once warnings become errors', thrown instanceof FormatParseError, thrown ? (thrown as Error).constructor.name : 'did not throw');
}

/* --- 13. describeImportPlan reflects that a parser now exists -------------- */

{
  const plan = describeImportPlan('aama');
  check('describeImportPlan no longer claims there is no parser', !plan.blockers.some((b) => b.code === 'no-parser'), JSON.stringify(plan.blockers));
  check(
    'describeImportPlan still surfaces the unverified layer table',
    plan.blockers.some((b) => b.code === 'unverified-layer-map'),
    JSON.stringify(plan.blockers),
  );
  check(
    'describeImportPlan reports the bindings real files actively contradict',
    plan.blockers.some(
      (b) =>
        b.code === 'layer-table-contradicted' &&
        b.message.includes('grade-reference') &&
        b.message.includes('sew-line') &&
        b.message.includes('left as it is'),
    ),
    JSON.stringify(plan.blockers.find((b) => b.code === 'layer-table-contradicted')?.message),
  );
}

/* ===========================================================================
 * Fixture 2 — TSHIRT-DEMO.aama, a second real production file
 *
 * Deliberately *not* another boundary-only export. It differs from fixture 1
 * in every way that matters to the parser:
 *
 *   - it declares itself ASTM D6673-04 conformant, from a different writer
 *   - it has no $INSUNITS, and states its unit as a `Units:METRIC` text field
 *   - it carries self-labelled `Key:Value` metadata at style and piece scope
 *   - it puts LINE entities on layers 5 and 7, and TEXT on layers 1 and 15
 *   - its SEQEND entities carry trailing group codes (which fixture 1's do not)
 *   - it is a marker: the same piece recurs once per size
 *
 * Everything expected below is again derived from the file's own raw group
 * codes, transcribed by hand into `TSHIRT_RAW`, not by calling the importer.
 * Every block's base point and every INSERT is (0,0) and the unit factor is
 * 1mm, all verified directly against the file, so the expected point for a
 * raw vertex is exactly (x, -y) — the Y flip and nothing else.
 * ========================================================================= */

const TSHIRT_PATH = fileURLToPath(new URL('./fixtures/dxf/tshirt-demo-aama.dxf', import.meta.url));
const tshirt = readFileSync(TSHIRT_PATH, 'utf8');

/** Raw VERTEX coordinates (group 10/20), in file order, for two blocks. */
const TSHIRT_RAW: Readonly<Record<string, ReadonlyArray<readonly [number, number]>>> = {
  'M0005_Neck-band': [
    [2077.8, 62.8], [1463.4, 62.8], [1463.4, 27.5], [2077.8, 27.5],
  ],
  'M0003_Sleeve': [
    [2183.4, 343.7], [2193.2, 295.7], [2214.8, 247.7], [2248.1, 199.7], [2275.5, 165.1],
    [2293.2, 151.7], [2401.0, 159.4], [2406.8, 228.5], [2410.8, 343.7], [2406.8, 458.9],
    [2401.0, 528.0], [2293.2, 535.7], [2275.5, 522.3], [2248.1, 487.7], [2214.8, 439.7],
    [2193.2, 391.7],
  ],
};

/** Raw LINE endpoints (groups 10/20 → 11/21) with their layer, same two blocks. */
const TSHIRT_RAW_LINES: Readonly<
  Record<string, ReadonlyArray<readonly [string, number, number, number, number]>>
> = {
  'M0005_Neck-band': [
    ['5', 1463.4, 45.15, 2077.8, 45.15],
    ['7', 1555.56, 45.15, 1985.64, 45.15],
  ],
  'M0003_Sleeve': [
    ['5', 2183.4, 343.7, 2410.8, 343.7],
    ['7', 2217.51, 343.7, 2376.69, 343.7],
  ],
};

/** Block names in INSERT order — the order pieces must come out in. */
const TSHIRT_BLOCKS = [
  'M0001_Front', 'M0002_Back', 'M0003_Sleeve', 'M0004_Sleeve', 'M0005_Neck-band',
  'M0006_Front', 'M0007_Back', 'M0008_Sleeve', 'M0009_Sleeve', 'M0010_Neck-band',
  'M0011_Front', 'M0012_Back', 'M0013_Sleeve', 'M0014_Sleeve', 'M0015_Neck-band',
  'M0016_Front', 'M0017_Back', 'M0018_Sleeve', 'M0019_Sleeve', 'M0020_Neck-band',
];

/** Raw VERTEX count per block, straight from the file. */
const TSHIRT_VERTEX_COUNTS: Readonly<Record<string, number>> = {
  Front: 26, Back: 24, Sleeve: 16, 'Neck band': 4,
};

const tshirtResult = importDxfWithDiagnostics(tshirt, { flavour: 'aama', assumeUnit: 'mm' });
const tshirtDoc = tshirtResult.document;
const tshirtIssues = tshirtResult.issues;
const issueCodes = new Set(tshirtIssues.map((i) => i.code));

/* --- 14. The second real file parses into the pieces it actually contains -- */

check('fixture 2 imports every placed block as a piece', tshirtDoc.pieces.length === 20, `${tshirtDoc.pieces.length} pieces`);
check(
  'fixture 2 pieces come out in INSERT order, keyed by block name in meta.code',
  tshirtDoc.pieces.map((p) => p.meta.code).join('|') === TSHIRT_BLOCKS.join('|'),
  tshirtDoc.pieces.map((p) => p.meta.code).join(', '),
);
check(
  'fixture 2 piece names come from the file\'s own "Piece Name" field, not the block name',
  tshirtDoc.pieces.every((p) => p.name !== p.meta.code) &&
    tshirtDoc.pieces[0]!.name === 'Front' &&
    tshirtDoc.pieces[4]!.name === 'Neck band',
  `${tshirtDoc.pieces[0]!.name} / ${tshirtDoc.pieces[4]!.name}`,
);

/* --- 15. Geometry, verified against the hand-transcribed raw vertices ------ */

for (const [blockName, raw] of Object.entries(TSHIRT_RAW)) {
  const piece = tshirtDoc.pieces.find((p) => p.meta.code === blockName)!;
  const corners = piece.points.filter((pt) => pt.role === 'corner');

  check(`"${blockName}": corner count matches the raw VERTEX count`, corners.length === raw.length, `${corners.length} vs ${raw.length}`);

  // Base point and INSERT are both (0,0) and the unit factor is 1mm, so the
  // whole transform is the Y flip. Anything else is a bug.
  const mismatches = raw.filter((expected, i) => {
    const actual = corners[i]?.position;
    return !actual || Math.abs(actual.x - expected[0]) > EPS || Math.abs(actual.y - -expected[1]) > EPS;
  });
  check(`"${blockName}": every corner is the raw vertex with Y negated`, mismatches.length === 0, `${mismatches.length} mismatch(es)`);

  check(
    `"${blockName}": the boundary covers the corners only, not the construction points`,
    piece.boundary.length === corners.length && piece.segments.length === corners.length,
    `boundary ${piece.boundary.length}, segments ${piece.segments.length}, corners ${corners.length}`,
  );
  check(
    `"${blockName}": every boundary segment is a straight line`,
    piece.segments.every((s) => s.geometry.kind === 'line'),
    'ok',
  );
}

for (const piece of tshirtDoc.pieces) {
  const expected = TSHIRT_VERTEX_COUNTS[piece.name];
  if (expected === undefined) {
    check(`unexpected piece name "${piece.name}"`, false, 'not in the transcribed table');
    continue;
  }
  check(
    `"${piece.meta.code}" (${piece.name}): corner count matches the raw VERTEX count`,
    piece.points.filter((pt) => pt.role === 'corner').length === expected,
    `${piece.points.filter((pt) => pt.role === 'corner').length} vs ${expected}`,
  );
}

/* --- 16. Units read from the file's own text field, not assumed ------------ */

check(
  'fixture 2 has no $INSUNITS and says so',
  tshirtIssues.some((i) => i.code === 'units-read' && i.message.includes('no $INSUNITS')),
  'ok',
);
check(
  'fixture 2 units come from its "Units:METRIC" field rather than the assumed fallback',
  tshirtIssues.some((i) => i.code === 'units-read' && i.message.includes('Units:METRIC')) &&
    !issueCodes.has('unit-assumed'),
  'ok',
);
{
  // METRIC ⇒ 1mm per unit ⇒ coordinates unscaled. Passing a *different*
  // assumeUnit must not change the result: the file's own statement wins.
  const asInches = importDxfWithDiagnostics(tshirt, { flavour: 'aama', assumeUnit: 'in' });
  check(
    'the file\'s declared unit beats options.assumeUnit',
    pieceShape(asInches.document) === pieceShape(tshirtDoc),
    'ok',
  );
}

/* --- 17. Metadata genuinely read, and honestly scoped ---------------------- */

check(
  'the document takes its name and style code from the file\'s "Style Name"',
  tshirtDoc.name === 'TSHIRT-DEMO' && tshirtDoc.style.code === 'TSHIRT-DEMO',
  `${tshirtDoc.name} / ${tshirtDoc.style.code}`,
);
check(
  'style-level fields are reported as read from text, not presented as guaranteed',
  tshirtIssues.some(
    (i) =>
      i.code === 'metadata-read-from-text' &&
      i.message.includes('D 6673-04') &&
      i.message.includes('writer convention'),
  ),
  'ok',
);
check(
  'cut quantity is read from the file rather than defaulted',
  tshirtDoc.pieces.every((p) => p.meta.quantity === 1) &&
    tshirtIssues.some((i) => i.code === 'metadata-not-in-source' && i.message.includes('Cut quantity was read')),
  'ok',
);
check(
  'the ambiguous "Quantity:1,0" is reported rather than silently interpreted',
  tshirtIssues.some((i) => i.code === 'quantity-field-ambiguous' && i.message.includes('decimal comma')),
  'ok',
);
check(
  'fabric and category are still flagged as having no source',
  tshirtDoc.pieces.every((p) => p.meta.fabric === '' && p.meta.category === 'shell') &&
    tshirtIssues.some((i) => i.code === 'metadata-not-in-source' && i.message.includes('Fabric and category')),
  'ok',
);
check(
  'each piece records the size name the file gave it',
  tshirtDoc.pieces[0]!.meta.description === 'Size Name: S' &&
    tshirtDoc.pieces[19]!.meta.description === 'Size Name: L',
  `${tshirtDoc.pieces[0]!.meta.description} / ${tshirtDoc.pieces[19]!.meta.description}`,
);
check(
  'a "Rotation:180" text field is reported as not applied, not silently obeyed',
  tshirtIssues.some((i) => i.code === 'rotation-not-applied' && i.message.includes('nothing was rotated')),
  'ok',
);

/* --- 18. LINE entities kept as geometry, with no meaning claimed ----------- */

for (const [blockName, rawLines] of Object.entries(TSHIRT_RAW_LINES)) {
  const piece = tshirtDoc.pieces.find((p) => p.meta.code === blockName)!;
  const byId = new Map(piece.points.map((pt) => [pt.id, pt.position]));

  check(`"${blockName}": both LINE entities survive as internal lines`, piece.internalLines.length === rawLines.length, `${piece.internalLines.length} vs ${rawLines.length}`);
  check(
    `"${blockName}": internal lines are construction geometry, drawn and never cut`,
    piece.internalLines.every((l) => l.role === 'construction' && !l.cut && !l.closed),
    'ok',
  );
  check(
    `"${blockName}": no grain line is claimed from an unverified layer number`,
    piece.grainLine === undefined,
    String(piece.grainLine),
  );

  const wrong = rawLines.filter((raw, i) => {
    const line = piece.internalLines[i];
    if (!line || line.points.length !== 2) return true;
    const a = byId.get(line.points[0]!);
    const b = byId.get(line.points[1]!);
    if (!a || !b) return true;
    return (
      Math.abs(a.x - raw[1]) > EPS || Math.abs(a.y - -raw[2]) > EPS ||
      Math.abs(b.x - raw[3]) > EPS || Math.abs(b.y - -raw[4]) > EPS
    );
  });
  check(`"${blockName}": internal-line endpoints match the raw LINE group codes with Y negated`, wrong.length === 0, `${wrong.length} wrong`);
  check(
    `"${blockName}": internal-line endpoints are construction points, off the outline`,
    piece.internalLines.every((l) =>
      l.points.every((id) => piece.points.find((pt) => pt.id === id)?.role === 'construction'),
    ),
    'ok',
  );
}

/* --- 19. Layer reporting distinguishes supported / unsupported / conflicting */

{
  const usage = tshirtIssues.find((i) => i.code === 'layer-usage');
  check('a layer-usage line reports every layer the file uses', usage !== undefined, usage?.message ?? 'missing');
  check(
    'layer usage names the outline, construction and skipped treatments separately',
    usage !== undefined &&
      usage.message.includes('POLYLINE×20 on layer "1" (imported as the piece outline)') &&
      usage.message.includes('LINE×20 on layer "7" (imported as construction geometry, with no meaning claimed)') &&
      usage.message.includes('TEXT×20 on layer "15" (not imported)'),
    usage?.message ?? 'missing',
  );

  const conflicts = tshirtIssues.filter((i) => i.code === 'layer-entity-conflict');
  const conflictLayers = conflicts.map((c) => c.message.match(/^Layer "([^"]+)"/)?.[1]).sort();
  check(
    'the layer table\'s disagreements with this real file are reported, one per layer/entity pair',
    JSON.stringify(conflictLayers) === JSON.stringify(['1', '15', '5']),
    JSON.stringify(conflictLayers),
  );
  check(
    'layer 5 is flagged: the table says POINT grade-reference, the file puts LINE there',
    conflicts.some((c) => c.message.includes('Layer "5"') && c.message.includes('grade-reference') && c.message.includes('puts LINE there')),
    'ok',
  );
  check(
    'layer 15 is flagged: the table says POLYLINE sew-line, the file puts TEXT there',
    conflicts.some((c) => c.message.includes('Layer "15"') && c.message.includes('sew-line') && c.message.includes('puts TEXT there')),
    'ok',
  );
  check(
    'layer 7 is NOT flagged — the table already expects LINE there, and the file agrees',
    !conflicts.some((c) => c.message.startsWith('Layer "7"')),
    'ok',
  );
  check(
    'a conflict never rewrites the layer table to match the file',
    conflicts.every((c) => c.message.includes('was not changed to match this file')),
    'ok',
  );
  check('every layer this file uses has some binding in the table', !issueCodes.has('unmapped-layer'), 'ok');
}

/* --- 20. A marker's repeated sizes are stated, not silently flattened ------ */

{
  const flat = tshirtIssues.find((i) => i.code === 'sizes-imported-flat');
  check('repeated pieces across sizes are reported', flat !== undefined && flat.severity === 'warning', flat?.message ?? 'missing');
  check(
    'the report names the sizes seen and refuses to infer a graded size range',
    flat !== undefined && flat.message.includes('S, M, L') && flat.message.includes('not* assembled into a graded size range'),
    flat?.message ?? 'missing',
  );
  check(
    'no grade rules were invented from the repeated outlines',
    tshirtDoc.gradeRules.length === 0 && tshirtDoc.sizeRange.sizes.length === 1,
    `${tshirtDoc.gradeRules.length} rules, ${tshirtDoc.sizeRange.sizes.length} size(s)`,
  );
}

/* --- 21. The SEQEND desync this file exposed must not come back ------------ */

{
  // Fixture 2's SEQEND and ENDBLK entities carry a trailing `8` (layer) group
  // that fixture 1's do not. Consuming only their `0` marker left that field
  // in the stream, where the block reader took it for an entity marker and
  // reported a skipped entity named "1". Verified by reverting the fix: this
  // section fails, and only this section — the stray token was swallowed by
  // the bogus skip rather than shifting everything after it, so the geometry
  // survived. That is what made it a *quiet* desync worth a named guard: it
  // produced a confusing warning and no visible damage, which is exactly the
  // kind of thing that gets dismissed as noise.
  const stray = tshirtIssues.filter((i) => i.code === 'unsupported-entity');
  check(
    'no entity is skipped in a file whose every entity kind is handled',
    stray.length === 0,
    stray.map((s) => s.message).join(' | ') || 'none',
  );
  check(
    'no diagnostic names a bare group code as if it were an entity',
    !tshirtIssues.some((i) => i.message.includes('stray group') || /entity "\d+"/.test(i.message)),
    'ok',
  );
  check(
    'the entities following a SEQEND are still read (they were lost by the desync)',
    tshirtDoc.pieces.every((p) => p.internalLines.length === 2),
    `internal-line counts: ${[...new Set(tshirtDoc.pieces.map((p) => p.internalLines.length))].join(',')}`,
  );
}

/* --- 22. Determinism and round-trip, for the second file too --------------- */

{
  const again = importDxfWithDiagnostics(tshirt, { flavour: 'aama', assumeUnit: 'mm' });
  check('fixture 2 re-imports deterministically (ids aside)', pieceShape(again.document) === pieceShape(tshirtDoc), 'ok');
  // Diagnostics carry the piece id they came from, and a fresh import mints
  // fresh ids — so this compares severity/code/message, the parts that are
  // supposed to be reproducible, exactly as `pieceShape` does for geometry.
  const issueShape = (list: readonly { severity: string; code: string; message: string }[]): string =>
    JSON.stringify(list.map((i) => [i.severity, i.code, i.message]));
  check(
    'fixture 2 produces the same diagnostics every time (piece ids aside)',
    issueShape(again.issues) === issueShape(tshirtIssues),
    'ok',
  );

  const roundTripped = jsonAdapter.deserialize!(jsonAdapter.serialize!(tshirtDoc));
  check(
    'fixture 2 round-trips exactly through the native JSON format, construction lines included',
    JSON.stringify(roundTripped) === JSON.stringify(tshirtDoc),
    'ok',
  );

  let thrown: unknown = null;
  try {
    importDxf(tshirt, { flavour: 'aama', assumeUnit: 'mm' });
  } catch (error) {
    thrown = error;
  }
  check('importDxf does not throw on fixture 2 (warnings only, no errors)', thrown === null, String(thrown));
}

/* --- 23. The structured layers return, for both fixtures -------------------
 *
 * `layers` is the machine-readable form of the layer-usage diagnostic — what
 * the import dialog renders its support table from. Locked as canonical rows
 * so a change to treatment, count or table-agreement is a deliberate,
 * test-visible act. Counts re-derive from the fixtures' own content: 87
 * metadata TEXTs = 20 blocks × 4 Key:Value fields + 7 style fields; 344
 * skipped = 431 layer-1 TEXTs − 87.
 */

{
  const canonical = (rows: readonly LayerUsageRow[]): string =>
    rows.map((r) => `${r.layer}|${r.entity}|${r.count}|${r.treatment}|${r.concept}|${r.tableAgrees}`).join('\n');

  const fixture1 = importDxfWithDiagnostics(fixture, { flavour: 'aama', assumeUnit: 'mm' });
  check(
    'fixture 1 layers: one row — the boundary polylines, table agreeing',
    canonical(fixture1.layers) === '1|POLYLINE|5|outline|piece-boundary|true',
    canonical(fixture1.layers),
  );

  const expected2 = [
    '1|POLYLINE|20|outline|piece-boundary|true',
    '1|TEXT|87|metadata|piece-boundary|false',
    '1|TEXT|344|skipped|piece-boundary|false',
    '5|LINE|20|construction|grade-reference|false',
    '7|LINE|20|construction|grain-line|true',
    '15|TEXT|20|skipped|sew-line|false',
  ].join('\n');
  check('fixture 2 layers: six rows, treatments and table agreement as reviewed', canonical(tshirtResult.layers) === expected2, canonical(tshirtResult.layers));

  const again = importDxfWithDiagnostics(tshirt, { flavour: 'aama', assumeUnit: 'mm' });
  check('layers are deterministic across re-imports', canonical(again.layers) === canonical(tshirtResult.layers), 'ok');

  check(
    'every table disagreement in layers has a matching layer-entity-conflict diagnostic',
    tshirtResult.layers
      .filter((r) => r.tableAgrees === false)
      .every((r) =>
        tshirtResult.issues.some(
          (i) => i.code === 'layer-entity-conflict' && i.message.includes(`Layer "${r.layer}"`) && i.message.includes(`puts ${r.entity} there`),
        ),
      ),
    'ok',
  );
}

console.log(failures === 0 ? '\nAll DXF import checks passed.' : `\n${failures} DXF import check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
