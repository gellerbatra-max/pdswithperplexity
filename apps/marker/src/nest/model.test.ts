import { describe, expect, it } from 'vitest';
import type { DefectZone, Point, TrayPiece } from '@/marker/schema';
import {
  anglesFor,
  boxAreaOf,
  expandQuantities,
  nestPieceFrom,
  obstacleFromZone,
  polygonArea,
  rotationPolicyFor,
  type NestPiece,
} from './model';

const rect = (width: number, height: number): Point[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

const tray = (over: Partial<TrayPiece> = {}): TrayPiece => ({
  id: 't1',
  name: 'Front',
  size: 'M',
  bundle: 'B1',
  fabricCode: 'A',
  geometry: rect(10, 20),
  layDirection: '2way',
  quantity: 1,
  placed: 0,
  ...over,
});

const piece = (over: Partial<NestPiece> = {}): NestPiece => ({
  id: 'p1',
  geometry: rect(10, 20),
  rotation: 'half-turn',
  quantity: 1,
  ...over,
});

describe('rotationPolicyFor', () => {
  it('maps the three lay directions', () => {
    expect(rotationPolicyFor('2way')).toBe('half-turn');
    expect(rotationPolicyFor('4way')).toBe('quarter-turn');
    expect(rotationPolicyFor('free')).toBe('free');
  });
});

describe('anglesFor', () => {
  it('gives a two-way piece only the half turn', () => {
    expect(anglesFor('half-turn', 1)).toEqual([0, 180]);
  });

  it('gives a four-way piece the quarter turns', () => {
    expect(anglesFor('quarter-turn', 1)).toEqual([0, 90, 180, 270]);
  });

  it('ignores effort for grain-constrained pieces', () => {
    // Grain is not a search parameter — no amount of effort makes cutting a
    // two-way piece across the grain acceptable.
    expect(anglesFor('half-turn', 5)).toEqual(anglesFor('half-turn', 1));
    expect(anglesFor('quarter-turn', 5)).toEqual(anglesFor('quarter-turn', 1));
  });

  it('subdivides the circle for free pieces, eight angles per effort step', () => {
    expect(anglesFor('free', 1)).toHaveLength(8);
    expect(anglesFor('free', 3)).toHaveLength(24);
    expect(anglesFor('free', 5)).toHaveLength(40);
  });

  it('spaces free angles evenly from zero and stays inside one turn', () => {
    const angles = anglesFor('free', 1);
    expect(angles[0]).toBe(0);
    expect(angles[1]).toBe(45);
    expect(Math.max(...angles)).toBeLessThan(360);
  });
});

describe('nestPieceFrom', () => {
  it('carries the outline and the grain rule across', () => {
    const converted = nestPieceFrom(tray({ layDirection: '4way' }));
    expect(converted.id).toBe('t1');
    expect(converted.rotation).toBe('quarter-turn');
    expect(converted.geometry).toEqual(rect(10, 20));
  });

  it('asks only for what is still outstanding', () => {
    expect(nestPieceFrom(tray({ quantity: 5, placed: 2 })).quantity).toBe(3);
  });

  it('never asks for a negative quantity', () => {
    // Over-placing is possible by hand; it must not become a request to
    // "place -1", which would silently drop the piece from the queue.
    expect(nestPieceFrom(tray({ quantity: 2, placed: 5 })).quantity).toBe(0);
  });
});

describe('obstacleFromZone', () => {
  it('turns a defect rectangle into a closed polygon', () => {
    const zone: DefectZone = { id: 'd1', x: 10, y: 5, width: 20, height: 4 };
    expect(obstacleFromZone(zone).polygon).toEqual([
      { x: 10, y: 5 },
      { x: 30, y: 5 },
      { x: 30, y: 9 },
      { x: 10, y: 9 },
    ]);
  });
});

describe('expandQuantities', () => {
  it('emits one entry per copy', () => {
    const expanded = expandQuantities([piece({ id: 'a', quantity: 3 })]);
    expect(expanded).toHaveLength(3);
    expect(expanded.every((p) => p.id === 'a' && p.quantity === 1)).toBe(true);
  });

  it('drops pieces with nothing outstanding', () => {
    expect(expandQuantities([piece({ quantity: 0 })])).toEqual([]);
  });

  it('handles an empty list', () => {
    expect(expandQuantities([])).toEqual([]);
  });
});

describe('polygonArea', () => {
  it('measures a rectangle', () => {
    expect(polygonArea(rect(10, 20))).toBe(200);
  });

  it('measures a triangle', () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(50);
  });

  it('does not care which way the outline winds', () => {
    expect(polygonArea([...rect(10, 20)].reverse())).toBe(200);
  });

  it('is zero for anything that is not a polygon', () => {
    expect(polygonArea([])).toBe(0);
    expect(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
  });
});

describe('boxAreaOf', () => {
  it('measures the bounding box, not the outline', () => {
    // A triangle covers half its box; the sort key is the box.
    expect(boxAreaOf(piece({ geometry: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 20 }] }))).toBe(
      200,
    );
  });
});
