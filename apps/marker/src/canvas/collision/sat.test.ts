import { describe, expect, it } from 'vitest';
import type { Point } from '@/marker/schema';
import { satCollision } from './sat';

const square = (x: number, y: number, size = 10): Point[] => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
];

const shift = (points: Point[], dx: number, dy: number): Point[] =>
  points.map((point) => ({ x: point.x + dx, y: point.y + dy }));

describe('satCollision', () => {
  it('separates boxes that are apart', () => {
    expect(satCollision(square(0, 0), square(20, 0)).collides).toBe(false);
  });

  it('treats exact touching as clear', () => {
    // Pieces butted edge to edge are the normal case in a tight marker.
    expect(satCollision(square(0, 0), square(10, 0)).collides).toBe(false);
  });

  it('detects an overlap', () => {
    expect(satCollision(square(0, 0), square(5, 0)).collides).toBe(true);
  });

  it('returns the shortest separating push', () => {
    // 5 cm of overlap across x, 10 cm across y — x is the cheaper escape.
    const result = satCollision(square(5, 0), square(0, 0));
    expect(result.mtv?.x).toBeCloseTo(5, 10);
    expect(result.mtv?.y).toBeCloseTo(0, 10);
  });

  it('points the push away from the obstacle', () => {
    // The mover sits to the left, so it must be pushed further left.
    const result = satCollision(square(-5, 0), square(0, 0));
    expect(result.mtv?.x).toBeCloseTo(-5, 10);
  });

  it('produces a push that actually separates the pair', () => {
    const mover = square(3, 3);
    const obstacle = square(0, 0);
    const { mtv } = satCollision(mover, obstacle);
    if (!mtv) throw new Error('expected a collision');
    expect(satCollision(shift(mover, mtv.x, mtv.y), obstacle).collides).toBe(false);
  });

  it('escapes through the shallower axis when the overlap is lopsided', () => {
    const mover: Point[] = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 2 },
      { x: 0, y: 2 },
    ];
    const result = satCollision(mover, square(0, 0));
    // The bar is 2 cm deep into a 10 cm square — up and out is shortest.
    expect(result.collides).toBe(true);
    expect(Math.abs(result.mtv?.y ?? 0)).toBeCloseTo(2, 10);
    expect(Math.abs(result.mtv?.x ?? 0)).toBeCloseTo(0, 10);
  });

  it('handles a triangle against a box', () => {
    const triangle: Point[] = [
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 5, y: 15 },
    ];
    expect(satCollision(triangle, square(0, 0)).collides).toBe(true);
    expect(satCollision(triangle, square(30, 30)).collides).toBe(false);
  });

  it('ignores degenerate polygons rather than throwing', () => {
    expect(satCollision([{ x: 0, y: 0 }], square(0, 0)).collides).toBe(false);
    expect(satCollision([], square(0, 0)).collides).toBe(false);
  });

  it('survives duplicate vertices, which have no edge normal', () => {
    const withDuplicate: Point[] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(satCollision(withDuplicate, square(5, 5)).collides).toBe(true);
  });
});
