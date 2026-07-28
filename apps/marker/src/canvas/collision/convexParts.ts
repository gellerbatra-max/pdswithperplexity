/**
 * Convex parts for the SAT narrow phase.
 *
 * DXF import decomposes each piece once and carries the parts on the import
 * result, but a document loaded from disk, seeded, or built in a test has only
 * an outline. This fills that gap and memoises the answer, so a concave piece
 * is split once per outline rather than once per drag event.
 *
 * Keyed on the geometry array itself: the store replaces that array only when
 * the outline changes, which is exactly when the parts stop being valid.
 */

import { decompose } from '@/marker/convex';
import type { Point } from '@/marker/schema';

const cache = new WeakMap<readonly Point[], Point[][]>();

export const convexPartsOf = (geometry: readonly Point[]): Point[][] => {
  const cached = cache.get(geometry);
  if (cached) return cached;

  const { parts } = decompose(geometry);
  // A decomposition that failed falls back to the outline: collision stays
  // conservative rather than disappearing.
  const result = parts.length > 0 ? parts : [[...geometry]];
  cache.set(geometry, result);
  return result;
};
