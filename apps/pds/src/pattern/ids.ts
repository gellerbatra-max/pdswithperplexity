/**
 * Identifier aliases for the pattern document model.
 *
 * These are plain strings today. They are declared separately so that every
 * reference site is self-documenting, and so they can be tightened into branded
 * types later without touching call sites:
 *
 *   export type PointId = string & { readonly __brand: 'PointId' };
 *
 * Ids are opaque and stable for the life of an entity — never derive meaning
 * from their contents, and never reuse one after a delete.
 */

export type DocumentId = string;
export type PieceId = string;
export type PointId = string;
export type SegmentId = string;
export type GrainLineId = string;
export type NotchId = string;
export type InternalLineId = string;
export type MeasurementId = string;
export type GradeRuleId = string;
export type SizeId = string;
