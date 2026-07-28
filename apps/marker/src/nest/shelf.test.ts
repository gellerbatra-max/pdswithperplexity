import { describe, expect, it } from 'vitest';
import { satCollision } from '@/canvas/collision/sat';
import { orientPoints } from '@/canvas/collision/orient';
import { translate } from '@/marker/pieceGeometry';
import type { Point } from '@/marker/schema';
import { NO_SPACING, type NestPiece, type NestPlacement, type NestRequest } from './model';
import { nestShelf } from './shelf';

const rect = (width: number, height: number): Point[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

const piece = (id: string, width: number, height: number, over: Partial<NestPiece> = {}): NestPiece => ({
  id,
  geometry: rect(width, height),
  rotation: 'half-turn',
  quantity: 1,
  ...over,
});

const request = (over: Partial<NestRequest> = {}): NestRequest => ({
  sheet: { width: 100 },
  pieces: [],
  spacing: NO_SPACING,
  obstacles: [],
  spliceLines: [],
  effort: 1,
  ...over,
});

/** The outline of a placement, in marker space, for overlap assertions. */
const outlineOf = (placement: NestPlacement, pieces: readonly NestPiece[]): Point[] => {
  const source = pieces.find((p) => p.id === placement.pieceId);
  if (!source) throw new Error(`no piece ${placement.pieceId}`);
  return translate(
    orientPoints(source.geometry, { rotation: placement.rotation, flipped: placement.flipped }),
    placement.position,
  );
};

const anyOverlap = (plan: { placements: readonly NestPlacement[] }, pieces: readonly NestPiece[]) => {
  const outlines = plan.placements.map((p) => outlineOf(p, pieces));
  for (let i = 0; i < outlines.length; i += 1) {
    for (let j = i + 1; j < outlines.length; j += 1) {
      const a = outlines[i];
      const b = outlines[j];
      if (a && b && satCollision(a, b).collides) return true;
    }
  }
  return false;
};

describe('a small piece set', () => {
  it('places nothing when given nothing', () => {
    const plan = nestShelf(request());
    expect(plan.placements).toEqual([]);
    expect(plan.unplaced).toEqual([]);
    expect(plan.length).toBe(0);
  });

  it('puts a single piece in the corner', () => {
    const pieces = [piece('a', 20, 30)];
    const plan = nestShelf(request({ pieces }));
    expect(plan.placements).toHaveLength(1);
    expect(plan.placements[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it('places every piece when they all fit', () => {
    const pieces = [piece('a', 20, 30), piece('b', 20, 30), piece('c', 20, 30)];
    const plan = nestShelf(request({ pieces }));
    expect(plan.placements).toHaveLength(3);
    expect(plan.unplaced).toEqual([]);
  });

  it('stacks a shelf across the fabric before starting another', () => {
    // Three 30-deep pieces fit across a 100 wide roll, so all three share one
    // shelf and the marker stays one piece long.
    const pieces = [piece('a', 20, 30), piece('b', 20, 30), piece('c', 20, 30)];
    const plan = nestShelf(request({ pieces }));
    expect(plan.placements.map((p) => p.position.x)).toEqual([0, 0, 0]);
    expect(plan.placements.map((p) => p.position.y)).toEqual([0, 30, 60]);
    expect(plan.length).toBe(20);
  });

  it('opens a new shelf along the fabric when the width is used up', () => {
    // The fourth 30-deep piece cannot fit in 100 of width, so it starts a
    // second shelf one piece-depth along.
    const pieces = [
      piece('a', 20, 30),
      piece('b', 20, 30),
      piece('c', 20, 30),
      piece('d', 20, 30),
    ];
    const plan = nestShelf(request({ pieces }));
    const fourth = plan.placements[3];
    expect(fourth?.position).toEqual({ x: 20, y: 0 });
    expect(plan.length).toBe(40);
  });

  it('places one copy per quantity', () => {
    const pieces = [piece('a', 20, 30, { quantity: 3 })];
    const plan = nestShelf(request({ pieces }));
    expect(plan.placements).toHaveLength(3);
    expect(plan.placements.every((p) => p.pieceId === 'a')).toBe(true);
  });

  it('is deterministic — the same request gives the same plan', () => {
    const pieces = [piece('a', 20, 30), piece('b', 25, 40), piece('c', 15, 35)];
    expect(nestShelf(request({ pieces }))).toEqual(nestShelf(request({ pieces })));
  });
});

describe('mixed piece sizes', () => {
  const pieces = [
    piece('small', 10, 10),
    piece('large', 40, 60),
    piece('medium', 20, 30),
  ];

  it('places the largest box first', () => {
    const plan = nestShelf(request({ pieces }));
    expect(plan.placements[0]?.pieceId).toBe('large');
  });

  it('breaks ties on id so equal pieces never swap between runs', () => {
    const tied = [piece('zulu', 20, 20), piece('alpha', 20, 20)];
    const plan = nestShelf(request({ pieces: tied }));
    expect(plan.placements.map((p) => p.pieceId)).toEqual(['alpha', 'zulu']);
  });

  it('never overlaps two pieces', () => {
    const plan = nestShelf(request({ pieces }));
    expect(anyOverlap(plan, pieces)).toBe(false);
  });

  it('keeps everything inside the fabric width', () => {
    const plan = nestShelf(request({ pieces, sheet: { width: 100 } }));
    for (const placement of plan.placements) {
      const ys = outlineOf(placement, pieces).map((p) => p.y);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    }
  });

  it('never puts a piece behind the start of the fabric', () => {
    const plan = nestShelf(request({ pieces }));
    for (const placement of plan.placements) {
      const xs = outlineOf(placement, pieces).map((p) => p.x);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('narrow fabric', () => {
  it('reports a piece wider than the roll as unplaced', () => {
    const pieces = [piece('oversize', 20, 150)];
    const plan = nestShelf(request({ pieces, sheet: { width: 100 } }));
    expect(plan.placements).toEqual([]);
    expect(plan.unplaced).toEqual(['oversize']);
  });

  it('still places what does fit alongside what does not', () => {
    const pieces = [piece('oversize', 20, 150), piece('ok', 20, 30)];
    const plan = nestShelf(request({ pieces, sheet: { width: 100 } }));
    expect(plan.placements.map((p) => p.pieceId)).toEqual(['ok']);
    expect(plan.unplaced).toEqual(['oversize']);
  });

  it('puts one piece per shelf when the roll only has room for one', () => {
    const pieces = [piece('a', 20, 40), piece('b', 20, 40)];
    const plan = nestShelf(request({ pieces, sheet: { width: 50 } }));
    expect(plan.placements.map((p) => p.position)).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]);
  });

  it('reports every copy that found no home', () => {
    const pieces = [piece('oversize', 20, 150, { quantity: 3 })];
    const plan = nestShelf(request({ pieces, sheet: { width: 100 } }));
    expect(plan.unplaced).toEqual(['oversize', 'oversize', 'oversize']);
  });
});

describe('rotation', () => {
  it('leaves a two-way piece unplaced when only a turn would fit it', () => {
    // 80 across a 50 roll will not go, and 2way may not be turned onto its side.
    const pieces = [piece('grain', 20, 80, { rotation: 'half-turn' })];
    const plan = nestShelf(request({ pieces, sheet: { width: 50 } }));
    expect(plan.unplaced).toEqual(['grain']);
  });

  it('turns a four-way piece to make it fit the same roll', () => {
    const pieces = [piece('free', 20, 80, { rotation: 'quarter-turn' })];
    const plan = nestShelf(request({ pieces, sheet: { width: 50 } }));
    expect(plan.placements).toHaveLength(1);
    expect([90, 270]).toContain(plan.placements[0]?.rotation);
  });

  it('prefers the turn that eats the least fabric width', () => {
    // Laid flat the piece is 20 across; upright it is 60. The shelf packer
    // wants the flat one so more pieces share the shelf.
    const pieces = [piece('a', 60, 20, { rotation: 'quarter-turn' })];
    const plan = nestShelf(request({ pieces, sheet: { width: 100 } }));
    expect([0, 180]).toContain(plan.placements[0]?.rotation);
  });

  it('only ever uses 0 and 180 for a two-way piece', () => {
    const pieces = [piece('a', 20, 30, { quantity: 4 })];
    const plan = nestShelf(request({ pieces }));
    for (const placement of plan.placements) expect([0, 180]).toContain(placement.rotation);
  });
});

describe('collision rejection', () => {
  it('refuses to place a piece on top of an obstacle', () => {
    // The obstacle covers the whole roll for the first 30 along it, so the
    // only legal shelf starts past it.
    const pieces = [piece('a', 20, 30)];
    const plan = nestShelf(
      request({ pieces, obstacles: [{ polygon: rect(30, 100) }] }),
    );
    expect(plan.placements).toHaveLength(1);
    expect(plan.placements[0]?.position.x).toBeGreaterThanOrEqual(30);
  });

  it('holds the cutter buffer between pieces', () => {
    const pieces = [piece('a', 20, 30), piece('b', 20, 30)];
    const plan = nestShelf(
      request({ pieces, spacing: { betweenPieces: 2, fromEdge: 0 } }),
    );
    const [first, second] = plan.placements;
    expect(first?.position.y).toBe(0);
    // 30 deep plus the 2cm the cutter needs.
    expect(second?.position.y).toBe(32);
  });

  it('keeps pieces off the selvedge when a margin is set', () => {
    const pieces = [piece('a', 20, 30)];
    const plan = nestShelf(
      request({ pieces, spacing: { betweenPieces: 0, fromEdge: 5 } }),
    );
    expect(plan.placements[0]?.position.y).toBe(5);
  });

  it('counts the selvedge margin against the usable width', () => {
    // 100 wide less 5 each side leaves 90; a 95-deep piece cannot fit.
    const pieces = [piece('a', 20, 95)];
    const plan = nestShelf(
      request({ pieces, sheet: { width: 100 }, spacing: { betweenPieces: 0, fromEdge: 5 } }),
    );
    expect(plan.unplaced).toEqual(['a']);
  });

  it('never leaves a piece straddling a splice line', () => {
    const pieces = [piece('a', 40, 30)];
    const plan = nestShelf(
      request({ pieces, spliceLines: [{ id: 's1', x: 20 }] }),
    );
    for (const placement of plan.placements) {
      const xs = outlineOf(placement, pieces).map((p) => p.x);
      const straddles = Math.min(...xs) < 20 && Math.max(...xs) > 20;
      expect(straddles).toBe(false);
    }
  });

  it('respects a maximum marker length', () => {
    const pieces = [piece('a', 20, 60), piece('b', 20, 60)];
    // Both are 60 deep so they cannot share a 100 roll; the second needs a
    // second shelf, which a 30 ceiling has no room for.
    const plan = nestShelf(request({ pieces, sheet: { width: 100, maxLength: 30 } }));
    expect(plan.placements).toHaveLength(1);
    expect(plan.unplaced).toEqual(['b']);
  });
});
