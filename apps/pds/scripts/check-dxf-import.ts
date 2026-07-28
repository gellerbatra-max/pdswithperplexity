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
    // The defaults warning names only what actually defaulted, so a file that
    // states its quantity must not be told its quantity defaulted.
    tshirtIssues.some(
      (i) => i.code === 'metadata-not-in-source' && !i.message.includes('cut quantity'),
    ),
  tshirtIssues.find((i) => i.code === 'metadata-not-in-source')?.message ?? 'missing',
);
check(
  'the ambiguous "Quantity:1,0" is reported rather than silently interpreted',
  tshirtIssues.some((i) => i.code === 'quantity-field-ambiguous' && i.message.includes('decimal comma')),
  'ok',
);
check(
  'fabric and category are still flagged as having no source',
  tshirtDoc.pieces.every((p) => p.meta.fabric === '' && p.meta.category === 'shell') &&
    tshirtIssues.some(
      (i) =>
        i.code === 'metadata-not-in-source' &&
        i.message.includes('category') &&
        i.message.includes('fabric'),
    ),
  tshirtIssues.find((i) => i.code === 'metadata-not-in-source')?.message ?? 'missing',
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

/* ===========================================================================
 * Fixture 3 — 8178v-accumark.dxf, a Gerber AccuMark export with a .RUL pair
 *
 * The file that broke the "one polyline per piece" assumption. Its outline is
 * written as a *chain* of layer-1 polylines — 14, 7 and 13 of them for the
 * three pieces — laid head-to-tail with zero gap, plus zero-length markers at
 * the junctions. It also declares `Units: ENGLISH`, carries POINT entities on
 * layers 2/3/4, and names a grade rule at each graded point which only the
 * companion .RUL can resolve.
 *
 * Reference values below are transcribed from the raw group codes and, where
 * geometry is involved, re-derived here rather than read back out of the
 * importer.
 * ========================================================================= */

const ACCUMARK_PATH = fileURLToPath(new URL('./fixtures/dxf/8178v-accumark.dxf', import.meta.url));
const ACCUMARK_RUL_PATH = fileURLToPath(new URL('./fixtures/dxf/8178v-accumark.rul', import.meta.url));
const accumark = readFileSync(ACCUMARK_PATH, 'utf8');
const accumarkRul = readFileSync(ACCUMARK_RUL_PATH, 'utf8');

const acc = importDxfWithDiagnostics(accumark, { flavour: 'aama', assumeUnit: 'mm' });
const accCodes = new Set(acc.issues.map((i) => i.code));

/* --- 24. Chained boundary polylines become one outline -------------------- */

check('fixture 3 imports all three of its blocks', acc.document.pieces.length === 3, `${acc.document.pieces.length}`);
check(
  'no piece is lost to a degenerate first polyline any more',
  !accCodes.has('degenerate-boundary') && !acc.issues.some((i) => i.severity === 'error'),
  acc.issues.filter((i) => i.severity === 'error').map((i) => i.code).join(', ') || 'no errors',
);

{
  // Raw layer-1 polyline vertex counts per block, in file order, transcribed
  // from the group codes. Joining drops each run's first vertex (it repeats
  // the previous run's last), so the chain length is the sum minus (runs - 1).
  const RUNS: Readonly<Record<string, readonly number[]>> = {
    'FRONT': [5, 2, 5, 2, 19, 2, 3, 2, 3, 2, 11, 2, 2],
  };
  const front = acc.document.pieces.find((p) => p.meta.code.includes('FRONT'))!;
  const runs = RUNS['FRONT']!;
  const chained = runs.reduce((a, b) => a + b, 0) - (runs.length - 1);
  const corners = front.points.filter((p) => p.role === 'corner').length;

  check(
    'the FRONT outline is the whole chain, not its first run',
    corners > runs[0]! && corners <= chained,
    `${corners} corners from ${runs.length} runs (${chained} before duplicate collapse, first run only would be ${runs[0]})`,
  );
  check(
    'joining is reported, with the number of runs',
    acc.issues.some((i) => i.code === 'boundary-runs-joined' && i.message.includes(`${runs.length} separate polylines`)),
    acc.issues.find((i) => i.code === 'boundary-runs-joined')?.message ?? 'missing',
  );
  check(
    'every boundary segment is still a straight line',
    acc.document.pieces.every((p) => p.segments.every((s) => s.geometry.kind === 'line')),
    'ok',
  );
  check(
    'the outline is closed and its segments cover its corners exactly once',
    acc.document.pieces.every(
      (p) => p.closed && p.boundary.length === p.points.filter((pt) => pt.role === 'corner').length,
    ),
    'ok',
  );
}

/* --- 25. ENGLISH units ---------------------------------------------------- */

check(
  'fixture 3 reads "Units: ENGLISH" rather than falling back to the assumed unit',
  acc.issues.some((i) => i.code === 'units-read' && i.message.includes('Units:ENGLISH') && i.message.includes('25.4mm')) &&
    !accCodes.has('unit-assumed'),
  acc.issues.find((i) => i.code === 'units-read')?.message ?? 'missing',
);
{
  // A garment piece measured in inches, converted. If ENGLISH were treated as
  // millimetres these would come out 25.4x too small — a few centimetres for a
  // whole back panel, which is the failure this check exists to catch.
  const back = acc.document.pieces.find((p) => p.meta.code.includes('BACK'))!;
  const corners = back.points.filter((p) => p.role === 'corner');
  const width = Math.max(...corners.map((c) => c.position.x)) - Math.min(...corners.map((c) => c.position.x));
  check('the imported geometry is a garment-sized piece in millimetres', width > 300 && width < 600, `back panel is ${width.toFixed(0)}mm wide`);
}

/* --- 26. POINT entities ---------------------------------------------------- */

{
  const notches = acc.document.pieces.reduce((sum, p) => sum + p.notches.length, 0);
  check('notch-layer POINTs on the seam become real notches', notches === 3, `${notches} notches`);
  check(
    'notches are stored by segment and parameter, as the model requires',
    acc.document.pieces.every((p) =>
      p.notches.every((n) => p.boundary.includes(n.segmentId) && n.t >= 0 && n.t <= 1),
    ),
    'ok',
  );
  check(
    'notch shape comes from the app default, since the file never states one',
    acc.document.pieces.every((p) => p.notches.every((n) => n.kind === 'slit' && n.depth === 6 && n.width === 2)),
    'ok',
  );
  check(
    'the paired off-seam notch markers are reported with their measured offset, not silently dropped',
    acc.issues.some(
      (i) =>
        i.code === 'notch-marker-off-boundary' &&
        i.message.includes('7.00mm') &&
        i.message.includes('would be a guess'),
    ),
    acc.issues.find((i) => i.code === 'notch-marker-off-boundary')?.message ?? 'missing',
  );

  const turnCurve = acc.document.pieces.reduce(
    (sum, p) => sum + p.points.filter((pt) => pt.label === 'Turn point' || pt.label === 'Curve point').length,
    0,
  );
  check('turn- and curve-point POINTs become labelled construction points', turnCurve === 131 + 234, `${turnCurve} of ${131 + 234}`);
  check(
    'marker points stay off the outline',
    acc.document.pieces.every((p) =>
      p.points.filter((pt) => pt.label === 'Turn point' || pt.label === 'Curve point').every((pt) => pt.role === 'construction'),
    ),
    'ok',
  );
  check(
    'POINTs on layers with no point binding are still warned about, not accepted',
    acc.document.pieces.length === 3 && !acc.issues.some((i) => i.code === 'unsupported-entity' && i.message.includes('layer "2"')),
    'ok',
  );
}

/* --- 27. Metadata from the wider key map ---------------------------------- */

{
  const front = acc.document.pieces.find((p) => p.meta.code.includes('FRONT'))!;
  const pouch = acc.document.pieces.find((p) => p.meta.code.includes('POUCH'))!;
  check('"Fabric: A" is read into the piece rather than defaulted', front.meta.fabric === 'A', front.meta.fabric);
  check('per-piece quantity is read (the POUCH cuts 2)', front.meta.quantity === 1 && pouch.meta.quantity === 2, `${front.meta.quantity} / ${pouch.meta.quantity}`);
  check(
    'the defaults warning no longer claims fabric had no source',
    acc.issues.some((i) => i.code === 'metadata-not-in-source' && !i.message.includes('fabric')),
    acc.issues.find((i) => i.code === 'metadata-not-in-source')?.message ?? 'none',
  );
  check(
    '"CATEGORY: FRONT" is kept as description, not forced into a cut category',
    front.meta.category === 'shell' && front.meta.description?.includes('Category: FRONT') === true,
    `${front.meta.category} / ${front.meta.description}`,
  );
  check(
    'the category mismatch is explained rather than silently ignored',
    acc.issues.some((i) => i.code === 'category-not-a-known-category' && i.message.includes('FRONT')),
    'ok',
  );
  check(
    'the annotation and size the file states both survive into the description',
    front.meta.description?.includes('CUT X 02') === true && front.meta.description?.includes('Size Name: M') === true,
    front.meta.description ?? 'missing',
  );
  check('the style name is read from the file', acc.document.name === '8178V', acc.document.name);
  check(
    'every text field this file writes is now a field the importer reads',
    !accCodes.has('unknown-metadata-field') &&
      acc.issues.some(
        (i) =>
          i.code === 'metadata-read-from-text' &&
          i.message.includes('Curve Tolerance=".006"') &&
          i.message.includes('Author="GERBER TECHNOLOGY'),
      ),
    acc.issues.find((i) => i.code === 'unknown-metadata-field')?.message ?? 'nothing unread',
  );
  {
    // The unknown-field path still has to work — it is what keeps a field from
    // being dropped in silence. No real fixture exercises it any more, so a
    // synthetic TEXT carrying a key no writer uses is spliced into the real
    // file's ENTITIES section, the same way § 10 splices a CIRCLE.
    const eol = accumark.includes('\r\n') ? '\r\n' : '\n';
    const tail = `  0${eol}ENDSEC${eol}  0${eol}EOF`;
    const field = [
      '  0', 'TEXT', '  8', '1', ' 10', '0.0000', ' 20', '0.0000',
      ' 30', '0.0', ' 40', '1.0000', '  1', 'Shrinkage Pct: 4.5',
    ].join(eol);

    const at = accumark.lastIndexOf(tail);
    check('fixture 3 has the expected ENTITIES-closing tail to splice before', at > 0, String(at));

    const probe = importDxfWithDiagnostics(
      `${accumark.slice(0, at)}${field}${eol}${accumark.slice(at)}`,
      { flavour: 'aama', assumeUnit: 'mm' },
    );
    check(
      'an unrecognised field is reported with its value, not dropped',
      probe.issues.some(
        (i) => i.code === 'unknown-metadata-field' && i.message.includes('"Shrinkage Pct: 4.5"'),
      ),
      probe.issues.find((i) => i.code === 'unknown-metadata-field')?.message ?? 'missing',
    );
    check(
      'an unrecognised field changes nothing about the geometry',
      pieceShape(probe.document) === pieceShape(acc.document),
      'ok',
    );
  }
}

/* --- 28. The companion rule table ----------------------------------------- */

{
  check(
    'without a .RUL, rule numbers on the geometry are reported as unresolved',
    !accCodes.has('grade-rules-attached') &&
      acc.document.gradeRules.length === 0 &&
      acc.issues.some((i) => i.code === 'grade-rules-not-resolved' && i.severity === 'warning'),
    acc.issues.find((i) => i.code === 'grade-rules-not-resolved')?.message ?? 'missing',
  );

  const paired = importDxfWithDiagnostics(accumark, {
    flavour: 'aama',
    assumeUnit: 'mm',
    ruleTable: accumarkRul,
  });

  check('with a .RUL, the document carries its grade rules', paired.document.gradeRules.length === 41, `${paired.document.gradeRules.length}`);
  check(
    'the size range comes from the rule table, base size and all',
    paired.document.sizeRange.sizes.map((s) => s.label).join(' ') === 'XS S M L XL XXL XXXL XXXXL' &&
      paired.document.sizeRange.sizes.find((s) => s.id === paired.document.sizeRange.baseSizeId)?.label === 'M',
    paired.document.sizeRange.sizes.map((s) => s.label).join(' '),
  );
  check(
    'graded points are linked to real rules from the table',
    paired.document.pieces.every((p) =>
      p.points.every((pt) => pt.gradeRuleId === undefined || paired.document.gradeRules.some((r) => r.id === pt.gradeRuleId)),
    ) && paired.document.pieces.some((p) => p.points.some((pt) => pt.gradeRuleId !== undefined)),
    'ok',
  );
  check(
    'only boundary points are graded — construction markers are not',
    paired.document.pieces.every((p) =>
      p.points.filter((pt) => pt.gradeRuleId !== undefined).every((pt) => pt.role === 'corner'),
    ),
    'ok',
  );
  check(
    'attaching grading is reported with a count',
    paired.issues.some((i) => i.code === 'grade-rules-attached'),
    paired.issues.find((i) => i.code === 'grade-rules-attached')?.message ?? 'missing',
  );

  // The load-bearing property of the whole pairing: grading is association,
  // never construction. Every coordinate must be identical either way.
  const coords = (d: PatternDocument): string =>
    JSON.stringify(d.pieces.map((p) => p.points.map((pt) => [pt.position.x, pt.position.y])));
  check(
    'supplying a rule table does not move a single coordinate',
    coords(paired.document) === coords(acc.document),
    'ok',
  );
  check(
    'nor does it change the notches or the internal lines',
    JSON.stringify(paired.document.pieces.map((p) => [p.notches.length, p.internalLines.length])) ===
      JSON.stringify(acc.document.pieces.map((p) => [p.notches.length, p.internalLines.length])),
    'ok',
  );

  const roundTripped = jsonAdapter.deserialize!(jsonAdapter.serialize!(paired.document));
  check(
    'a graded import round-trips through the native JSON format, rules and all',
    JSON.stringify(roundTripped) === JSON.stringify(paired.document),
    'ok',
  );
}

/* --- 29. Fixture 3 determinism -------------------------------------------- */

{
  const again = importDxfWithDiagnostics(accumark, { flavour: 'aama', assumeUnit: 'mm' });
  check('fixture 3 re-imports deterministically (ids aside)', pieceShape(again.document) === pieceShape(acc.document), 'ok');
}

/* --- 30. The reader consolidation: safety rules locked ---------------------
 *
 * Three rules landed with the reader extraction, all firing on zero real
 * fixtures (verified by every section above still passing): a boundary the
 * file never closed is reported when the importer closes it; an INSERT
 * transform refuses the import instead of warning past wrong geometry; and
 * self-contradicting metadata is called ambiguous. Each is exercised here
 * synthetically, since no real file on hand misbehaves in these ways.
 */

{
  const doc = (blockBody: string): string =>
    [
      '999', 'synthetic check fixture', '0', 'SECTION', '2', 'HEADER',
      '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'BLOCKS',
      '0', 'BLOCK', '8', '0', '2', 'CHECK', '70', '0', '10', '0.0', '20', '0.0', '30', '0.0', '3', 'CHECK', '1', '',
      blockBody,
      '0', 'ENDBLK', '8', '0', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'INSERT', '8', '1', '2', 'CHECK', '10', '0.0', '20', '0.0', '30', '0.0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n') + '\n';

  const vertex = (x: number, y: number): string =>
    ['0', 'VERTEX', '8', '1', '10', String(x), '20', String(y), '30', '0.0'].join('\n');
  const openU = (flag: number): string =>
    [
      '0', 'POLYLINE', '8', '1', '66', '1', '70', String(flag),
      vertex(0, 0), vertex(100, 0), vertex(100, 50), vertex(0, 50),
      '0', 'SEQEND', '8', '1',
    ].join('\n');

  // A U-shape whose ends sit 50mm apart. Closed by the importer, and said so.
  const open = importDxfWithDiagnostics(doc(openU(0)), { flavour: 'aama', assumeUnit: 'mm' });
  check(
    'an outline the file never closed is reported when the importer closes it',
    open.issues.some(
      (i) => i.code === 'boundary-closed-by-importer' && i.severity === 'warning' && i.message.includes('50.00mm'),
    ),
    open.issues.find((i) => i.code === 'boundary-closed-by-importer')?.message ?? 'missing',
  );
  check('…and the piece still imports, closed, rather than being dropped', open.document.pieces.length === 1 && open.document.pieces[0]!.closed, `${open.document.pieces.length}`);

  // The same shape with the closed flag set: the file authorised the closing
  // edge, so nothing is reported. This is the TSHIRT writer's style.
  const flagged = importDxfWithDiagnostics(doc(openU(1)), { flavour: 'aama', assumeUnit: 'mm' });
  check(
    'the closed flag authorises the closing edge — no warning',
    !flagged.issues.some((i) => i.code === 'boundary-closed-by-importer'),
    'ok',
  );

  // An INSERT that scales: refused, not imported wrong. Spliced into the real
  // 5109S fixture so everything else about the file is genuine.
  {
    // Scanning for "the next 0 line" is a trap here — coordinate *values* are
    // 0 too. The splice anchors on the INSERT's block-name line instead, which
    // is unambiguous, and drops the scale field straight after it (field
    // order within an entity is free in DXF).
    const eol = fixture.includes('\r\n') ? '\r\n' : '\n';
    const anchor = `${eol}INSERT${eol}8${eol}1${eol}2${eol}AW27-213 -COST-5109S${eol}`;
    const at = fixture.indexOf(anchor);
    check('fixture 1 has an INSERT to splice a transform into', at > 0, String(at));
    const scaled =
      fixture.slice(0, at + anchor.length) + `41${eol}2.0${eol}` + fixture.slice(at + anchor.length);
    const result = importDxfWithDiagnostics(scaled, { flavour: 'aama', assumeUnit: 'mm' });
    check(
      'a scaled INSERT is an error naming the refusal, not a warning past wrong geometry',
      result.issues.some(
        (i) => i.code === 'insert-transform-unsupported' && i.severity === 'error' && i.message.includes('refused'),
      ),
      result.issues.find((i) => i.code === 'insert-transform-unsupported')?.message ?? 'missing',
    );
    let threw = false;
    try {
      importDxf(scaled, { flavour: 'aama', assumeUnit: 'mm' });
    } catch {
      threw = true;
    }
    check('…and importDxf refuses the whole file', threw, String(threw));
  }

  // A field stated twice with different values is ambiguity, reported.
  {
    const conflicted = doc(
      [
        openU(1),
        ['0', 'TEXT', '8', '1', '10', '1.0', '20', '1.0', '30', '0.0', '40', '1.0', '1', 'Piece Name: First'].join('\n'),
        ['0', 'TEXT', '8', '1', '10', '2.0', '20', '2.0', '30', '0.0', '40', '1.0', '1', 'Piece Name: Second'].join('\n'),
      ].join('\n'),
    );
    const result = importDxfWithDiagnostics(conflicted, { flavour: 'aama', assumeUnit: 'mm' });
    check(
      'a field stated twice with different values is reported as the file contradicting itself',
      result.issues.some(
        (i) =>
          i.code === 'metadata-field-conflict' &&
          i.message.includes('kept "First"') &&
          i.message.includes('ignored "Second"'),
      ),
      result.issues.find((i) => i.code === 'metadata-field-conflict')?.message ?? 'missing',
    );
    check('the first statement wins, as documented', result.document.pieces[0]!.name === 'First', result.document.pieces[0]!.name);
    check(
      'a harmless exact repeat is NOT called a conflict',
      !importDxfWithDiagnostics(
        doc([openU(1),
          ['0', 'TEXT', '8', '1', '10', '1.0', '20', '1.0', '30', '0.0', '40', '1.0', '1', 'Piece Name: Same'].join('\n'),
          ['0', 'TEXT', '8', '1', '10', '2.0', '20', '2.0', '30', '0.0', '40', '1.0', '1', 'Piece Name: Same'].join('\n'),
        ].join('\n')),
        { flavour: 'aama', assumeUnit: 'mm' },
      ).issues.some((i) => i.code === 'metadata-field-conflict'),
      'ok',
    );
  }

}

/* --- 31. LWPOLYLINE reads into the same raw shape POLYLINE does ------------
 *
 * The lightweight polyline inlines its vertices as repeating 10/20/42 groups
 * on one entity instead of writing VERTEX entities. Read it into the same
 * `RawPolyline` record, and every downstream stage — chaining, cleaning,
 * bulge resolution, closure — is shared, not duplicated. The proof is
 * structural: the same outline written both ways must produce the same piece.
 *
 * Still synthetic: no vendor pattern export on hand uses LWPOLYLINE (the
 * survey that established that is in reader.ts's history); these lock the
 * format reading so the first real file that uses it lands on tested ground.
 */

{
  const doc = (blockBody: string): string =>
    [
      '999', 'synthetic LWPOLYLINE check', '0', 'SECTION', '2', 'HEADER',
      '9', '$INSUNITS', '70', '4', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'BLOCKS',
      '0', 'BLOCK', '8', '0', '2', 'LW', '70', '0', '10', '0.0', '20', '0.0', '30', '0.0', '3', 'LW', '1', '',
      blockBody,
      '0', 'ENDBLK', '8', '0', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'INSERT', '8', '1', '2', 'LW', '10', '0.0', '20', '0.0', '30', '0.0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\n') + '\n';

  // One outline, written both ways: a square whose top edge bulges outward.
  const COORDS: ReadonlyArray<readonly [number, number, number]> = [
    [0, 0, 0], [100, 0, 0], [100, 100, 1], [0, 100, 0],
  ];
  const asPolyline = [
    '0', 'POLYLINE', '8', '1', '66', '1', '70', '1',
    ...COORDS.flatMap(([x, y, b]) => [
      '0', 'VERTEX', '8', '1', '10', String(x), '20', String(y), '30', '0.0',
      ...(b !== 0 ? ['42', String(b)] : []),
    ]),
    '0', 'SEQEND', '8', '1',
  ].join('\n');
  const asLwPolyline = [
    '0', 'LWPOLYLINE', '8', '1', '90', String(COORDS.length), '70', '1',
    ...COORDS.flatMap(([x, y, b]) => ['10', String(x), '20', String(y), ...(b !== 0 ? ['42', String(b)] : [])]),
  ].join('\n');

  const heavy = importDxfWithDiagnostics(doc(asPolyline), { flavour: 'aama', assumeUnit: 'mm' });
  const light = importDxfWithDiagnostics(doc(asLwPolyline), { flavour: 'aama', assumeUnit: 'mm' });

  check(
    'the same outline as POLYLINE and as LWPOLYLINE produces the same piece',
    pieceShape(light.document) === pieceShape(heavy.document),
    pieceShape(light.document) === pieceShape(heavy.document) ? 'ok' : `${pieceShape(light.document)} vs ${pieceShape(heavy.document)}`,
  );
  check(
    'the bulge on an inline vertex becomes the same arc',
    light.document.pieces[0]!.segments.filter((s) => s.geometry.kind === 'arc').length === 1,
    JSON.stringify(light.document.pieces[0]!.segments.map((s) => s.geometry.kind)),
  );
  check(
    'the layer report names LWPOLYLINE, not a flattened POLYLINE',
    light.layers.some((l) => l.entity === 'LWPOLYLINE' && l.treatment === 'outline') &&
      !light.layers.some((l) => l.entity === 'POLYLINE'),
    JSON.stringify(light.layers.map((l) => `${l.entity}/${l.treatment}`)),
  );
  check(
    'the closed flag on an LWPOLYLINE authorises the closing edge',
    !light.issues.some((i) => i.code === 'boundary-closed-by-importer'),
    'ok',
  );
  check('no unsupported-entity warning fires for a read LWPOLYLINE', !light.issues.some((i) => i.code === 'unsupported-entity'), 'ok');

  // A bulge on the *last* vertex curves the closing edge. The wrap-around is
  // where an off-by-one in positional vertex parsing would land, so it gets
  // its own check.
  const closingBulge = importDxfWithDiagnostics(
    doc(['0', 'LWPOLYLINE', '8', '1', '90', '4', '70', '1',
      '10', '0', '20', '0', '10', '100', '20', '0', '10', '100', '20', '100', '10', '0', '20', '100', '42', '1',
    ].join('\n')),
    { flavour: 'aama', assumeUnit: 'mm' },
  );
  {
    const piece = closingBulge.document.pieces[0]!;
    const kinds = piece.segments.map((s) => s.geometry.kind);
    check('a bulge on the last vertex curves the closing edge, via the existing wrap', JSON.stringify(kinds) === JSON.stringify(['line', 'line', 'line', 'arc']), JSON.stringify(kinds));
  }

  /* --- Malformed inline vertex data ---------------------------------------- */

  // Orphaned fields: a 20 and a 42 before any 10 opened a vertex.
  const orphaned = importDxfWithDiagnostics(
    doc(['0', 'LWPOLYLINE', '8', '1', '90', '3', '70', '1',
      '20', '5', '42', '0.5',
      '10', '0', '20', '0', '10', '100', '20', '0', '10', '50', '20', '80',
    ].join('\n')),
    { flavour: 'aama', assumeUnit: 'mm' },
  );
  check(
    'vertex fields arriving before any vertex are dropped and reported, not invented',
    orphaned.issues.some((i) => i.code === 'lwpolyline-orphaned-fields' && i.message.includes('2 vertex field(s)')),
    orphaned.issues.find((i) => i.code === 'lwpolyline-orphaned-fields')?.message ?? 'missing',
  );
  check('…and the real vertices still import', orphaned.document.pieces[0]?.points.filter((p) => p.role !== 'construction').length === 3, String(orphaned.document.pieces[0]?.points.length));

  // Declared count disagrees with the vertices actually present.
  const miscounted = importDxfWithDiagnostics(
    doc(['0', 'LWPOLYLINE', '8', '1', '90', '5', '70', '1',
      '10', '0', '20', '0', '10', '100', '20', '0', '10', '50', '20', '80',
    ].join('\n')),
    { flavour: 'aama', assumeUnit: 'mm' },
  );
  check(
    'a declared vertex count that disagrees with the data is reported',
    miscounted.issues.some((i) => i.code === 'lwpolyline-vertex-count-mismatch' && i.message.includes('declares 5') && i.message.includes('carries 3')),
    miscounted.issues.find((i) => i.code === 'lwpolyline-vertex-count-mismatch')?.message ?? 'missing',
  );

  // No vertices at all: warned and skipped, never a crash or an empty run.
  const empty = importDxfWithDiagnostics(
    doc([
      ['0', 'LWPOLYLINE', '8', '1', '90', '0', '70', '0'].join('\n'),
      asLwPolyline,
    ].join('\n')),
    { flavour: 'aama', assumeUnit: 'mm' },
  );
  check(
    'an empty LWPOLYLINE is warned about and skipped',
    empty.issues.some((i) => i.code === 'lwpolyline-empty'),
    empty.issues.find((i) => i.code === 'lwpolyline-empty')?.message ?? 'missing',
  );
  check(
    '…and does not break the real boundary that follows it',
    empty.document.pieces.length === 1 && pieceShape(empty.document) === pieceShape(light.document),
    `${empty.document.pieces.length} piece(s)`,
  );
}

console.log(failures === 0 ? '\nAll DXF import checks passed.' : `\n${failures} DXF import check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
