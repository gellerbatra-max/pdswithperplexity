import { describe, expect, it } from 'vitest';
import { satCollision } from '@/canvas/collision/sat';
import { orientPoints } from '@/canvas/collision/orient';
import { translate } from '@/marker/pieceGeometry';
import type { MarkerDocument, PlacedPiece, Point, TrayPiece } from '@/marker/schema';
import { NO_SPACING, type NestPiece, type NestPlacement, type NestRequest } from './model';
import {
  NEST_ENGINES,
  requestFromMarker,
  runNest,
  toHeuristicInput,
  toStorePlacements,
  type NestEngine,
} from './pipeline';

const rect = (width: number, height: number): Point[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

const piece = (
  id: string,
  width: number,
  height: number,
  over: Partial<NestPiece> = {},
): NestPiece => ({
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

const outlineOf = (placement: NestPlacement, pieces: readonly NestPiece[]): Point[] => {
  const source = pieces.find((p) => p.id === placement.pieceId);
  if (!source) throw new Error(`no piece ${placement.pieceId}`);
  return translate(
    orientPoints(source.geometry, { rotation: placement.rotation, flipped: placement.flipped }),
    placement.position,
  );
};

describe('the shared entry point', () => {
  const pieces = [piece('a', 20, 30), piece('b', 25, 40), piece('c', 15, 20)];

  it('offers exactly the engines it can run', () => {
    expect([...NEST_ENGINES]).toEqual(['shelf', 'heuristic']);
  });

  it.each(NEST_ENGINES)('%s returns the shared plan shape', (engine) => {
    const plan = runNest(request({ pieces }), engine);
    expect(plan).toHaveProperty('placements');
    expect(plan).toHaveProperty('unplaced');
    expect(plan).toHaveProperty('length');
    expect(plan.sheet).toEqual({ width: 100 });
  });

  it.each(NEST_ENGINES)('%s names placements by pieceId, never pieceDefId', (engine) => {
    const plan = runNest(request({ pieces }), engine);
    expect(plan.placements.length).toBeGreaterThan(0);
    for (const placement of plan.placements) {
      expect(placement).toHaveProperty('pieceId');
      expect(placement).not.toHaveProperty('pieceDefId');
      expect(typeof placement.pieceId).toBe('string');
      expect(typeof placement.rotation).toBe('number');
      expect(typeof placement.flipped).toBe('boolean');
    }
  });

  it.each(NEST_ENGINES)('%s places every piece that fits', (engine) => {
    const plan = runNest(request({ pieces }), engine);
    expect(plan.placements).toHaveLength(3);
    expect(plan.unplaced).toEqual([]);
  });

  it.each(NEST_ENGINES)('%s never overlaps two pieces', (engine) => {
    const plan = runNest(request({ pieces }), engine);
    const outlines = plan.placements.map((p) => outlineOf(p, pieces));
    for (let i = 0; i < outlines.length; i += 1) {
      for (let j = i + 1; j < outlines.length; j += 1) {
        const a = outlines[i];
        const b = outlines[j];
        if (a && b) expect(satCollision(a, b).collides).toBe(false);
      }
    }
  });

  it.each(NEST_ENGINES)('%s keeps every piece inside the fabric width', (engine) => {
    const plan = runNest(request({ pieces }), engine);
    for (const placement of plan.placements) {
      const ys = outlineOf(placement, pieces).map((p) => p.y);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(-1e-9);
      expect(Math.max(...ys)).toBeLessThanOrEqual(100 + 1e-9);
    }
  });

  it.each(NEST_ENGINES)('%s reports a piece that cannot fit as unplaced', (engine) => {
    const oversize = [piece('big', 20, 150)];
    const plan = runNest(request({ pieces: oversize }), engine);
    expect(plan.placements).toEqual([]);
    expect(plan.unplaced).toEqual(['big']);
  });

  it.each(NEST_ENGINES)('%s honours quantity', (engine) => {
    const plan = runNest(request({ pieces: [piece('a', 20, 30, { quantity: 3 })] }), engine);
    expect(plan.placements).toHaveLength(3);
    expect(plan.placements.every((p) => p.pieceId === 'a')).toBe(true);
  });

  it.each(NEST_ENGINES)('%s reports progress that ends at 100', (engine) => {
    const seen: number[] = [];
    runNest(request({ pieces }), engine, (percent) => seen.push(percent));
    expect(seen.at(-1)).toBe(100);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it.each(NEST_ENGINES)('%s reports a length matching its furthest piece', (engine) => {
    const plan = runNest(request({ pieces }), engine);
    const furthest = Math.max(
      ...plan.placements.map((p) => Math.max(...outlineOf(p, pieces).map((point) => point.x))),
    );
    expect(plan.length).toBeCloseTo(furthest, 6);
  });

  it('rejects nothing and returns an empty plan for an empty request', () => {
    for (const engine of NEST_ENGINES) {
      const plan = runNest(request(), engine);
      expect(plan.placements).toEqual([]);
      expect(plan.unplaced).toEqual([]);
      expect(plan.length).toBe(0);
    }
  });
});

describe('determinism', () => {
  const pieces = [
    piece('a', 20, 30),
    piece('b', 25, 40, { rotation: 'quarter-turn' }),
    piece('c', 15, 20, { quantity: 2 }),
  ];

  it.each(NEST_ENGINES)('%s gives the same plan on a repeated run', (engine) => {
    const first = runNest(request({ pieces }), engine);
    const second = runNest(request({ pieces }), engine);
    expect(first).toEqual(second);
  });

  it.each(NEST_ENGINES)('%s gives the same plan across five runs', (engine) => {
    const runs = Array.from({ length: 5 }, () => runNest(request({ pieces }), engine));
    for (const run of runs) expect(run).toEqual(runs[0]);
  });

  it('does not let one engine disturb the other', () => {
    // Both read the same request object; neither may mutate it.
    const shared = request({ pieces });
    const shelfFirst = runNest(shared, 'shelf');
    runNest(shared, 'heuristic');
    expect(runNest(shared, 'shelf')).toEqual(shelfFirst);
  });
});

describe('the heuristic adapter', () => {
  it('gives the engine only what it reads, one entry per copy', () => {
    const input = toHeuristicInput(
      request({ pieces: [piece('a', 20, 30, { quantity: 2, rotation: 'quarter-turn' })] }),
    );
    expect(input.pieces).toHaveLength(2);
    expect(input.pieces[0]?.id).toBe('a');
    expect(input.pieces[0]?.layDirection).toBe('4way');
    expect(input.pieces[0]?.geometry).toEqual(rect(20, 30));
  });

  it('passes obstacles as pre-placed pieces with the identity transform', () => {
    // The polygon is already in marker space, so any transform would move it.
    const input = toHeuristicInput(request({ obstacles: [{ polygon: rect(30, 40) }] }));
    expect(input.placed).toHaveLength(1);
    expect(input.placed[0]?.position).toEqual({ x: 0, y: 0 });
    expect(input.placed[0]?.rotation).toBe(0);
    expect(input.placed[0]?.flipped).toBe(false);
    expect(input.placed[0]?.geometry).toEqual(rect(30, 40));
  });

  it('carries the cutter buffer across', () => {
    const input = toHeuristicInput(
      request({ spacing: { betweenPieces: 0.5, fromEdge: 0 } }),
    );
    expect(input.cutterBuffer).toBe(0.5);
  });

  it('takes the selvedge margin off both edges of the width it hands over', () => {
    const input = toHeuristicInput(
      request({ sheet: { width: 100 }, spacing: { betweenPieces: 0, fromEdge: 5 } }),
    );
    expect(input.fabricWidth).toBe(90);
  });
});

describe('spacing through the pipeline', () => {
  it.each(NEST_ENGINES)('%s keeps pieces off the selvedge', (engine) => {
    const pieces = [piece('a', 20, 30)];
    const plan = runNest(
      request({ pieces, spacing: { betweenPieces: 0, fromEdge: 5 } }),
      engine,
    );
    for (const placement of plan.placements) {
      const ys = outlineOf(placement, pieces).map((p) => p.y);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(5 - 1e-9);
      expect(Math.max(...ys)).toBeLessThanOrEqual(95 + 1e-9);
    }
  });

  it.each(NEST_ENGINES)('%s keeps clear of an obstacle', (engine) => {
    const pieces = [piece('a', 20, 30)];
    const blocker = rect(30, 100);
    const plan = runNest(request({ pieces, obstacles: [{ polygon: blocker }] }), engine);
    expect(plan.placements).toHaveLength(1);
    const outline = outlineOf(plan.placements[0]!, pieces);
    expect(satCollision(outline, blocker).collides).toBe(false);
  });
});

describe('requestFromMarker', () => {
  const tray = (id: string, quantity: number, placed: number): TrayPiece => ({
    id,
    name: 'Front',
    size: 'M',
    bundle: 'B1',
    fabricCode: 'A',
    geometry: rect(20, 30),
    layDirection: '2way',
    quantity,
    placed,
  });

  const onMarker = (id: string, at: Point): PlacedPiece => ({
    id,
    pieceDefId: 'def',
    name: 'Back',
    size: 'M',
    bundle: 'B1',
    fabricCode: 'A',
    geometry: rect(20, 30),
    position: at,
    rotation: 0,
    flipped: false,
    placed: true,
    blocked: false,
  });

  const marker = (over: Partial<MarkerDocument> = {}) => ({
    fabricWidth: 150,
    cutterBuffer: 0.5,
    pieces: [onMarker('p1', { x: 10, y: 10 })],
    defectZones: [{ id: 'd1', x: 0, y: 0, width: 5, height: 5 }],
    spliceLines: [{ id: 's1', x: 300 }],
    trayPieces: [tray('t1', 3, 1), tray('t2', 2, 2)],
    ...over,
  });

  it('takes the sheet width and the cutter buffer from the document', () => {
    const built = requestFromMarker(marker(), 3);
    expect(built.sheet.width).toBe(150);
    expect(built.spacing.betweenPieces).toBe(0.5);
    expect(built.effort).toBe(3);
  });

  it('asks only for pieces with something outstanding', () => {
    // t2 is fully placed, so nesting it again would duplicate work already done.
    const built = requestFromMarker(marker(), 1);
    expect(built.pieces.map((p) => p.id)).toEqual(['t1']);
    expect(built.pieces[0]?.quantity).toBe(2);
  });

  it('turns placed pieces and defect zones alike into obstacles', () => {
    const built = requestFromMarker(marker(), 1);
    expect(built.obstacles).toHaveLength(2);
  });

  it('places the placed-piece obstacle where the piece actually sits', () => {
    const built = requestFromMarker(marker(), 1);
    const xs = built.obstacles[0]!.polygon.map((p) => p.x);
    expect(Math.min(...xs)).toBe(10);
  });

  it('carries splice lines across', () => {
    expect(requestFromMarker(marker(), 1).spliceLines).toEqual([{ id: 's1', x: 300 }]);
  });
});

describe('toStorePlacements', () => {
  it('renames pieceId to the pieceDefId the store expects', () => {
    const plan = runNest(request({ pieces: [piece('a', 20, 30)] }), 'shelf');
    const stored = toStorePlacements(plan);
    expect(stored[0]?.pieceDefId).toBe('a');
    expect(stored[0]?.position).toEqual({ x: 0, y: 0 });
  });

  it('gives the same store shape whichever engine ran', () => {
    const pieces = [piece('a', 20, 30)];
    const keysFor = (engine: NestEngine) =>
      Object.keys(toStorePlacements(runNest(request({ pieces }), engine))[0] ?? {}).sort();
    expect(keysFor('shelf')).toEqual(keysFor('heuristic'));
    expect(keysFor('shelf')).toEqual(['flipped', 'pieceDefId', 'position', 'rotation']);
  });

  it('is empty for an empty plan', () => {
    expect(toStorePlacements(runNest(request(), 'shelf'))).toEqual([]);
  });
});
