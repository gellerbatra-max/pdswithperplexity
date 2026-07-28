import { describe, expect, it } from 'vitest';
import type { Bounds } from '@/canvas/collision/aabb';
import { cellSizeFor, SpatialIndex } from './spatialIndex';

const box = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({
  minX,
  minY,
  maxX,
  maxY,
});

/** Everything the index hands back for a query, in visit order. */
const visited = <T>(index: SpatialIndex<T>, query: Bounds): T[] => {
  const seen: T[] = [];
  index.forEachNear(query, (value) => {
    seen.push(value);
    return false;
  });
  return seen;
};

describe('finding what is near', () => {
  it('finds nothing in an empty index', () => {
    expect(visited(new SpatialIndex<string>(10), box(0, 0, 10, 10))).toEqual([]);
  });

  it('finds an item that overlaps the query', () => {
    const index = new SpatialIndex<string>(10);
    index.insert(box(0, 0, 10, 10), 'a');
    expect(visited(index, box(5, 5, 15, 15))).toEqual(['a']);
  });

  it('finds an item the query sits entirely inside', () => {
    const index = new SpatialIndex<string>(10);
    index.insert(box(0, 0, 100, 100), 'big');
    expect(visited(index, box(40, 40, 41, 41))).toEqual(['big']);
  });

  it('never misses an item that genuinely overlaps', () => {
    // The whole contract: a filter may hand back too much, never too little.
    const index = new SpatialIndex<number>(7);
    const items: Bounds[] = [];
    for (let i = 0; i < 200; i += 1) {
      const bounds = box((i * 13) % 300, (i * 29) % 150, ((i * 13) % 300) + 9, ((i * 29) % 150) + 11);
      items.push(bounds);
      index.insert(bounds, i);
    }

    const query = box(100, 40, 140, 90);
    const overlapping = items
      .map((bounds, i) => ({ bounds, i }))
      .filter(
        ({ bounds }) =>
          bounds.minX <= query.maxX &&
          bounds.maxX >= query.minX &&
          bounds.minY <= query.maxY &&
          bounds.maxY >= query.minY,
      )
      .map(({ i }) => i);

    const found = new Set(visited(index, query));
    for (const id of overlapping) expect(found.has(id)).toBe(true);
  });

  it('hands an item spanning several cells back only once', () => {
    const index = new SpatialIndex<string>(5);
    index.insert(box(0, 0, 20, 20), 'wide');
    expect(visited(index, box(0, 0, 20, 20))).toEqual(['wide']);
  });

  it('works with negative coordinates', () => {
    const index = new SpatialIndex<string>(10);
    index.insert(box(-30, -30, -20, -20), 'behind');
    expect(visited(index, box(-25, -25, -24, -24))).toEqual(['behind']);
    expect(visited(index, box(50, 50, 60, 60))).toEqual([]);
  });

  it('stops as soon as the visitor says so', () => {
    const index = new SpatialIndex<string>(10);
    index.insert(box(0, 0, 10, 10), 'a');
    index.insert(box(1, 1, 11, 11), 'b');
    index.insert(box(2, 2, 12, 12), 'c');

    let count = 0;
    const hit = index.forEachNear(box(0, 0, 12, 12), () => {
      count += 1;
      return true;
    });

    expect(hit).toBe(true);
    expect(count).toBe(1);
  });

  it('starts each query with a clean slate', () => {
    // The visited-stamp is per query; a second query must see everything again.
    const index = new SpatialIndex<string>(10);
    index.insert(box(0, 0, 10, 10), 'a');
    expect(visited(index, box(0, 0, 10, 10))).toEqual(['a']);
    expect(visited(index, box(0, 0, 10, 10))).toEqual(['a']);
  });

  it('counts what it holds', () => {
    const index = new SpatialIndex<string>(10);
    index.insert(box(0, 0, 1, 1), 'a');
    index.insert(box(0, 0, 500, 500), 'oversized');
    expect(index.size).toBe(2);
  });
});

describe('oversized items', () => {
  it('finds one wherever the query is', () => {
    // A defect zone down the length of the roll is held aside rather than
    // written into every cell it covers, and must still turn up.
    const index = new SpatialIndex<string>(1);
    index.insert(box(0, 0, 1000, 1000), 'roll-long');
    index.insert(box(5, 5, 6, 6), 'small');

    expect(visited(index, box(900, 900, 901, 901))).toEqual(['roll-long']);
    expect(visited(index, box(5, 5, 6, 6)).sort()).toEqual(['roll-long', 'small']);
  });

  it('hands an oversized item back once per query', () => {
    const index = new SpatialIndex<string>(1);
    index.insert(box(0, 0, 1000, 1000), 'roll-long');
    expect(visited(index, box(0, 0, 500, 500))).toEqual(['roll-long']);
  });
});

describe('narrowing', () => {
  it('visits a small fraction of a crowded marker', () => {
    // The point of the whole structure. Measured as a share of the items held,
    // not as elapsed time, so it means the same thing on any machine.
    const index = new SpatialIndex<number>(20);
    for (let i = 0; i < 500; i += 1) {
      const x = (i % 25) * 20;
      const y = Math.floor(i / 25) * 15;
      index.insert(box(x, y, x + 18, y + 13), i);
    }

    const near = visited(index, box(100, 45, 118, 58));
    expect(near.length).toBeGreaterThan(0);
    expect(near.length / 500).toBeLessThan(0.05);
  });

  it('degrades to everything only when everything is oversized', () => {
    const index = new SpatialIndex<number>(1);
    for (let i = 0; i < 10; i += 1) index.insert(box(0, 0, 1000, 1000), i);
    expect(visited(index, box(0, 0, 1, 1))).toHaveLength(10);
  });
});

describe('cellSizeFor', () => {
  it('averages the longer side of each item', () => {
    // 20 and 40 → 30.
    expect(cellSizeFor([box(0, 0, 10, 20), box(0, 0, 40, 5)], 150)).toBe(30);
  });

  it('falls back when there is nothing to measure', () => {
    expect(cellSizeFor([], 150)).toBe(150);
  });

  it('never goes below one centimetre', () => {
    // Tiny cells make a grid that is mostly empty buckets.
    expect(cellSizeFor([box(0, 0, 0.1, 0.1)], 150)).toBe(1);
    expect(cellSizeFor([], 0)).toBe(1);
  });

  it('is the same for the same input', () => {
    const extents = [box(0, 0, 10, 20), box(5, 5, 45, 10)];
    expect(cellSizeFor(extents, 150)).toBe(cellSizeFor(extents, 150));
  });
});
