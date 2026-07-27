import { describe, expect, it } from 'vitest';
import { decompose, isConvex, signedArea } from './convex';
import type { Point } from './schema';

const area = (points: readonly Point[]): number => Math.abs(signedArea(points));

const square = (size: number): Point[] => [
  { x: 0, y: 0 },
  { x: size, y: 0 },
  { x: size, y: size },
  { x: 0, y: size },
];

/** An L-shape: one reflex corner. */
const lShape: Point[] = [
  { x: 0, y: 0 },
  { x: 60, y: 0 },
  { x: 60, y: 30 },
  { x: 30, y: 30 },
  { x: 30, y: 90 },
  { x: 0, y: 90 },
];

/** A bodice-like outline with a scooped armhole — two reflex corners. */
const scooped: Point[] = [
  { x: 0, y: 0 },
  { x: 50, y: 0 },
  { x: 50, y: 60 },
  { x: 35, y: 45 },
  { x: 20, y: 60 },
  { x: 0, y: 60 },
];

describe('isConvex', () => {
  it('accepts a triangle and a square', () => {
    expect(isConvex(square(10))).toBe(true);
    expect(isConvex([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(true);
  });

  it('rejects a shape with a reflex corner', () => {
    expect(isConvex(lShape)).toBe(false);
    expect(isConvex(scooped)).toBe(false);
  });

  it('is unaffected by winding direction', () => {
    expect(isConvex([...square(10)].reverse())).toBe(true);
  });
});

describe('signedArea', () => {
  it('is positive counter-clockwise and negative clockwise', () => {
    expect(signedArea(square(10))).toBeCloseTo(100, 9);
    expect(signedArea([...square(10)].reverse())).toBeCloseTo(-100, 9);
  });
});

describe('decompose', () => {
  it('returns a convex outline untouched as one part', () => {
    const result = decompose(square(10));
    expect(result.ok).toBe(true);
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]).toEqual(square(10));
  });

  it('splits an L into convex parts that cover the same area', () => {
    const result = decompose(lShape);
    expect(result.ok).toBe(true);
    expect(result.parts.length).toBeGreaterThan(1);
    for (const part of result.parts) expect(isConvex(part)).toBe(true);

    const total = result.parts.reduce((sum, part) => sum + area(part), 0);
    expect(total).toBeCloseTo(area(lShape), 6);
  });

  it('splits a scooped outline and keeps every part convex', () => {
    const result = decompose(scooped);
    expect(result.ok).toBe(true);
    for (const part of result.parts) expect(isConvex(part)).toBe(true);
    const total = result.parts.reduce((sum, part) => sum + area(part), 0);
    expect(total).toBeCloseTo(area(scooped), 6);
  });

  it('merges greedily rather than leaving raw triangles', () => {
    // An L needs only two convex parts; ear clipping alone would give four.
    expect(decompose(lShape).parts.length).toBeLessThanOrEqual(3);
  });

  it('handles a clockwise outline', () => {
    const result = decompose([...lShape].reverse());
    expect(result.ok).toBe(true);
    for (const part of result.parts) expect(isConvex(part)).toBe(true);
  });

  it('reports failure for a degenerate outline', () => {
    expect(decompose([{ x: 0, y: 0 }, { x: 1, y: 1 }]).ok).toBe(false);
  });

  it('handles a many-vertex tessellated curve without stalling', () => {
    // A half-disc: convex hull on the arc, flat across the chord.
    const points: Point[] = [];
    for (let i = 0; i <= 40; i += 1) {
      const angle = (Math.PI * i) / 40;
      points.push({ x: Math.cos(angle) * 20, y: Math.sin(angle) * 20 });
    }
    const result = decompose(points);
    expect(result.ok).toBe(true);
    for (const part of result.parts) expect(isConvex(part)).toBe(true);
  });
});
