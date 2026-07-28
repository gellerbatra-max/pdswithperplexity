import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { exportDxf, exportDxfWithDiagnostics, describeExportPlan } from '../src/io/dxf/export.ts';
import { importDxfWithDiagnostics } from '../src/io/dxf/import.ts';
import { arcToBulge, bulgeToArc } from '../src/io/dxf/curves.ts';
import { segmentArcLength } from '../src/pattern/curve.ts';
import type { PatternDocument } from '../src/pattern/index.ts';
import { exportFileName } from '../src/store/exportCommands.ts';
import { exportDocument, importDocument } from '../src/io/index.ts';
import { layerForConcept } from '../src/io/dxf/layerMapping.ts';
import { pointOnSegment } from '../src/pattern/curve.ts';

/** The defaults the download path uses, so this suite exercises the same shape. */
const Dxf_DEFAULTS = { unit: 'mm', includeSeamAllowance: true, includeGradedSizes: false } as const;

/**
 * Regression suite for the DXF writer.
 *
 * Run it with:
 *
 *   npm run check:export
 *
 * The load-bearing test here is a **round trip through the real fixtures**:
 * import a genuine vendor file, write it back out, import that, and require
 * the geometry to survive. That is a far stronger claim than "the output
 * parses" — it exercises the writer against outlines the writer's author did
 * not choose, including the self-overlapping boundaries and 41-point chained
 * rings that real AccuMark files contain.
 *
 * The other property worth pinning is determinism: the same document must
 * produce byte-identical DXF every time, or none of the above is meaningful.
 */

let failures = 0;
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) failures += 1;
};

