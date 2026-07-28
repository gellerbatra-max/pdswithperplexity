/**
 * A uniform grid over obstacle bounding boxes.
 *
 * Bottom-left fill asks "does anything sit here?" once per candidate position
 * per rotation — tens of thousands of times on a real order. Answering it by
 * walking every obstacle makes the cost of each question grow with the number
 * already placed, so the run gets slower exactly as the marker fills up.
 *
 * This narrows the question to the obstacles sharing a cell with the query.
 * It is a filter, not an answer: callers still run the same broad-phase
 * overlap test and the same SAT pass on whatever comes back, so the result is
 * identical to a full scan and only the number of pairs tested changes.
 *
 * Pure data structure — no geometry beyond bounding boxes, no DOM, no clock.
 */

import type { Bounds } from '@/canvas/collision/aabb';

/** Below this a grid is mostly empty cells, which costs more than it saves. */
const MIN_CELL_CM = 1;

/**
 * An item spanning more cells than this is held aside and visited on every
 * query instead of being written into each cell it covers.
 *
 * A defect zone running the length of the roll would otherwise be inserted
 * into thousands of cells — slow to insert, and it would appear in almost
 * every query anyway. One overflow list is cheaper than that bookkeeping.
 */
const MAX_CELLS_PER_ITEM = 64;

export class SpatialIndex<T> {
  private readonly cellSize: number;
  /** Column → row → item ids. Sparse, so an empty marker costs nothing. */
  private readonly columns = new Map<number, Map<number, number[]>>();
  private readonly values: T[] = [];
  private readonly extents: Bounds[] = [];
  private readonly oversized: number[] = [];
  /**
   * Last query that visited each item, so an item spanning four cells is
   * still handed to the caller once. Stamping beats clearing a set per query.
   */
  private readonly seen: number[] = [];
  private generation = 0;

  constructor(cellSize: number) {
    this.cellSize = Math.max(MIN_CELL_CM, cellSize);
  }

  get size(): number {
    return this.values.length;
  }

  insert(bounds: Bounds, value: T): void {
    const id = this.values.length;
    this.values.push(value);
    this.extents.push(bounds);
    this.seen.push(-1);

    const minX = this.cellOf(bounds.minX);
    const maxX = this.cellOf(bounds.maxX);
    const minY = this.cellOf(bounds.minY);
    const maxY = this.cellOf(bounds.maxY);

    if ((maxX - minX + 1) * (maxY - minY + 1) > MAX_CELLS_PER_ITEM) {
      this.oversized.push(id);
      return;
    }

    for (let cx = minX; cx <= maxX; cx += 1) {
      let column = this.columns.get(cx);
      if (!column) {
        column = new Map<number, number[]>();
        this.columns.set(cx, column);
      }
      for (let cy = minY; cy <= maxY; cy += 1) {
        const bucket = column.get(cy);
        if (bucket) bucket.push(id);
        else column.set(cy, [id]);
      }
    }
  }

  /**
   * Visit everything that might overlap `query`, stopping early if `visit`
   * returns true — which it does as soon as a collision is found, so a
   * blocked position costs one hit rather than a full sweep.
   *
   * Anything whose bounds genuinely overlap `query` is guaranteed to be
   * visited: it must share at least one cell with it, or be oversized and
   * therefore always visited. Items that merely share a cell are visited too;
   * rejecting those is the caller's existing broad-phase test.
   */
  forEachNear(query: Bounds, visit: (value: T) => boolean): boolean {
    this.generation += 1;
    const generation = this.generation;

    for (const id of this.oversized) {
      if (this.visitOnce(id, generation, visit)) return true;
    }

    const minX = this.cellOf(query.minX);
    const maxX = this.cellOf(query.maxX);
    const minY = this.cellOf(query.minY);
    const maxY = this.cellOf(query.maxY);

    for (let cx = minX; cx <= maxX; cx += 1) {
      const column = this.columns.get(cx);
      if (!column) continue;
      for (let cy = minY; cy <= maxY; cy += 1) {
        const bucket = column.get(cy);
        if (!bucket) continue;
        for (const id of bucket) {
          if (this.visitOnce(id, generation, visit)) return true;
        }
      }
    }

    return false;
  }

  private visitOnce(id: number, generation: number, visit: (value: T) => boolean): boolean {
    if (this.seen[id] === generation) return false;
    this.seen[id] = generation;
    const value = this.values[id];
    return value === undefined ? false : visit(value);
  }

  private cellOf(coordinate: number): number {
    return Math.floor(coordinate / this.cellSize);
  }
}

/**
 * A cell size for a run, from the pieces it will handle.
 *
 * Cells about the size of a typical piece is the usual advice: much smaller
 * and one piece is written into many cells, much larger and every query drags
 * back most of the marker. The mean of each piece's longer side is a decent
 * stand-in for "typical", and it is computed once from the input, so two runs
 * of the same order build the same grid.
 */
export const cellSizeFor = (extents: readonly Bounds[], fallback: number): number => {
  if (extents.length === 0) return Math.max(MIN_CELL_CM, fallback);

  let total = 0;
  for (const bounds of extents) {
    total += Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  }
  return Math.max(MIN_CELL_CM, total / extents.length);
};
