import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseRuleTable } from '../src/io/dxf/ruleTable.ts';

/**
 * Regression suite for the ASTM companion grade rule table parser.
 *
 * Run it with:
 *
 *   npm run check:rul
 *
 * Deliberately separate from `check-dxf-import.ts`: the .RUL format is its own
 * thing, parsed by its own module with no DXF coupling, and it deserves to
 * fail on its own terms. The real fixture is `8178v-accumark.rul`, the
 * companion of the AccuMark DXF next to it — 41 rules over 8 sizes.
 *
 * The load-bearing check here is the **base-size column**. A grade rule is
 * displacement *relative to* the sample size, so the pair at the sample size's
 * position must be exactly zero. If it isn't, either the columns are
 * misaligned or the header names the wrong sample size — and grading from
 * either would displace every point of every piece, in every size, including
 * the one that was supposed to be the reference. It is the one property of
 * this file that cannot be allowed to fail quietly.
 */

let failures = 0;
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) failures += 1;
};

const FIXTURE = readFileSync(
  fileURLToPath(new URL('./fixtures/dxf/8178v-accumark.rul', import.meta.url)),
  'utf8',
);

const MM_PER_INCH = 25.4;
const EPS = 1e-9;

/* --- 1. The real table's header ------------------------------------------- */

const table = parseRuleTable(FIXTURE);

check('the size list is read in file order', table.sizeRange.sizes.map((s) => s.label).join(' ') === 'XS S M L XL XXL XXXL XXXXL', table.sizeRange.sizes.map((s) => s.label).join(' '));
check('sizes are ordered ascending from zero', table.sizeRange.sizes.every((s, i) => s.order === i), 'ok');
check(
  'the base size is the file\'s stated SAMPLE SIZE, not the first column',
  table.sizeRange.sizes.find((s) => s.id === table.sizeRange.baseSizeId)?.label === 'M',
  String(table.sizeRange.sizes.find((s) => s.id === table.sizeRange.baseSizeId)?.label),
);
check('every RULE: DELTA n block is read', table.rules.length === 41, `${table.rules.length}`);
check('rules are reachable by their number, for resolving the DXF\'s "# N"', table.byNumber.get(1)?.code === '1' && table.byNumber.get(41)?.code === '41', 'ok');
check('UNITS: ENGLISH is read as inches', table.unit === 'in', table.unit);
check('a well-formed table reports no errors or warnings', table.issues.every((i) => i.severity === 'info'), JSON.stringify(table.issues.filter((i) => i.severity !== 'info')));

/* --- 2. THE base-size column ---------------------------------------------
 *
 * The reason this suite exists. Checked two ways: that the parser produced
 * zero at the base for every rule, and — independently — that the fixture's
 * own third column really is zero, so a parser bug that zeroed the wrong
 * column could not make the first check pass.
 */

{
  const baseId = table.sizeRange.baseSizeId;
  const nonZero = table.rules.filter((rule) => {
    const atBase = rule.increments.find((i) => i.sizeId === baseId);
    return !atBase || Math.abs(atBase.dx) > EPS || Math.abs(atBase.dy) > EPS;
  });
  check('every rule is exactly zero at the base size', nonZero.length === 0, `${nonZero.length} non-zero: ${nonZero.map((r) => r.code).join(', ')}`);

  // Independent re-read of the raw text: the sample size M is the 3rd of 8
  // labels, so the 5th and 6th numbers of each rule body are its base pair.
  const bodies = FIXTURE.split(/RULE: DELTA \d+/).slice(1);
  const rawBasePairs = bodies.map((body) => {
    const numbers = (body.match(/-?\d+\.\d+/g) ?? []).slice(0, 16);
    return [numbers[4], numbers[5]];
  });
  check(
    'the fixture itself is zero in the sample-size column (checked without the parser)',
    rawBasePairs.length === 41 && rawBasePairs.every(([dx, dy]) => Number(dx) === 0 && Number(dy) === 0),
    `${rawBasePairs.filter(([dx, dy]) => Number(dx) !== 0 || Number(dy) !== 0).length} non-zero of ${rawBasePairs.length}`,
  );
}

/* --- 3. A non-zero base column is an error, not a silent import ----------- */

