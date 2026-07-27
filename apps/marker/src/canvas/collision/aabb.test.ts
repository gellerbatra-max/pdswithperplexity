import { describe, expect, it } from 'vitest';
import type { Point } from '@/marker/schema';
import { boundsOf, bufferFor, expand, overlaps } from './aabb';

const square = (x: number, y: number, size = 10): Point[] => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

describe('boundsOf', () => {
  it('wraps a polygon', () => {
    expect(boundsOf(square(5, 5))).toEqual({ minX: 5, minY: 5, maxX: 15, maxY: 15 });
  });

  it('handles negative coordinates', () => {
    expect(boundsOf(square(-20, -20))).toEqual({ minX: -20, minY: -20, maxX: -10, maxY: -10 });
  });
});

describe('expand', () => {
  it('grows on all four sides', () => {
    expect(expand(boundsOf(square(0, 0)), 1)).toEqual({
      minX: -1,
      minY: -1,
      maxX: 11,
      maxY: 11,
    });
  });

  it('is a no-op at zero buffer', () => {
    const bounds = boundsOf(square(0, 0));
    expect(expand(bounds, 0)).toEqual(bounds);
  });
});

describe('overlaps', () => {
  it('is false for boxes apart', () => {
    expect(overlaps(boundsOf(square(0, 0)), boundsOf(square(20, 0)))).toBe(false);
  });

  it('is false for boxes that merely touch', () => {
    expect(overlaps(boundsOf(square(0, 0)), boundsOf(square(10, 0)))).toBe(false);
  });

  it('is true when they intersect', () => {
    expect(overlaps(boundsOf(square(0, 0)), boundsOf(square(5, 5)))).toBe(true);
  });

  it('is true when one contains the other', () => {
    expect(overlaps(boundsOf(square(0, 0, 100)), boundsOf(square(10, 10)))).toBe(true);
  });

  it('separates on either axis alone', () => {
    expect(overlaps(boundsOf(square(0, 0)), boundsOf(square(5, 20)))).toBe(false);
    expect(overlaps(boundsOf(square(0, 0)), boundsOf(square(20, 5)))).toBe(false);
  });

  it('reports the overlap a buffer creates', () => {
    const a = boundsOf(square(0, 0));
    const b = boundsOf(square(10.2, 0));
    expect(overlaps(a, b)).toBe(false);
    // With a 0.5 cm cutter buffer the same pair is too close.
    expect(overlaps(expand(a, 0.5), b)).toBe(true);
  });
});

describe('bufferFor', () => {
  it('falls back to the document buffer', () => {
    expect(bufferFor(undefined, 0.3)).toBe(0.3);
  });

  it('prefers a per-piece override', () => {
    expect(bufferFor(1, 0.3)).toBe(1);
  });

  it('honours an override of zero rather than treating it as absent', () => {
    expect(bufferFor(0, 0.5)).toBe(0);
  });
});
