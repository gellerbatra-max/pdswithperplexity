/**
 * Broad phase: axis-aligned rectangle overlap.
 *
 * Runs against every obstacle on every drag event, so it stays O(n) and cheap.
 * Anything it rejects never reaches the SAT narrow phase.
 *
 * Pure — no React, no Zustand, no side effects.
 */

import { BoundsOps, type Bounds } from '@repo/geometry';
import type { Point } from '@/marker/schema';

export type { Bounds };

export const boundsOf = (points: readonly Point[]): Bounds => BoundsOps.fromPoints(points);

/** Grow a box by the cutter buffer on all sides. */
export const expand = (bounds: Bounds, margin: number): Bounds =>
  BoundsOps.expand(bounds, margin);

/**
 * Touching counts as overlapping.
 *
 * Pieces laid exactly edge to edge are the normal case in a tight marker, and
 * treating that as a collision would make them unplaceable. The buffer, not
 * this test, is what holds pieces apart.
 */
export const overlaps = (a: Bounds, b: Bounds): boolean =>
  a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

/** The buffer this piece must hold, falling back to the document default. */
export const bufferFor = (bufferOverride: number | undefined, documentBuffer: number): number =>
  bufferOverride ?? documentBuffer;
