import type { GradeRuleId, SizeId } from './ids';

/**
 * Grading: how the base pattern becomes a size range.
 *
 * The model separates three things deliberately — the size range (what sizes
 * exist), the grade rules (named sets of per-size deltas), and the association
 * of a rule to a point (`PiecePoint.gradeRuleId`). One rule is typically shared
 * by many points across many pieces, which is exactly how pattern makers work
 * and keeps a range edit to a single change.
 */

export interface SizeDefinition {
  readonly id: SizeId;
  /** What the pattern maker sees: 'S', '38', '32R'. */
  readonly label: string;
  /** Position in the range, ascending. */
  readonly order: number;
}

export interface SizeRange {
  readonly baseSizeId: SizeId;
  readonly sizes: readonly SizeDefinition[];
}

/**
 * Displacement applied at a graded point for one size, relative to the base
 * size. Base-size increments are zero by definition.
 */
export interface GradeIncrement {
  readonly sizeId: SizeId;
  readonly dx: number;
  readonly dy: number;
}

/** A named, reusable set of per-size displacements. */
export interface GradeRule {
  readonly id: GradeRuleId;
  /** Short code as used on the pattern, e.g. '1', '12A'. */
  readonly code: string;
  readonly label: string;
  readonly increments: readonly GradeIncrement[];
}

export const findIncrement = (
  rule: GradeRule,
  sizeId: SizeId,
): GradeIncrement | undefined => rule.increments.find((i) => i.sizeId === sizeId);
