/**
 * AAMA/ASTM `.rul` grade-rule tables.
 *
 * A rule table maps a rule number to a per-size offset applied to every point
 * that carries that rule. There is no single published layout — writers differ
 * on delimiters and column order — so this is tolerant by design: it reads
 * whitespace- or comma-separated rows of `rule size dx dy`, skips anything it
 * cannot make sense of, and reports what it skipped.
 *
 * TODO(grading): nothing consumes these. MarkerDocument has no field for grade
 * rules, and adding one is a schema change nobody needs yet, so the importer
 * returns the table alongside the pieces and the caller discards it. Grading a
 * marker is a different feature from making one.
 *
 * Pure: text in, table out.
 */

export interface GradeOffset {
  readonly size: string;
  readonly dx: number;
  readonly dy: number;
}

export interface GradeRule {
  readonly rule: string;
  readonly offsets: GradeOffset[];
}

export interface RulTable {
  readonly rules: Map<string, GradeRule>;
  readonly warnings: string[];
}

const COMMENT = /^\s*(?:[;#*]|\/\/)/;

/**
 * Rows look like `12  M  0.5  -0.25`, sometimes comma-separated, sometimes
 * with a leading `RULE` keyword. Anything else is skipped.
 */
export const parseRul = (text: string): RulTable => {
  const rules = new Map<string, GradeRule>();
  const warnings: string[] = [];
  let skipped = 0;

  const lines = text.split(/\r\n|\r|\n/);

  for (const line of lines) {
    if (line.trim() === '' || COMMENT.test(line)) continue;

    const fields = line
      .trim()
      .replace(/^rule\b/i, '')
      .split(/[\s,]+/)
      .filter((field) => field !== '');

    if (fields.length < 4) {
      skipped += 1;
      continue;
    }

    const [rule, size, rawDx, rawDy] = fields;
    if (rule === undefined || size === undefined || rawDx === undefined || rawDy === undefined) {
      skipped += 1;
      continue;
    }

    const dx = Number.parseFloat(rawDx);
    const dy = Number.parseFloat(rawDy);
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
      skipped += 1;
      continue;
    }

    const existing = rules.get(rule);
    if (existing) existing.offsets.push({ size, dx, dy });
    else rules.set(rule, { rule, offsets: [{ size, dx, dy }] });
  }

  if (skipped > 0) {
    warnings.push(`Grade rules: skipped ${skipped} line(s) that did not parse as rule rows`);
  }
  if (rules.size === 0) {
    warnings.push('Grade rules: no usable rows found');
  }

  return { rules, warnings };
};
