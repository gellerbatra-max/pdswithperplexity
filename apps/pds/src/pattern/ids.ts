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

/**
 * Monotonic counter behind `createId`. Process-local: ids only need to be
 * unique within one document, and a document that outlives the process is
 * re-read from JSON with its ids already baked in.
 */
let idCounter = 0;

/**
 * Mints a fresh, opaque id. The prefix is a readability affordance for anyone
 * reading a JSON dump — nothing parses it, per the rule above.
 *
 * Deliberately not a UUID: these ids are written to every point and segment of
 * every piece, and the seed document's own ids (`piece-sleeve-p1`) are already
 * short. A counter keeps exported JSON legible and diffable.
 */
export const createId = (prefix: string): string => {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(36)}-${Date.now().toString(36)}`;
};
