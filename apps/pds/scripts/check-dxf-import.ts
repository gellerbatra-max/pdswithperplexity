import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  importDxf,
  importDxfWithDiagnostics,
  describeImportPlan,
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
 * This is a regression set of *one* real file. That is a start, not the
 * "small representative set" real production import needs — see
 * DEVELOPMENT.md for what a second file (ideally one that actually uses
 * notches, grain lines or curves) would unlock.
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
}

console.log(failures === 0 ? '\nAll DXF import checks passed.' : `\n${failures} DXF import check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
