import { describe, expect, it } from 'vitest';
import { satCollision } from '@/canvas/collision/sat';
import { orientPoints } from '@/canvas/collision/orient';
import { translate } from '@/marker/pieceGeometry';
import type { PlacedPiece, Point, TrayPiece } from '@/marker/schema';
import { nest, rotationsFor, type NestInput, type NestPlacement } from './heuristic';

const rect = (width: number, height: number): Point[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

const tray = (
  id: string,
  geometry: Point[],
  layDirection: TrayPiece['layDirection'] = '2way',
): TrayPiece => ({
  id,
  name: id,
  size: 'M',
  bundle: 'B1',
  fabricCode: 'A',
  geometry,
  layDirection,
  quantity: 1,
  placed: 0,
});

const placed = (id: string, geometry: Point[], position: Point): PlacedPiece => ({
  id,
  pieceDefId: `def-${id}`,
  name: id,
  size: 'M',
  bundle: 'B1',
  fabricCode: 'A',
  geometry,
  position,
  rotation: 0,
  flipped: false,
  placed: true,
  blocked: false,
});

const input = (overrides: Partial<NestInput> = {}): NestInput => ({
  pieces: [],
  fabricWidth: 100,
  placed: [],
  defectZones: [],
  spliceLines: [],
  effort: 1,
  ...overrides,
});

/** Every placement, as the polygon it actually occupies. */
const polygons = (placements: readonly NestPlacement[], pieces: readonly TrayPiece[]): Point[][] =>
  placements.map((placement) => {
    const piece = pieces.find((candidate) => candidate.id === placement.pieceDefId);
    if (!piece) throw new Error(`no piece for ${placement.pieceDefId}`);
    return translate(
      orientPoints(piece.geometry, { rotation: placement.rotation, flipped: placement.flipped }),
      placement.position,
    );
  });

const anyOverlap = (shapes: readonly Point[][]): boolean => {
  for (let i = 0; i < shapes.length; i += 1) {
    for (let j = i + 1; j < shapes.length; j += 1) {
      const a = shapes[i];
      const b = shapes[j];
      if (a && b && satCollision(a, b).collides) return true;
    }
  }
  return false;
};

describe('placement', () => {
  it('places nothing when given nothing', () => {
    const result = nest(input());
    expect(result.placements).toEqual([]);
    expect(result.utilization).toBe(0);
  });

  it('puts a single piece at the bottom-left corner', () => {
    const pieces = [tray('a', rect(40, 60))];
    const result = nest(input({ pieces }));
    expect(result.placements[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it('places every piece when they fit', () => {
    const pieces = [tray('a', rect(40, 60)), tray('b', rect(40, 60)), tray('c', rect(30, 50))];
    const result = nest(input({ pieces }));
    expect(result.placements).toHaveLength(3);
    expect(result.unplaced).toEqual([]);
  });

  it('never overlaps two pieces', () => {
    const pieces = [
      tray('a', rect(40, 60)),
      tray('b', rect(40, 60)),
      tray('c', rect(30, 50)),
      tray('d', rect(25, 25)),
      tray('e', rect(55, 35)),
    ];
    const result = nest(input({ pieces }));
    expect(anyOverlap(polygons(result.placements, pieces))).toBe(false);
  });

  it('keeps everything inside the fabric width', () => {
    const pieces = [tray('a', rect(40, 60)), tray('b', rect(40, 60)), tray('c', rect(30, 90))];
    const result = nest(input({ pieces, fabricWidth: 100 }));
    for (const shape of polygons(result.placements, pieces)) {
      for (const point of shape) {
        expect(point.y).toBeGreaterThanOrEqual(-1e-9);
        expect(point.y).toBeLessThanOrEqual(100 + 1e-9);
        expect(point.x).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it('reports a piece too wide for the fabric as unplaced', () => {
    const pieces = [tray('huge', rect(40, 180))];
    const result = nest(input({ pieces, fabricWidth: 100 }));
    expect(result.placements).toEqual([]);
    expect(result.unplaced).toEqual(['huge']);
  });

  it('places the largest piece first', () => {
    const pieces = [tray('small', rect(10, 10)), tray('big', rect(80, 90))];
    const result = nest(input({ pieces }));
    expect(result.placements[0]?.pieceDefId).toBe('big');
  });
});

describe('existing pieces', () => {
  it('treats already-placed pieces as obstacles', () => {
    const pieces = [tray('a', rect(40, 60))];
    const existing = placed('fixed', rect(40, 60), { x: 0, y: 0 });
    const result = nest(input({ pieces, placed: [existing] }));

    const shapes = [...polygons(result.placements, pieces), translate(existing.geometry, existing.position)];
    expect(anyOverlap(shapes)).toBe(false);
  });

  it('starts the marker length from the existing pieces', () => {
    const existing = placed('fixed', rect(40, 60), { x: 200, y: 0 });
    const result = nest(input({ pieces: [], placed: [existing] }));
    expect(result.markerLength).toBeCloseTo(240, 6);
  });
});

describe('obstacles', () => {
  it('avoids defect zones', () => {
    const pieces = [tray('a', rect(30, 30))];
    const zone = { id: 'd1', x: 0, y: 0, width: 50, height: 50 };
    const result = nest(input({ pieces, defectZones: [zone] }));

    const zonePolygon = rect(50, 50);
    for (const shape of polygons(result.placements, pieces)) {
      expect(satCollision(shape, zonePolygon).collides).toBe(false);
    }
  });

  it('never leaves a piece straddling a splice line', () => {
    const pieces = [tray('a', rect(30, 30)), tray('b', rect(30, 30))];
    const result = nest(input({ pieces, spliceLines: [{ id: 's1', x: 20 }] }));

    // Assert it placed before asserting it placed legally: this loop is
    // vacuous over an empty plan, so "placed nothing" would pass it silently.
    expect(result.placements).toHaveLength(2);
    for (const shape of polygons(result.placements, pieces)) {
      const xs = shape.map((point) => point.x);
      const straddles = Math.min(...xs) < 20 && Math.max(...xs) > 20;
      expect(straddles).toBe(false);
    }
  });

  it('holds the cutter buffer between pieces', () => {
    const pieces = [tray('a', rect(40, 40)), tray('b', rect(40, 40))];
    const result = nest(input({ pieces, cutterBuffer: 1, fabricWidth: 45 }));
    expect(result.placements).toHaveLength(2);

    const [first, second] = result.placements;
    if (!first || !second) throw new Error('expected two placements');
    // Side by side along x, so the gap between them is the buffer.
    expect(Math.abs(second.position.x - first.position.x)).toBeGreaterThanOrEqual(41 - 1e-6);
  });
});

describe('the scan ceiling and splice lines', () => {
  /** A splice at every centimetre from 1 to n — no gap wider than 1. */
  const splicesTo = (n: number) =>
    Array.from({ length: n }, (_, index) => ({ id: `s${index + 1}`, x: index + 1 }));

  const straddlesAny = (
    shapes: readonly Point[][],
    splices: readonly { readonly x: number }[],
  ): boolean =>
    shapes.some((shape) => {
      const xs = shape.map((point) => point.x);
      const [left, right] = [Math.min(...xs), Math.max(...xs)];
      return splices.some((splice) => left < splice.x && right > splice.x);
    });

  it('reaches a legal position past a run of splices', () => {
    // The verified repro. `markerLength` is 0 on empty fabric and splices never
    // raised it, so the scan stopped at 0 + 30 + 1 = 31 — four centimetres
    // short of x=40, the first position that does not straddle anything.
    const pieces = [tray('a', rect(30, 30))];
    const splices = splicesTo(40);
    const result = nest(input({ pieces, spliceLines: splices }));

    expect(result.unplaced).toEqual([]);
    expect(result.placements).toHaveLength(1);
    expect(result.placements[0]?.position.x).toBe(40);
    expect(straddlesAny(polygons(result.placements, pieces), splices)).toBe(false);
  });

  it('keeps placing once the first piece has cleared the splices', () => {
    // Nothing landed before, so `markerLength` stayed 0 and every later piece
    // hit the same short ceiling. All four have to find a home now.
    const pieces = Array.from({ length: 4 }, (_, index) => tray(`p${index}`, rect(30, 30)));
    const splices = splicesTo(40);
    const result = nest(input({ pieces, spliceLines: splices }));

    expect(result.unplaced).toEqual([]);
    expect(result.placements).toHaveLength(4);
    expect(straddlesAny(polygons(result.placements, pieces), splices)).toBe(false);
    expect(result.placements.every((placement) => placement.position.x >= 40)).toBe(true);
  });

  it('leaves a piece that fits before the splices exactly where it was', () => {
    // Splices at 40 and 80 leave a 40 cm run from zero, so a 30 cm piece still
    // belongs at the origin. A wider ceiling must not move anything.
    const pieces = [tray('a', rect(30, 30))];
    const splices = [{ id: 'a', x: 40 }, { id: 'b', x: 80 }];
    const withSplices = nest(input({ pieces, spliceLines: splices }));
    const without = nest(input({ pieces }));

    expect(withSplices.placements).toHaveLength(1);
    expect(withSplices.placements[0]?.position).toEqual({ x: 0, y: 0 });
    expect(withSplices.placements).toEqual(without.placements);
    expect(withSplices.markerLength).toBe(without.markerLength);
  });

  it('leaves a marker with no splices untouched', () => {
    // `spliceLines` is empty on most requests, so the new term must be a no-op
    // there — this is the engine's whole existing behaviour.
    const pieces = [tray('a', rect(40, 25)), tray('b', rect(30, 40)), tray('c', rect(25, 25))];
    const result = nest(input({ pieces }));

    expect(result.placements).toHaveLength(3);
    expect(result.placements.every((placement) => placement.position.x === 0)).toBe(true);
  });

  it('takes the earliest legal position, not merely one that is reachable', () => {
    // A wider ceiling must not turn bottom-left fill into "anywhere it fits":
    // the gap between 30 and 60 holds a 25 cm piece, so it goes there rather
    // than past the last splice.
    const pieces = [tray('a', rect(25, 25))];
    const splices = [{ id: 'a', x: 10 }, { id: 'b', x: 30 }, { id: 'c', x: 60 }];
    const result = nest(input({ pieces, spliceLines: splices }));

    expect(result.placements[0]?.position.x).toBe(30);
    expect(straddlesAny(polygons(result.placements, pieces), splices)).toBe(false);
  });

  it('is deterministic across repeated runs', () => {
    const pieces = Array.from({ length: 3 }, (_, index) => tray(`p${index}`, rect(30, 30)));
    const build = () => nest(input({ pieces, spliceLines: splicesTo(40) }));
    expect(build()).toEqual(build());
  });

  it('still reports unplaced when the piece cannot cross the fabric', () => {
    // Not a relaxation: a wider scan cannot help a piece too big for the roll,
    // and saying so is the right answer however far the ceiling reaches.
    const pieces = [tray('a', rect(30, 30))];
    const result = nest(input({ pieces, fabricWidth: 20, spliceLines: splicesTo(40) }));

    expect(result.placements).toEqual([]);
    expect(result.unplaced).toEqual(['a']);
  });

  it('reaches past a long run of splices rather than a fixed distance', () => {
    // Ten times the repro's run. The ceiling tracks the last splice, so the
    // piece still finds the clear fabric beyond it — there is always some,
    // because a splice constrains only the fabric before it.
    const pieces = [tray('a', rect(30, 30))];
    const splices = splicesTo(400);
    const result = nest(input({ pieces, spliceLines: splices }));

    expect(result.unplaced).toEqual([]);
    expect(result.placements[0]?.position.x).toBe(400);
    expect(straddlesAny(polygons(result.placements, pieces), splices)).toBe(false);
  });
});

describe('rotationsFor', () => {
  it('ignores effort for grain-constrained pieces', () => {
    for (const effort of [1, 2, 3, 4, 5] as const) {
      expect(rotationsFor('2way', effort)).toEqual([0, 180]);
      expect(rotationsFor('4way', effort)).toEqual([0, 90, 180, 270]);
    }
  });

  it('subdivides the circle for free pieces, eight angles per effort step', () => {
    expect(rotationsFor('free', 1)).toHaveLength(8);
    expect(rotationsFor('free', 2)).toHaveLength(16);
    expect(rotationsFor('free', 3)).toHaveLength(24);
    expect(rotationsFor('free', 4)).toHaveLength(32);
    expect(rotationsFor('free', 5)).toHaveLength(40);
  });

  it('spaces free angles evenly from zero', () => {
    expect(rotationsFor('free', 1)).toEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(rotationsFor('free', 2).slice(0, 3)).toEqual([0, 22.5, 45]);
    expect(rotationsFor('free', 3).slice(0, 3)).toEqual([0, 15, 30]);
    expect(rotationsFor('free', 4).slice(0, 3)).toEqual([0, 11.25, 22.5]);
    expect(rotationsFor('free', 5).slice(0, 3)).toEqual([0, 9, 18]);
  });

  it('stays inside one turn', () => {
    for (const effort of [1, 2, 3, 4, 5] as const) {
      for (const angle of rotationsFor('free', effort)) {
        expect(angle).toBeGreaterThanOrEqual(0);
        expect(angle).toBeLessThan(360);
      }
    }
  });
});

describe('rotation', () => {
  it('only uses 0 and 180 for a two-way piece', () => {
    const pieces = [tray('a', rect(40, 60), '2way'), tray('b', rect(40, 60), '2way')];
    const result = nest(input({ pieces }));
    for (const placement of result.placements) {
      expect([0, 180]).toContain(placement.rotation);
    }
  });

  it('may turn a four-way piece to make it fit', () => {
    // 90 cm across the fabric width, on 30 cm fabric: only a quarter turn fits.
    const pieces = [tray('a', rect(20, 90), '4way')];
    const result = nest(input({ pieces, fabricWidth: 30 }));
    expect(result.placements).toHaveLength(1);
    expect([90, 270]).toContain(result.placements[0]?.rotation);
  });

  it('leaves a two-way piece unplaced when only a turn would fit it', () => {
    // Same shape, but a two-way piece may not be turned across the grain.
    const pieces = [tray('a', rect(20, 90), '2way')];
    const result = nest(input({ pieces, fabricWidth: 30 }));
    expect(result.unplaced).toEqual(['a']);
  });
});

describe('reported figures', () => {
  it('reports the marker length as the far edge of the last piece', () => {
    const pieces = [tray('a', rect(40, 100))];
    const result = nest(input({ pieces, fabricWidth: 100 }));
    expect(result.markerLength).toBeCloseTo(40, 6);
  });

  it('reports utilisation as area covered over area used', () => {
    // One 40×100 piece on 100 cm fabric fills its 40 cm of marker exactly.
    const pieces = [tray('a', rect(40, 100))];
    const result = nest(input({ pieces, fabricWidth: 100 }));
    expect(result.utilization).toBeCloseTo(100, 6);
  });

  it('exceeds 60% utilisation on a ten-piece order', () => {
    const pieces = Array.from({ length: 10 }, (_, i) => tray(`p${i}`, rect(40, 48), '4way'));
    const result = nest(input({ pieces, fabricWidth: 100, effort: 2 }));
    expect(result.placements).toHaveLength(10);
    expect(result.utilization).toBeGreaterThan(60);
  });
});

describe('progress', () => {
  it('reports monotonically and finishes at 100', () => {
    const pieces = [tray('a', rect(20, 20)), tray('b', rect(20, 20)), tray('c', rect(20, 20))];
    const seen: number[] = [];
    nest(input({ pieces }), (percent) => seen.push(percent));

    expect(seen.at(-1)).toBe(100);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });
});
