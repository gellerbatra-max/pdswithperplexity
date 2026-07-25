import type { Unit } from '@/geometry';
import type { DocumentId } from './ids';
import type { PatternPiece } from './piece';
import type { MeasurementLink } from './measurement';
import type { GradeRule, SizeRange } from './grading';

/** Style-level identity. Kept separate so a document can be re-styled or forked. */
export interface StyleInfo {
  readonly code: string;
  readonly name: string;
  readonly season?: string;
  readonly category?: string;
  readonly description?: string;
}

/**
 * The pattern document — the root aggregate everything else hangs off.
 *
 * Pieces, measurements and grade rules are held as sibling collections rather
 * than nested inside pieces, because measurements and grade rules routinely
 * span pieces. Everything cross-references by id.
 *
 * `schemaVersion` is written on every document so migrations have something to
 * branch on; bump it whenever a change is not backward compatible.
 */
export interface PatternDocument {
  readonly schemaVersion: number;
  readonly id: DocumentId;
  readonly name: string;
  readonly style: StyleInfo;
  /** Display unit. Stored geometry is always millimetres. */
  readonly unit: Unit;
  readonly sizeRange: SizeRange;
  readonly pieces: readonly PatternPiece[];
  readonly measurements: readonly MeasurementLink[];
  readonly gradeRules: readonly GradeRule[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export const PATTERN_SCHEMA_VERSION = 1;