{
  // Same table, with rule 2's base pair nudged off zero. Built by rewriting
  // the third pair of DELTA 2's first body line rather than by matching a
  // literal — the fixture is CRLF and column-aligned, and a hardcoded string
  // would silently stop matching the day either changes, quietly turning this
  // section into a test of nothing. The assertion below is that guard.
  const broken = FIXTURE.replace(
    /(RULE: DELTA 2\r?\n)((?:\s*-?\d+\.\d+,\s*-?\d+\.\d+){2})(\s*)0\.0000,(\s*)0\.0000/,
    (_all, header: string, firstTwo: string, gapA: string, gapB: string) =>
      `${header}${firstTwo}${gapA}0.5000,${gapB}-0.2500`,
  );
  check('the fixture text was actually modified for this test', broken !== FIXTURE, 'ok');

  const result = parseRuleTable(broken);
  const error = result.issues.find((i) => i.code === 'rule-table-base-not-zero');
  check('a non-zero base column is reported as an error', error?.severity === 'error', String(error?.severity));
  check('the error names the offending rule', error?.message.includes('Rule(s) 2') === true, error?.message ?? 'missing');
  check(
    'the error explains why a non-zero base is fatal rather than cosmetic',
    error?.message.includes('relative to the base size') === true,
    'ok',
  );
}

/* --- 4. Increments convert to millimetres --------------------------------- */

{
  // RULE: DELTA 1's first pair, straight from the fixture text.
  const rule1 = table.byNumber.get(1)!;
  const xs = rule1.increments[0]!;
  check(
    'increments are converted from the table\'s own unit to millimetres',
    Math.abs(xs.dx - 0.1817 * MM_PER_INCH) < 1e-9 && Math.abs(xs.dy - 0.013 * MM_PER_INCH) < 1e-9,
    `${xs.dx} / ${xs.dy}`,
  );
  check('every rule carries exactly one increment per size', table.rules.every((r) => r.increments.length === 8), 'ok');
  check(
    'increment size ids are the size range\'s own ids, not re-minted per rule',
    table.rules.every((r) => r.increments.every((inc, i) => inc.sizeId === table.sizeRange.sizes[i]!.id)),
    'ok',
  );
}

/* --- 5. Malformed tables fail loudly, without throwing -------------------- */

{
  const noHeader = parseRuleTable('RULE: DELTA 1\n  0.1, 0.2\nEND\n');
  check('a table with no SIZE LIST reports an error rather than throwing', noHeader.issues.some((i) => i.code === 'rule-table-header-missing' && i.severity === 'error'), 'ok');
  check('a table with no SIZE LIST yields no rules', noHeader.rules.length === 0, `${noHeader.rules.length}`);

  const shortRow = parseRuleTable(
    'UNITS: METRIC\nNUMBER OF SIZES: 3\nSIZE LIST: S M L\nSAMPLE SIZE: M\nRULE: DELTA 1\n  1.0, 1.0   0.0, 0.0\nEND\n',
  );
  check(
    'a rule with the wrong number of columns is dropped, not padded',
    shortRow.rules.length === 0 && shortRow.issues.some((i) => i.code === 'rule-table-wrong-column-count' && i.severity === 'error'),
    `${shortRow.rules.length} rule(s)`,
  );

  const badSample = parseRuleTable('UNITS: METRIC\nSIZE LIST: S M L\nSAMPLE SIZE: XL\nRULE: DELTA 1\n 0,0 0,0 0,0\nEND\n');
  check('a sample size absent from the size list is an error', badSample.issues.some((i) => i.code === 'rule-table-sample-size-missing' && i.severity === 'error'), 'ok');

  const countMismatch = parseRuleTable('UNITS: METRIC\nNUMBER OF SIZES: 5\nSIZE LIST: S M L\nSAMPLE SIZE: M\nRULE: DELTA 1\n 0,0 0,0 0,0\nEND\n');
  check('a NUMBER OF SIZES that disagrees with the list is reported', countMismatch.issues.some((i) => i.code === 'rule-table-size-count-mismatch'), 'ok');
  check('…and the list wins, because it is the one that names the columns', countMismatch.sizeRange.sizes.length === 3, `${countMismatch.sizeRange.sizes.length}`);

  const unknownUnit = parseRuleTable('UNITS: FURLONGS\nSIZE LIST: S M\nSAMPLE SIZE: S\nRULE: DELTA 1\n 0,0 1,1\nEND\n');
  check('an unrecognised UNITS value is warned about rather than assumed silently', unknownUnit.issues.some((i) => i.code === 'rule-table-unit-unknown' && i.severity === 'warning'), 'ok');
}

/* --- 6. Determinism -------------------------------------------------------- */

{
  const shape = (t: ReturnType<typeof parseRuleTable>): string =>
    JSON.stringify({
      sizes: t.sizeRange.sizes.map((s) => [s.label, s.order]),
      base: t.sizeRange.sizes.find((s) => s.id === t.sizeRange.baseSizeId)?.label,
      rules: t.rules.map((r) => [r.code, r.increments.map((i) => [i.dx, i.dy])]),
    });
  check('re-parsing the same table gives the same result (ids aside)', shape(parseRuleTable(FIXTURE)) === shape(table), 'ok');
}

console.log(failures === 0 ? '\nAll rule-table checks passed.' : `\n${failures} rule-table check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
