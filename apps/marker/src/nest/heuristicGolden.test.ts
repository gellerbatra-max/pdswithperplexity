import { describe, expect, it } from 'vitest';
import type { Point, TrayPiece } from '@/marker/schema';
import { nest, type NestInput } from './heuristic';

/**
 * Bottom-left fill must place pieces exactly where it did before the spatial
 * index and the allocation-free SAT went in.
 *
 * These placements were captured from the engine as it stood *before* those
 * changes and pasted in unedited. Capturing them afterwards would only prove
 * the engine agrees with itself. If a future change to the search order, the
 * grid, or the collision maths shifts a single piece, this fails and says so.
 *
 * Fixtures cover the paths that touch the index differently: plain packing,
 * rotation, a cutter buffer, concave outlines that decompose into several
 * convex parts, a defect zone, a splice line, and a crowded marker.
 */

const rect = (w: number, h: number): Point[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

const tri = (w: number, h: number): Point[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: 0, y: h },
];

const tray = (
  id: string,
  geometry: Point[],
  layDirection: TrayPiece['layDirection'] = '2way',
): TrayPiece => ({
  id,
  name: '',
  size: '',
  bundle: '',
  fabricCode: 'A',
  geometry,
  layDirection,
  quantity: 1,
  placed: 0,
});

const input = (over: Partial<NestInput>): NestInput => ({
  pieces: [],
  fabricWidth: 150,
  placed: [],
  defectZones: [],
  spliceLines: [],
  effort: 1,
  ...over,
});

const FIXTURES: Record<string, NestInput> = {
  simple: input({
    pieces: [tray('a', rect(40, 60)), tray('b', rect(30, 50)), tray('c', rect(20, 20))],
  }),
  rotating: input({
    pieces: [tray('a', rect(40, 60), '4way'), tray('b', rect(30, 90), '4way')],
    effort: 2,
  }),
  buffered: input({
    pieces: [tray('a', rect(40, 60)), tray('b', rect(40, 60))],
    cutterBuffer: 0.5,
  }),
  concave: input({
    pieces: [tray('a', tri(50, 70)), tray('b', tri(40, 60)), tray('c', rect(25, 25))],
  }),
  defects: input({
    pieces: [tray('a', rect(40, 60)), tray('b', rect(30, 40))],
    defectZones: [{ id: 'd', x: 0, y: 0, width: 50, height: 150 }],
  }),
  splices: input({
    pieces: [tray('a', rect(40, 60)), tray('b', rect(30, 40))],
    spliceLines: [{ id: 's', x: 45 }],
  }),
  many: input({
    pieces: Array.from({ length: 12 }, (_, i) =>
      tray(`p${i}`, rect(18 + (i % 4) * 6, 22 + (i % 5) * 8)),
    ),
    effort: 2,
  }),
};

/** [pieceDefId, x, y, rotation, flipped] — captured before the change. */
type GoldenPlacement = readonly [string, number, number, number, boolean];

interface Golden {
  readonly placements: readonly GoldenPlacement[];
  readonly unplaced: readonly string[];
  readonly markerLength: number;
}

const GOLDEN: Record<string, Golden> = {
  simple: {
    placements: [
      ["a", 0, 0, 0, false],
      ["b", 0, 60, 0, false],
      ["c", 0, 110, 0, false]
    ],
    unplaced: [],
    markerLength: 40,
  },
  rotating: {
    placements: [
      ["b", 0, 0, 0, false],
      ["a", 0, 90, 0, false]
    ],
    unplaced: [],
    markerLength: 40,
  },
  buffered: {
    placements: [
      ["a", 0, 0, 0, false],
      ["b", 0, 61, 0, false]
    ],
    unplaced: [],
    markerLength: 40,
  },
  concave: {
    placements: [
      ["a", 0, 0, 0, false],
      ["b", 40, 74, 180, false],
      ["c", 0, 74, 0, false]
    ],
    unplaced: [],
    markerLength: 50,
  },
  defects: {
    placements: [
  
    ],
    unplaced: ["a","b"],
    markerLength: 0,
  },
  splices: {
    placements: [
      ["a", 0, 0, 0, false],
      ["b", 0, 60, 0, false]
    ],
    unplaced: [],
    markerLength: 40,
  },
  many: {
    placements: [
      ["p3", 0, 0, 0, false],
      ["p7", 0, 46, 0, false],
      ["p9", 0, 84, 0, false],
      ["p2", 24, 84, 0, false],
      ["p11", 36, 0, 0, false],
      ["p4", 36, 30, 0, false],
      ["p6", 54, 30, 0, false],
      ["p8", 54, 60, 0, false],
      ["p1", 54, 106, 0, false],
      ["p10", 24, 122, 0, false],
      ["p5", 72, 0, 0, false],
      ["p0", 72, 60, 0, false]
    ],
    unplaced: [],
    markerLength: 96,
  },};

describe('bottom-left fill places exactly where it used to', () => {
  it.each(Object.keys(FIXTURES))('%s', (name) => {
    const fixture = FIXTURES[name];
    const expected = GOLDEN[name];
    if (!fixture || !expected) throw new Error(`missing fixture ${name}`);

    const result = nest(fixture);

    expect(
      result.placements.map((p) => [p.pieceDefId, p.position.x, p.position.y, p.rotation, p.flipped]),
    ).toEqual(expected.placements.map((p) => [...p]));
    expect(result.unplaced).toEqual([...expected.unplaced]);
    expect(result.markerLength).toBeCloseTo(expected.markerLength, 9);
  });

  it('covers every fixture with a golden', () => {
    // A fixture without an expectation would pass silently.
    expect(Object.keys(GOLDEN).sort()).toEqual(Object.keys(FIXTURES).sort());
  });

  it('is stable across repeated runs', () => {
    const fixture = FIXTURES.many;
    if (!fixture) throw new Error('missing fixture');
    expect(nest(fixture)).toEqual(nest(fixture));
  });
});
