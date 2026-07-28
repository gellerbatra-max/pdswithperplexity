import { toMillimetres, type Unit } from '@/geometry';
import { createId, type GradeIncrement, type GradeRule, type SizeRange } from '@/pattern';
import type { ConversionIssue } from './types';

/**
 * The ASTM companion grade rule table (`.RUL`).
 *
 * An AccuMark style ships as a *pair*: the DXF carries geometry and, at each
 * graded point, a `# N` text; this file carries what `N` means. Neither half
 * grades anything alone — the DXF names rules it does not define, and this
 * file defines rules it does not place. That is why this parser is its own
 * module with no DXF dependency: it reads a rule table, and `import.ts`
 * decides whether one is present to read.
 *
 * The format is plain text, and self-describing enough to parse without
 * guessing:
 *
 *     ASTM/D13Proposal 1 Version: D 6673-04
 *     UNITS: ENGLISH
 *     NUMBER OF SIZES: 8
 *     SIZE LIST:  XS S M L XL XXL XXXL XXXXL
 *     SAMPLE SIZE: M
 *     RULE: DELTA 1
 *         0.1817,   0.0130    0.0905,   0.0031    0.0000,   0.0000  ...
 *        -0.1802,  -0.0071   -0.2700,  -0.0112   ...
 *     END
 *
 * Each rule holds one `dx, dy` pair per size, in `SIZE LIST` order, wrapped
 * across as many lines as it takes. The pair at the sample size's position is
 * the base and must be zero — a rule is displacement *relative to* the base
 * size, so a non-zero there means either the file disagrees with its own
 * `SAMPLE SIZE` header or the columns are misaligned. Both are worth refusing
 * to import silently, so `parseRuleTable` checks it and says which rules fail.
 */

/** What one parsed rule table amounts to, in this app's own model. */
export interface ParsedRuleTable {
  readonly sizeRange: SizeRange;
  readonly rules: readonly GradeRule[];
  /** `RULE: DELTA 7` → the rule with code '7', for resolving the DXF's `# 7`. */
  readonly byNumber: ReadonlyMap<number, GradeRule>;
  /** The file's own `UNITS:` value, and what it converts to. */
  readonly unit: Unit;
  readonly issues: readonly ConversionIssue[];
}

/** `UNITS:` values seen in real tables. ENGLISH is AccuMark's word for inches. */
const UNIT_WORDS: Record<string, Unit> = {
  ENGLISH: 'in',
  IMPERIAL: 'in',
  METRIC: 'mm',
};

/** How far from zero a base-size increment may be before it is a real problem. */
const BASE_ZERO_TOLERANCE = 1e-9;

const headerValue = (lines: readonly string[], key: string): string | undefined => {
  const prefix = `${key.toLowerCase()}:`;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith(prefix)) return trimmed.slice(prefix.length).trim();
  }
  return undefined;
};

/**
 * Parses a `.RUL` payload into the app's grading model.
 *
 * Throws nothing: a table this cannot read comes back with empty rules and
 * issues explaining why, so a caller importing a DXF/RUL pair can still
 * import the geometry and report the grading separately.
 */