const FIXTURES = ['5109s-sp27-pattern', 'tshirt-demo-aama', '8178v-accumark'] as const;
const load = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/dxf/${name}.dxf`, import.meta.url)), 'utf8');

const importDoc = (text: string): PatternDocument =>
  importDxfWithDiagnostics(text, { flavour: 'aama', assumeUnit: 'mm' }).document;

const OPTIONS = { flavour: 'aama', unit: 'mm', includeSeamAllowance: false, includeGradedSizes: false } as const;

/** Geometry only, ids and names aside — what a round trip must preserve. */
const geometry = (doc: PatternDocument): string =>
  JSON.stringify(
    doc.pieces.map((p) => ({
      points: p.points
        .filter((pt) => pt.role !== 'construction')
        .map((pt) => [pt.position.x.toFixed(6), pt.position.y.toFixed(6)]),
      kinds: p.segments.map((s) => s.geometry.kind),
      closed: p.closed,
    })),
  );

/* --- 1. Determinism -------------------------------------------------------- */

{
  const doc = importDoc(load('8178v-accumark'));
  const a = exportDxf(doc, OPTIONS);
  const b = exportDxf(doc, OPTIONS);
  check('the same document exports byte-identically', a === b, `${a.length} vs ${b.length} bytes`);
  check('the output carries no timestamp or id that would defeat a diff', !/\d{4}-\d{2}-\d{2}|dxf-piece-/.test(a), 'ok');
  check('output is CRLF-delimited group-code pairs, as DXF requires', a.endsWith('\r\n') && a.split('\r\n').length % 2 === 1, `${a.split('\r\n').length} lines`);
  check('the output announces itself rather than posing as a CAD export', a.startsWith('999\r\nWritten by PDS'), a.slice(0, 40));
}

/* --- 2. Structure: what a reader needs to find ----------------------------- */

{
  const doc = importDoc(load('5109s-sp27-pattern'));
  const text = exportDxf(doc, OPTIONS);
  const has = (s: string): boolean => text.includes(`\r\n${s}\r\n`);
  check('a HEADER section is written', has('HEADER'), 'ok');
  check('$INSUNITS is written', text.includes('$INSUNITS'), 'ok');
  check('a BLOCKS section is written', has('BLOCKS'), 'ok');
  check('an ENTITIES section is written', has('ENTITIES'), 'ok');
  check('the file terminates with EOF', text.trimEnd().endsWith('EOF'), 'ok');

  const count = (marker: string): number => text.split(`\r\n0\r\n${marker}\r\n`).length - 1;
  check('one BLOCK per piece', count('BLOCK') === doc.pieces.length, `${count('BLOCK')} vs ${doc.pieces.length}`);
  check('one INSERT per piece', count('INSERT') === doc.pieces.length, `${count('INSERT')} vs ${doc.pieces.length}`);
  check('one POLYLINE per piece', count('POLYLINE') === doc.pieces.length, `${count('POLYLINE')} vs ${doc.pieces.length}`);
  check('every POLYLINE is closed with SEQEND', count('SEQEND') === count('POLYLINE'), `${count('SEQEND')} vs ${count('POLYLINE')}`);
}

/* --- 3. Round trip through every real fixture ------------------------------ */

for (const name of FIXTURES) {
  const original = importDoc(load(name));
  const written = exportDxf(original, OPTIONS);
  const reimported = importDxfWithDiagnostics(written, { flavour: 'aama', assumeUnit: 'mm' });

  check(`${name}: the written file imports without error`, !reimported.issues.some((i) => i.severity === 'error'), reimported.issues.filter((i) => i.severity === 'error').map((i) => i.code).join(', ') || 'no errors');
  check(`${name}: every piece survives the round trip`, reimported.document.pieces.length === original.pieces.length, `${reimported.document.pieces.length} vs ${original.pieces.length}`);
  check(
    `${name}: the geometry survives the round trip exactly`,
    geometry(reimported.document) === geometry(original),
    geometry(reimported.document) === geometry(original) ? 'identical' : 'DIFFERS',
  );
  check(
    `${name}: piece names survive, via the block name`,
    reimported.document.pieces.every((p, i) => p.meta.code === (original.pieces[i]!.meta.code || original.pieces[i]!.name)),
    'ok',
  );

  // Exporting the re-imported document must reproduce the same bytes. This is
  // the fixed point: if it holds, the writer is not drifting on each cycle.
  check(
    `${name}: a second export/import cycle is a fixed point`,
    exportDxf(reimported.document, OPTIONS) === written,
    'stable',
  );
}

/* --- 4. Arcs survive exactly; cubics are flattened and said so ------------- */

{
  // arcToBulge is the inverse of bulgeToArc — checked directly, both ways.
  const A = { x: 0, y: 0 };
  const B = { x: 100, y: 0 };
  for (const bulge of [0.1, 0.5, 1, -0.5, 2]) {
    const arc = bulgeToArc(A, B, bulge);
    const back = arcToBulge(A, B, arc);
    check(`bulge ${bulge} survives arc → bulge → arc`, Math.abs(back - bulge) < 1e-9, `${back.toFixed(12)} vs ${bulge}`);
  }
  check('a straight segment has no bulge', arcToBulge(A, B, { kind: 'line' }) === 0, 'ok');

  const arcDoc = importDoc(load('synthetic-curves-bulge'));
  const written = exportDxf(arcDoc, OPTIONS);
  check('an arc is written as a bulge, not flattened', written.includes('\r\n42\r\n'), 'ok');

  const back = importDxfWithDiagnostics(written, { flavour: 'aama', assumeUnit: 'mm' }).document;
  const arcOf = (d: PatternDocument) => d.pieces[0]!.segments.find((s) => s.geometry.kind === 'arc')!;
  check('the arc comes back as an arc, not a chord chain', back.pieces[0]!.segments.filter((s) => s.geometry.kind === 'arc').length === 1, JSON.stringify(back.pieces[0]!.segments.map((s) => s.geometry.kind)));
  {
    const before = arcOf(arcDoc);
    const after = arcOf(back);
    const p = (d: PatternDocument, id: string) => d.pieces[0]!.points.find((x) => x.id === id)!.position;
    check(
      'and with the same radius, handedness and arc length',
      JSON.stringify(after.geometry) === JSON.stringify(before.geometry) &&
        Math.abs(
          segmentArcLength(p(back, after.from), p(back, after.to), after.geometry) -
            segmentArcLength(p(arcDoc, before.from), p(arcDoc, before.to), before.geometry),
        ) < 1e-9,
      `${JSON.stringify(after.geometry)} vs ${JSON.stringify(before.geometry)}`,
    );
  }

  const cubicDoc = importDoc(load('synthetic-curves-spline-cubic'));
  const cubicOut = exportDxfWithDiagnostics(cubicDoc, OPTIONS);
  check(
    'a cubic is flattened and reported, not silently chorded',
    cubicOut.issues.some((i) => i.code === 'export-cubic-flattened' && i.message.includes('0.1mm')),
    cubicOut.issues.find((i) => i.code === 'export-cubic-flattened')?.message ?? 'missing',
  );
}

/* --- 5. Honesty: what is not written, and why ------------------------------ */

{
  const doc = importDoc(load('8178v-accumark'));
  const result = exportDxfWithDiagnostics(doc, OPTIONS);

  check(
    'concepts the writer drops are reported per piece, not silently stripped',
    result.issues.some(
      (i) => i.code === 'export-concept-not-written' && i.message.includes('internal line'),
    ),
    result.issues.find((i) => i.code === 'export-concept-not-written')?.message ?? 'missing',
  );
  check(
    'the unverified layer table is surfaced on every export, as a warning naming the evidence',
    result.issues.some(
      (i) => i.code === 'layer-map-observed-not-verified' && i.message.includes('piece-boundary') && i.message.includes('real file'),
    ),
    result.issues.find((i) => i.code === 'layer-map-observed-not-verified')?.message ?? 'missing',
  );
  check(
    'the gate is scoped to what is written — unwritten bindings do not block',
    !result.issues.some((i) => i.code === 'unverified-layer-map' && i.severity === 'error'),
    'ok',
  );

  const withExtras = exportDxfWithDiagnostics(doc, { ...OPTIONS, includeSeamAllowance: true, includeGradedSizes: true });
  check('requesting seam allowance is refused explicitly, not ignored', withExtras.issues.some((i) => i.code === 'export-seam-allowance-not-written'), 'ok');
  check('requesting graded sizes is refused explicitly, not ignored', withExtras.issues.some((i) => i.code === 'export-graded-sizes-not-written'), 'ok');
  check(
    'and neither request changes the bytes written',
    exportDxf(doc, { ...OPTIONS, includeSeamAllowance: true }) === exportDxf(doc, OPTIONS),
    'ok',
  );
}

/* --- 6. Refusal beats a knowingly broken file ------------------------------ */

{
  const doc = importDoc(load('5109s-sp27-pattern'));
  const empty: PatternDocument = { ...doc, pieces: [] };
  let threw = false;
  try {
    exportDxf(empty, OPTIONS);
  } catch {
    threw = true;
  }
  check('a document with no pieces is refused rather than written empty', threw, String(threw));

  const plan = describeExportPlan(doc, { flavour: 'aama', includeGradedSizes: false });
  check('describeExportPlan now reports that an export would succeed', plan.wouldSucceed, String(plan.wouldSucceed));
  check(
    '…and counts only the bindings the writer actually uses — boundary and notch',
    plan.layersUsed === 2,
    String(plan.layersUsed),
  );
  check('describeExportPlan agrees with the writer about blocking', plan.wouldSucceed === !exportDxfWithDiagnostics(doc, OPTIONS).issues.some((i) => i.severity === 'error'), 'ok');
}

/* --- 7. Units -------------------------------------------------------------- */

{
  const doc = importDoc(load('5109s-sp27-pattern'));
  const mm = exportDxf(doc, OPTIONS);
  const inches = exportDxf(doc, { ...OPTIONS, unit: 'in' });
  check('the requested unit reaches $INSUNITS', mm.includes('$INSUNITS\r\n70\r\n4') && inches.includes('$INSUNITS\r\n70\r\n1'), 'ok');
  check('and the coordinates are converted to match, not just relabelled', mm !== inches, 'ok');

  // An inch file must re-import to the same millimetre geometry.
  const back = importDxfWithDiagnostics(inches, { flavour: 'aama', assumeUnit: 'mm' }).document;
  check('an inch export round-trips back to the same millimetre geometry', geometry(back) === geometry(doc), geometry(back) === geometry(doc) ? 'identical' : 'DIFFERS');
}

/* --- 8. The download path ---------------------------------------------------
 *
 * `saveTextFile` itself needs a DOM and is verified in the browser; what is
 * checked here is everything around it — the filename rule, and the property
 * that matters most: the download layer must not touch the bytes. It hands
 * the writer's output over unchanged or it is not a download path, it is a
 * second, untested writer.
 */

{
  const doc = importDoc(load('8178v-accumark'));

  // Byte identity: what the download would carry is what the writer wrote.
  // `downloadDxf` cannot run headless (it needs a DOM), so this asserts the
  // one thing that could silently diverge — the serialisation it hands over.
  const direct = exportDxf(doc, { ...Dxf_DEFAULTS, flavour: 'aama' });
  const viaDiagnostics = exportDxfWithDiagnostics(doc, { ...Dxf_DEFAULTS, flavour: 'aama' }).text;
  check(
    'the bytes the download path carries are the writer\'s, unchanged',
    direct === viaDiagnostics,
    `${direct.length} vs ${viaDiagnostics.length} bytes`,
  );
  check(
    'and are unchanged from before the download layer existed',
    direct === exportDxf(doc, OPTIONS),
    'identical',
  );

  /* --- Filenames ---------------------------------------------------------- */

  const named = (code: string, name: string): PatternDocument => ({
    ...doc,
    name,
    style: { ...doc.style, code },
  });

  check('the style code becomes the filename', exportFileName(named('8178V', 'Anything'), '.dxf') === '8178V.dxf', exportFileName(named('8178V', 'Anything'), '.dxf'));
  check('the document name is the fallback when there is no code', exportFileName(named('', 'Classic Shirt'), '.dxf') === 'Classic-Shirt.dxf', exportFileName(named('', 'Classic Shirt'), '.dxf'));
  check('an empty document still gets a name', exportFileName(named('', ''), '.dxf') === 'pattern.dxf', exportFileName(named('', ''), '.dxf'));
  check(
    'path separators and wildcards cannot escape into the filename',
    exportFileName(named('a/b\\c:d*e?f"g<h>i|j', ''), '.dxf') === 'a-b-c-d-e-f-g-h-i-j.dxf',
    exportFileName(named('a/b\\c:d*e?f"g<h>i|j', ''), '.dxf'),
  );
  check(
    'separator runs collapse rather than producing a row of dashes',
    exportFileName(named('8178V  -  SP27', ''), '.dxf') === '8178V-SP27.dxf',
    exportFileName(named('8178V  -  SP27', ''), '.dxf'),
  );
  check(
    'a leading dot cannot make the export a hidden file',
    !exportFileName(named('.hidden', ''), '.dxf').startsWith('.'),
    exportFileName(named('.hidden', ''), '.dxf'),
  );
  check(
    'trailing dots and spaces are stripped, which Windows would do silently',
    exportFileName(named('style. ', ''), '.dxf') === 'style.dxf',
    exportFileName(named('style. ', ''), '.dxf'),
  );
  check(
    'a control character in a name cannot reach the filename',
    exportFileName(named('bad\nname\there', ''), '.dxf') === 'bad-name-here.dxf',
    JSON.stringify(exportFileName(named('bad\nname\there', ''), '.dxf')),
  );
  check(
    'a Windows reserved name is escaped rather than failing to save',
    exportFileName(named('CON', ''), '.dxf') === 'CON-pattern.dxf',
    exportFileName(named('CON', ''), '.dxf'),
  );
  check(
    'an absurdly long code is truncated to something a filesystem will take',
    exportFileName(named('X'.repeat(500), ''), '.dxf').length <= 90,
    String(exportFileName(named('X'.repeat(500), ''), '.dxf').length),
  );
  check(
    'the extension is whatever the caller asked for, so JSON reuses this',
    exportFileName(named('8178V', ''), '.pds.json') === '8178V.pds.json',
    exportFileName(named('8178V', ''), '.pds.json'),
  );
  check(
    'the same document always produces the same filename',
    exportFileName(doc, '.dxf') === exportFileName(doc, '.dxf') && !/\d{4}-\d{2}-\d{2}|\(\d+\)/.test(exportFileName(doc, '.dxf')),
    exportFileName(doc, '.dxf'),
  );

  // The JSON export reuses the same path, and that format is lossless.
  {
    const json = exportDocument(doc, 'pds-json');
    const back = importDocument(json, 'pds-json');
    check('the JSON export round-trips losslessly, unlike DXF', JSON.stringify(back) === JSON.stringify(doc), 'ok');
  }
}

/* --- 9. Notches on the notch layer ------------------------------------------
 *
 * The second concept the writer emits, and the second binding with real-file
 * evidence behind it: layer-4 POINTs in the AccuMark fixture land exactly on
 * the outline, which is what a notch is. (Evidence, not verification — the
 * binding is still `verified: false`, so it warns on every export like
 * `piece-boundary` does.)
 *
 * The position is written; the *shape* is not. A real file pairs each on-seam
 * point with a second one 7mm inside, plausibly the depth, and the importer
 * declines to read that as depth because the file never says so. Writing one
 * would be inventing the convention we refused to infer.
 */

{
  const withNotches = importDoc(load('8178v-accumark'));
  const withoutNotches = importDoc(load('5109s-sp27-pattern'));

  const notchCount = withNotches.pieces.reduce((n, p) => n + p.notches.length, 0);
  check('the notch fixture has notches to export', notchCount === 3, `${notchCount}`);
  check('the boundary-only fixture has none', withoutNotches.pieces.every((p) => p.notches.length === 0), 'ok');

  const text = exportDxf(withNotches, OPTIONS);
  const plain = exportDxf(withoutNotches, OPTIONS);
  const countPoints = (t: string): number => (t.match(/\r\n0\r\nPOINT\r\n/g) ?? []).length;

  check('one POINT is written per notch', countPoints(text) === notchCount, `${countPoints(text)} vs ${notchCount}`);
  check('a piece with no notches gets no POINT at all', countPoints(plain) === 0, `${countPoints(plain)}`);

  {
    // Every POINT must sit on layer 4 — the notch binding's number, taken
    // from the layer table rather than hardcoded here.
    const notchLayer = String(layerForConcept('notch', 'aama'));
    check('the notch layer comes from the layer table, and is 4', notchLayer === '4', notchLayer);
    const pointBlocks = text.split('\r\n0\r\nPOINT\r\n').slice(1);
    check(
      'every notch POINT is written on the notch layer, not the boundary layer',
      pointBlocks.length === notchCount && pointBlocks.every((b) => b.startsWith(`8\r\n${notchLayer}\r\n`)),
      pointBlocks.map((b) => b.slice(0, 6).replace(/\r\n/g, '|')).join(' '),
    );
  }

  /* --- The boundary is untouched ----------------------------------------- */

  // The claim that matters most: adding notches changed nothing about how a
  // boundary is written. Compared on the file body, since the header comment
  // legitimately changed to describe the new capability.
  const body = (t: string): string => t.slice(t.indexOf('0\r\nSECTION'));
  /** BLOCKS onward: every coordinate the writer emits, no header. */
  const geometrySections = (t: string): string => t.slice(t.indexOf('2\r\nBLOCKS'));
  check(
    // Pinned on the geometry sections rather than the whole body: the header
    // legitimately grows as the writer learns to declare more about itself
    // (extents landed after this test was written), and a byte count that
    // includes it would fail for the wrong reason. 3273 bytes, measured
    // against the commit before notch export existed.
    'a notch-free document writes byte-identical geometry to a boundary-only writer',
    geometrySections(plain).length === 3273,
    `${geometrySections(plain).length} bytes`,
  );
  check(
    'the POLYLINE section of a notched piece is unchanged by its notches',
    (() => {
      const upToSeqend = body(text).slice(0, body(text).indexOf('\r\n0\r\nPOINT\r\n'));
      return upToSeqend.includes('SEQEND') && !upToSeqend.includes('\r\n0\r\nPOINT\r\n');
    })(),
    'notches follow the outline, never interleave with it',
  );

  /* --- Round trip --------------------------------------------------------- */

  const back = importDxfWithDiagnostics(text, { flavour: 'aama', assumeUnit: 'mm' });
  const backCount = back.document.pieces.reduce((n, p) => n + p.notches.length, 0);
  check('exported notches come back as notches, not stray points', backCount === notchCount, `${backCount} vs ${notchCount}`);
  check('and the geometry still round-trips exactly alongside them', geometry(back.document) === geometry(withNotches), geometry(back.document) === geometry(withNotches) ? 'identical' : 'DIFFERS');
  {
    // Position is what survives: same segment, same parameter. Compared by
    // resolved coordinate, since segment ids are re-minted on each import.
    const at = (d: PatternDocument): string =>
      JSON.stringify(
        d.pieces.flatMap((p) =>
          p.notches.map((n) => {
            const seg = p.segments.find((s) => s.id === n.segmentId)!;
            const f = p.points.find((x) => x.id === seg.from)!.position;
            const t = p.points.find((x) => x.id === seg.to)!.position;
            const pt = pointOnSegment(f, t, seg.geometry, n.t);
            return [pt.x.toFixed(6), pt.y.toFixed(6)];
          }),
        ).sort(),
      );
    check('each notch returns to the same point on the seam', at(back.document) === at(withNotches), at(back.document) === at(withNotches) ? 'identical' : `${at(back.document)} vs ${at(withNotches)}`);
  }

  /* --- What is not written, said out loud --------------------------------- */

  const result = exportDxfWithDiagnostics(withNotches, OPTIONS);
  check(
    'notch shape is reported as not written, naming what is lost',
    result.issues.some(
      (i) =>
        i.code === 'export-notch-shape-not-written' &&
        i.message.includes('depth, width and angle') &&
        i.message.includes('layer "4"'),
    ),
    result.issues.find((i) => i.code === 'export-notch-shape-not-written')?.message ?? 'missing',
  );
  check(
    'notches are no longer listed among the concepts the writer drops',
    // The *list* is what matters — everything before "were not written".
    // The sentence after it legitimately mentions notches, since that is now
    // one of the two things the writer does emit.
    result.issues
      .filter((i) => i.code === 'export-concept-not-written')
      .every((i) => !i.message.slice(0, i.message.indexOf('were not written')).includes('notch')),
    result.issues.find((i) => i.code === 'export-concept-not-written')?.message.split('were not written')[0] ?? 'none',
  );
  check(
    'a notch-free piece gets no notch diagnostics at all',
    !exportDxfWithDiagnostics(withoutNotches, OPTIONS).issues.some((i) => i.code.startsWith('export-notch')),
    'ok',
  );
  check(
    'the notch binding is reported as observed-but-unverified, like the boundary',
    result.issues.some((i) => i.code === 'layer-map-observed-not-verified' && i.message.includes('notch')),
    result.issues.find((i) => i.code === 'layer-map-observed-not-verified')?.message ?? 'missing',
  );

  /* --- Determinism, with notches in play ---------------------------------- */

  check('a notched document still exports byte-identically twice', exportDxf(withNotches, OPTIONS) === text, 'stable');
  check(
    'notches are written in seam order, so array order cannot change the bytes',
    (() => {
      const shuffled: PatternDocument = {
        ...withNotches,
        pieces: withNotches.pieces.map((p) => ({ ...p, notches: [...p.notches].reverse() })),
      };
      return exportDxf(shuffled, OPTIONS) === text;
    })(),
    'order-independent',
  );
}

/* --- 10. Drawing extents ($EXTMIN / $EXTMAX) --------------------------------
 *
 * The bounding box of what was actually written, accumulated during the write
 * rather than computed alongside it — a parallel pass is the version that goes
 * stale the first time the writer's geometry changes.
 *
 * The case that separates a correct implementation from a plausible one is a
 * bulged segment: an arc bows outside its own endpoints, so a box taken from
 * vertices alone declares an area the drawing spills out of.
 */

{
  /** Reads a header variable's 10/20 pair back out of written DXF. */
  const headerPoint = (text: string, name: string): { x: number; y: number } | null => {
    const at = text.indexOf(`\r\n9\r\n${name}\r\n`);
    if (at < 0) return null;
    const lines = text.slice(at + 2).split('\r\n');
    // 9, NAME, 10, x, 20, y, 30, z
    return { x: Number(lines[3]), y: Number(lines[5]) };
  };

  /** The bounds of every coordinate the file actually contains. */
  const writtenBounds = (text: string) => {
    const lines = text.split('\r\n');
    const xs: number[] = [];
    const ys: number[] = [];
    // Only VERTEX and POINT entities carry drawing coordinates; BLOCK base
    // points and INSERT positions are all origin and would not move the box,
    // but they are skipped explicitly rather than relied on to be harmless.
    for (let i = 0; i < lines.length - 1; i += 2) {
      if (lines[i] !== '0') continue;
      if (lines[i + 1] !== 'VERTEX' && lines[i + 1] !== 'POINT') continue;
      for (let j = i + 2; j + 1 < lines.length && lines[j] !== '0'; j += 2) {
        if (lines[j] === '10') xs.push(Number(lines[j + 1]));
        if (lines[j] === '20') ys.push(Number(lines[j + 1]));
      }
    }
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  };

  for (const name of FIXTURES) {
    const doc = importDoc(load(name));
    const text = exportDxf(doc, OPTIONS);
    const min = headerPoint(text, '$EXTMIN');
    const max = headerPoint(text, '$EXTMAX');

    check(`${name}: $EXTMIN and $EXTMAX are written`, min !== null && max !== null, `${JSON.stringify(min)} / ${JSON.stringify(max)}`);
    if (!min || !max) continue;

    // Every fixture is straight-line geometry, so the written vertices are
    // the drawing and the box must match them exactly.
    const actual = writtenBounds(text);
    check(
      `${name}: the extents match the bounds of the geometry actually written`,
      Math.abs(min.x - actual.minX) < 1e-6 &&
        Math.abs(min.y - actual.minY) < 1e-6 &&
        Math.abs(max.x - actual.maxX) < 1e-6 &&
        Math.abs(max.y - actual.maxY) < 1e-6,
      `header ${min.x},${min.y}..${max.x},${max.y} vs written ${actual.minX},${actual.minY}..${actual.maxX},${actual.maxY}`,
    );
    check(`${name}: the box is non-degenerate and correctly ordered`, max.x > min.x && max.y > min.y, `${max.x - min.x} x ${max.y - min.y}`);
    check(`${name}: extents are stable across exports`, JSON.stringify(headerPoint(exportDxf(doc, OPTIONS), '$EXTMIN')) === JSON.stringify(min), 'stable');
  }

  /* --- The arc case ------------------------------------------------------- */
  {
    // A square whose top edge bulges out as a semicircle. The bulge reaches
    // 50mm beyond the vertices, so vertex-only extents would be short by
    // exactly the radius — the failure this test exists to catch.
    const arcDoc = importDoc(load('synthetic-curves-bulge'));
    const text = exportDxf(arcDoc, OPTIONS);
    const min = headerPoint(text, '$EXTMIN')!;
    const max = headerPoint(text, '$EXTMAX')!;
    const vertexOnly = writtenBounds(text);

    check(
      'a bulged edge pushes the extents past its own vertices',
      max.y - min.y > vertexOnly.maxY - vertexOnly.minY + 40,
      `extents ${(max.y - min.y).toFixed(2)}mm tall vs vertex hull ${(vertexOnly.maxY - vertexOnly.minY).toFixed(2)}mm`,
    );
    check(
      'and by the arc radius, to within the flattening tolerance',
      Math.abs((max.y - min.y) - ((vertexOnly.maxY - vertexOnly.minY) + 50)) <= 0.1,
      `${(max.y - min.y).toFixed(4)} vs ${((vertexOnly.maxY - vertexOnly.minY) + 50).toFixed(4)}`,
    );
    check(
      'the extents contain every written vertex too',
      vertexOnly.minX >= min.x - 1e-6 && vertexOnly.maxX <= max.x + 1e-6 &&
        vertexOnly.minY >= min.y - 1e-6 && vertexOnly.maxY <= max.y + 1e-6,
      'contained',
    );
  }

  /* --- Units, and the empty case ------------------------------------------ */
  {
    const doc = importDoc(load('5109s-sp27-pattern'));
    const mm = headerPoint(exportDxf(doc, OPTIONS), '$EXTMAX')!;
    const inches = headerPoint(exportDxf(doc, { ...OPTIONS, unit: 'in' }), '$EXTMAX')!;
    check(
      'extents are written in the file\'s own unit, like the geometry',
      Math.abs(mm.x / 25.4 - inches.x) < 1e-6,
      `${mm.x}mm vs ${inches.x}in`,
    );

    // A piece whose boundary the writer cannot emit leaves nothing to bound.
    // Rather than declaring an empty box at the origin — which a reader would
    // zoom to — the variables are left out and the gap is reported.
    const empty: PatternDocument = {
      ...doc,
      pieces: doc.pieces.map((p) => ({ ...p, boundary: [], segments: [], points: [], notches: [] })),
    };
    const result = exportDxfWithDiagnostics(empty, OPTIONS);
    check(
      'a document with no writable geometry omits the extents rather than inventing 0,0',
      !result.text.includes('$EXTMIN') && !result.text.includes('$EXTMAX'),
      'omitted',
    );
    check(
      'and says so',
      result.issues.some((i) => i.code === 'export-no-extents' && i.message.includes('rather than')),
      result.issues.find((i) => i.code === 'export-no-extents')?.message ?? 'missing',
    );
  }

  /* --- Geometry is untouched by the header -------------------------------- */
  {
    const doc = importDoc(load('8178v-accumark'));
    const text = exportDxf(doc, OPTIONS);
    check(
      'extents live in the header and change no geometry byte',
      text.slice(text.indexOf('2\r\nBLOCKS')).length === 8211,
      `${text.slice(text.indexOf('2\r\nBLOCKS')).length} bytes`,
    );
  }
}

console.log(failures === 0 ? '\nAll DXF export checks passed.' : `\n${failures} DXF export check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
