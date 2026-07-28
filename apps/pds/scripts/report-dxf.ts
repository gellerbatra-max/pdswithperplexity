import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importDxfWithDiagnostics, TREATMENT_LABEL } from '../src/io/dxf/import.ts';
import { layerMapFor } from '../src/io/dxf/layerMapping.ts';
import { countBySeverity } from '../src/diagnostics.ts';

/**
 * The DXF support report: runs the real importer over every fixture in
 * `scripts/fixtures/dxf/` and prints what it did — per file and against the
 * layer table.
 *
 * Run it with:
 *
 *   npm run report:dxf
 *
 * This is a *report*, not a check. `check-dxf-import.ts` locks behaviour with
 * assertions; this makes the current truth readable — and diffable, since the
 * output is deterministic (no ids, no timestamps). Drop a new real file into
 * the fixtures directory and run this to see exactly what the importer makes
 * of it before writing a single assertion. If a fixture fails to parse, that
 * is reported too, and the report still exits 0: only an empty fixtures
 * directory is treated as a setup error.
 */

const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/dxf/', import.meta.url));

const files = readdirSync(FIXTURES_DIR)
  .filter((name) => name.toLowerCase().endsWith('.dxf'))
  .sort();

if (files.length === 0) {
  console.error(`No .dxf fixtures found in ${FIXTURES_DIR}`);
  process.exit(1);
}

const h = (text: string): void => {
  console.log(`\n${text}`);
  console.log('-'.repeat(text.length));
};

const pad = (text: string, width: number): string => text.padEnd(width);

for (const name of files) {
  const path = join(FIXTURES_DIR, name);
  const size = statSync(path).size;
  h(`${name} (${size} bytes)`);

  let result;
  try {
    result = importDxfWithDiagnostics(readFileSync(path, 'utf8'), { flavour: 'aama', assumeUnit: 'mm' });
  } catch (error) {
    console.log(`  FAILED TO PARSE: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }

  const { document, issues, layers } = result;
  const counts = countBySeverity(issues);
  const points = document.pieces.reduce((sum, piece) => sum + piece.points.length, 0);
  const curved = document.pieces.reduce(
    (sum, piece) => sum + piece.segments.filter((s) => s.geometry.kind !== 'line').length,
    0,
  );
  const internalLines = document.pieces.reduce((sum, piece) => sum + piece.internalLines.length, 0);
  const names = [...new Set(document.pieces.map((piece) => piece.name))];

  console.log(`  pieces: ${document.pieces.length} (${names.join(', ')})`);
  console.log(`  points: ${points}   internal lines: ${internalLines}   style: "${document.name}"`);
  const approximated = issues.filter((i) => i.code === 'curve-approximated').length;
  const exactCurves = issues.filter((i) => i.code === 'curve-preserved-exactly').length;
  console.log(
    `  curved segments: ${curved}` +
      (exactCurves > 0 ? `  (${exactCurves} piece(s) carry curves reconstructed exactly)` : '') +
      (approximated > 0 ? `  (${approximated} piece(s) had a curve chorded to tolerance)` : '') +
      (curved === 0 && approximated === 0 ? '  — every edge is straight, as every real vendor export on hand is' : ''),
  );
  console.log(`  issues: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} note(s)`);

  console.log('  layers:');
  for (const row of layers) {
    const agree =
      row.tableAgrees === null
        ? 'UNMAPPED'
        : row.tableAgrees
          ? `table agrees (${row.concept})`
          : `TABLE DISAGREES (says ${row.concept})`;
    console.log(
      `    ${pad(`layer ${row.layer}`, 10)} ${pad(`${row.entity}×${row.count}`, 14)} ${pad(TREATMENT_LABEL[row.treatment], 58)} ${agree}`,
    );
  }

  const warnings = issues.filter((issue) => issue.severity !== 'info');
  if (warnings.length > 0) {
    console.log('  non-info diagnostics:');
    // Codes only, deduplicated with counts: messages carry piece names and are
    // long; the codes are the stable vocabulary worth scanning here.
    const byCode = new Map<string, number>();
    for (const issue of warnings) byCode.set(`${issue.severity} ${issue.code}`, (byCode.get(`${issue.severity} ${issue.code}`) ?? 0) + 1);
    for (const [code, count] of [...byCode.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`    ${count}× ${code}`);
    }
  }
}

/* --- The layer table's evidence, concept by concept ------------------------ */

h('Layer table evidence (aama flavour)');
console.log(
  '  A binding is "verified" only against the ASTM D6673 text — none are. Everything\n' +
    '  else is fixture evidence: observed (a real file agrees), contradicted (a real\n' +
    '  file puts something else there), or untested (no real file uses the layer).',
);
console.log();
for (const binding of layerMapFor('aama')) {
  const observed = binding.observedInFixtures ?? [];
  const contradicted = binding.conflictingEvidence ?? [];
  const status = binding.verified
    ? 'VERIFIED'
    : contradicted.length > 0 && observed.length > 0
      ? 'observed AND contradicted'
      : contradicted.length > 0
        ? 'contradicted'
        : observed.length > 0
          ? 'observed'
          : 'untested';
  console.log(`  ${pad(`layer ${binding.layer}`, 10)} ${pad(binding.concept, 18)} ${pad(status, 26)} ${binding.entities.join('/')}`);
  for (const fixture of observed) console.log(`    ${' '.repeat(8)}agrees: ${fixture}`);
  for (const evidence of contradicted) console.log(`    ${' '.repeat(8)}against: ${evidence}`);
}

console.log('\nReport complete — this output is descriptive; check-dxf-import.ts is what enforces.');