export const parseRuleTable = (payload: string): ParsedRuleTable => {
  const issues: ConversionIssue[] = [];
  const lines = payload.split(/\r\n|\r|\n/);

  const unitWord = (headerValue(lines, 'UNITS') ?? '').toUpperCase();
  const unit = UNIT_WORDS[unitWord];
  if (unit === undefined) {
    issues.push({
      severity: 'warning',
      code: 'rule-table-unit-unknown',
      message: `The rule table's "UNITS: ${unitWord || '(absent)'}" is not a value this parser recognises; its increments were read as millimetres, which is a guess.`,
    });
  }
  const resolvedUnit: Unit = unit ?? 'mm';

  const sizeListRaw = headerValue(lines, 'SIZE LIST');
  const sampleSize = headerValue(lines, 'SAMPLE SIZE');
  const declaredCount = Number(headerValue(lines, 'NUMBER OF SIZES') ?? NaN);

  if (sizeListRaw === undefined || sampleSize === undefined) {
    issues.push({
      severity: 'error',
      code: 'rule-table-header-missing',
      message: `The rule table has no ${sizeListRaw === undefined ? '"SIZE LIST"' : '"SAMPLE SIZE"'} header; without it there is no way to say which column is which size.`,
    });
    return {
      sizeRange: { baseSizeId: createId('size'), sizes: [] },
      rules: [],
      byNumber: new Map(),
      unit: resolvedUnit,
      issues,
    };
  }

  const labels = sizeListRaw.split(/\s+/).filter((s) => s.length > 0);
  if (Number.isFinite(declaredCount) && declaredCount !== labels.length) {
    issues.push({
      severity: 'warning',
      code: 'rule-table-size-count-mismatch',
      message: `The rule table says "NUMBER OF SIZES: ${declaredCount}" but lists ${labels.length} size(s); the list was used.`,
    });
  }

  const sizes = labels.map((label, order) => ({ id: createId('size'), label, order }));
  const baseIndex = labels.indexOf(sampleSize);
  if (baseIndex === -1) {
    issues.push({
      severity: 'error',
      code: 'rule-table-sample-size-missing',
      message: `The rule table's sample size "${sampleSize}" is not in its own size list (${labels.join(', ')}); the base size cannot be identified.`,
    });
  }
  const base = sizes[baseIndex] ?? sizes[0];

  /* --- Rules ------------------------------------------------------------- */

  const rules: GradeRule[] = [];
  const byNumber = new Map<number, GradeRule>();
  const nonZeroBase: string[] = [];
  const wrongLength: string[] = [];

  let current: { number: number; code: string; values: number[] } | null = null;

  const finish = (): void => {
    if (!current) return;
    const { number, code, values } = current;
    current = null;

    if (values.length !== labels.length * 2) {
      wrongLength.push(code);
      return;
    }

    const increments: GradeIncrement[] = sizes.map((size, i) => ({
      sizeId: size.id,
      // The table's numbers are in its own unit; the model is millimetres
      // throughout, so they convert here rather than at every read site.
      dx: toMillimetres(values[i * 2]!, resolvedUnit),
      dy: toMillimetres(values[i * 2 + 1]!, resolvedUnit),
    }));

    if (baseIndex >= 0) {
      const atBase = increments[baseIndex]!;
      if (Math.abs(atBase.dx) > BASE_ZERO_TOLERANCE || Math.abs(atBase.dy) > BASE_ZERO_TOLERANCE) {
        nonZeroBase.push(code);
      }
    }

    const rule: GradeRule = {
      id: createId('gr-rul'),
      code,
      label: `DELTA ${code}`,
      increments,
    };
    rules.push(rule);
    byNumber.set(number, rule);
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    const ruleHeader = /^RULE:\s*DELTA\s+(\d+)\s*$/i.exec(trimmed);
    if (ruleHeader) {
      finish();
      const number = Number(ruleHeader[1]);
      current = { number, code: String(number), values: [] };
      continue;
    }

    if (/^END\s*$/i.test(trimmed)) {
      finish();
      continue;
    }

    if (current) {
      // A rule body line is nothing but numbers; anything else ends the rule
      // rather than being absorbed into it, so a stray header cannot silently
      // become an increment.
      const numbers = trimmed.match(/-?\d+(?:\.\d+)?/g);
      if (!numbers || !/^[-\d.,\s]+$/.test(trimmed)) {
        finish();
        continue;
      }
      current.values.push(...numbers.map(Number));
    }
  }
  finish();

  if (wrongLength.length > 0) {
    issues.push({
      severity: 'error',
      code: 'rule-table-wrong-column-count',
      message: `Rule(s) ${wrongLength.join(', ')} do not carry exactly ${labels.length} dx/dy pairs, one per size; they were dropped rather than aligned by guesswork.`,
    });
  }
  if (nonZeroBase.length > 0) {
    issues.push({
      severity: 'error',
      code: 'rule-table-base-not-zero',
      message: `Rule(s) ${nonZeroBase.join(', ')} are non-zero at the sample size "${sampleSize}". A grade rule is displacement relative to the base size, so the base column must be zero — a non-zero one means the columns are misaligned or the header names the wrong sample size, and grading from it would move every piece.`,
    });
  }
  if (rules.length > 0) {
    issues.push({
      severity: 'info',
      code: 'rule-table-read',
      message: `Read ${rules.length} grade rule(s) over ${labels.length} sizes (${labels.join(', ')}), base "${sampleSize}", from the companion rule table.`,
    });
  }

  return {
    sizeRange: { baseSizeId: base?.id ?? createId('size'), sizes },
    rules,
    byNumber,
    unit: resolvedUnit,
    issues,
  };
};
