import { describe, expect, it } from 'vitest';
import { placedGeometry } from '@/marker/pieceGeometry';
import type { MarkerDocument, PlacedPiece, Point } from '@/marker/schema';
import { satCollision } from '../collision/sat';
import { obstaclesFor, resolveDragPosition } from './DragTool';

const rectangle = (width: number, height: number): Point[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

const piece = (id: string, geometry: Point[], position: Point): PlacedPiece => ({
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

const doc = (pieces: PlacedPiece[], cutterBuffer: 0 | 0.3 | 0.5 | 1 = 0): MarkerDocument => ({
  id: 'doc-1',
  schemaVersion: 3,
  name: 'Test',
  fabricWidth: 100,
  endAllowance: 4,
  rotationRule: 'free',
  cutterBuffer,
  pieces,
  trayPieces: [],
  defectZones: [],
  spliceLines: [],
  order: { model: '', sizes: [] },
  approvalState: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
});

/** True when the moved piece is clear of every convex part of every obstacle. */
const isClear = (document: MarkerDocument, moved: PlacedPiece, at: Point): boolean => {
  const polygon = placedGeometry({ ...moved, position: at });
  return obstaclesFor(document, moved.id).every((obstacle) =>
    obstacle.parts.every((part) => !satCollision(polygon, part).collides),
  );
};

describe('resolveDragPosition — free movement', () => {
  it('leaves a legal position alone', () => {
    const mover = piece('a', rectangle(10, 10), { x: 0, y: 0 });
    const document = doc([mover]);
    expect(resolveDragPosition(document, mover, { x: 40, y: 40 })).toEqual({ x: 40, y: 40 });
  });

  it('ignores the dragged piece itself as an obstacle', () => {
    const mover = piece('a', rectangle(10, 10), { x: 20, y: 20 });
    const document = doc([mover]);
    // Barely moved — it would collide with its own previous outline.
    expect(resolveDragPosition(document, mover, { x: 21, y: 20 })).toEqual({ x: 21, y: 20 });
  });
});

describe('resolveDragPosition — fabric bounds', () => {
  it('stops a piece leaving the near edge', () => {
    const mover = piece('a', rectangle(10, 10), { x: 0, y: 0 });
    expect(resolveDragPosition(doc([mover]), mover, { x: 30, y: -12 }).y).toBe(0);
  });

  it('stops a piece crossing the fabric width', () => {
    const mover = piece('a', rectangle(10, 10), { x: 0, y: 0 });
    // 100 cm fabric, 10 cm piece — the furthest legal origin is y = 90.
    expect(resolveDragPosition(doc([mover]), mover, { x: 30, y: 140 }).y).toBe(90);
  });

  it('stops a piece going behind the marker origin', () => {
    const mover = piece('a', rectangle(10, 10), { x: 0, y: 0 });
    expect(resolveDragPosition(doc([mover]), mover, { x: -30, y: 20 }).x).toBe(0);
  });

  it('has no far x bound, so the marker can grow', () => {
    const mover = piece('a', rectangle(10, 10), { x: 0, y: 0 });
    expect(resolveDragPosition(doc([mover]), mover, { x: 5000, y: 20 }).x).toBe(5000);
  });

  it('rests an oversized piece on the near edge instead of floating it', () => {
    const tall = piece('a', rectangle(10, 140), { x: 0, y: 0 });
    expect(resolveDragPosition(doc([tall]), tall, { x: 10, y: 60 }).y).toBe(0);
  });
});

describe('resolveDragPosition — pieces', () => {
  it('pushes a piece clear of another', () => {
    const obstacle = piece('fixed', rectangle(10, 10), { x: 0, y: 0 });
    const mover = piece('a', rectangle(10, 10), { x: 40, y: 0 });
    const document = doc([obstacle, mover]);

    const resolved = resolveDragPosition(document, mover, { x: 5, y: 0 });
    // 5 cm into a 10 cm square across x, 10 cm across y — out through x.
    expect(resolved.x).toBeCloseTo(10, 10);
    expect(isClear(document, mover, resolved)).toBe(true);
  });

  it('holds the cutter buffer as a gap', () => {
    const obstacle = piece('fixed', rectangle(10, 10), { x: 0, y: 0 });
    const mover = piece('a', rectangle(10, 10), { x: 40, y: 0 });
    const document = doc([obstacle, mover], 0.5);

    const resolved = resolveDragPosition(document, mover, { x: 5, y: 0 });
    expect(resolved.x).toBeCloseTo(10.5, 10);
  });

  it('prefers a per-piece buffer override', () => {
    const obstacle = piece('fixed', rectangle(10, 10), { x: 0, y: 0 });
    const mover: PlacedPiece = { ...piece('a', rectangle(10, 10), { x: 40, y: 0 }), bufferOverride: 1 };
    const document = doc([obstacle, mover], 0.3);

    expect(resolveDragPosition(document, mover, { x: 5, y: 0 }).x).toBeCloseTo(11, 10);
  });

  it('resolves against several pieces at once', () => {
    const left = piece('left', rectangle(10, 10), { x: 0, y: 0 });
    const right = piece('right', rectangle(10, 10), { x: 20, y: 0 });
    const mover = piece('a', rectangle(8, 8), { x: 60, y: 60 });
    const document = doc([left, right, mover]);

    const resolved = resolveDragPosition(document, mover, { x: 9, y: 2 });
    expect(isClear(document, mover, resolved)).toBe(true);
  });

  it('keeps a piece on the fabric while pushing it clear', () => {
    const obstacle = piece('fixed', rectangle(10, 10), { x: 0, y: 0 });
    const mover = piece('a', rectangle(10, 10), { x: 50, y: 50 });
    const document = doc([obstacle, mover]);

    const resolved = resolveDragPosition(document, mover, { x: 2, y: -4 });
    expect(resolved.y).toBeGreaterThanOrEqual(0);
    expect(resolved.y).toBeLessThanOrEqual(90);
  });
});

describe('resolveDragPosition — zones and splices', () => {
  it('treats a defect zone as solid', () => {
    const mover = piece('a', rectangle(10, 10), { x: 60, y: 60 });
    const document = doc([mover]);
    document.defectZones = [{ id: 'd1', x: 0, y: 0, width: 20, height: 20 }];

    const resolved = resolveDragPosition(document, mover, { x: 15, y: 5 });
    expect(isClear(document, mover, resolved)).toBe(true);
  });

  it('never leaves a piece straddling a splice line', () => {
    const mover = piece('a', rectangle(10, 10), { x: 60, y: 60 });
    const document = doc([mover]);
    document.spliceLines = [{ id: 's1', x: 30 }];

    // Aimed straight at the splice, at the far side of the fabric.
    const resolved = resolveDragPosition(document, mover, { x: 26, y: 80 });
    const straddles = resolved.x < 30 && resolved.x + 10 > 30;
    expect(straddles).toBe(false);
  });

  it('sends a straddling piece to the nearer side of the splice', () => {
    const mover = piece('a', rectangle(10, 10), { x: 60, y: 60 });
    const document = doc([mover]);
    document.spliceLines = [{ id: 's1', x: 30 }];

    // Only 2 cm across the line — the shorter trip is back, to end flush at 30.
    expect(resolveDragPosition(document, mover, { x: 22, y: 40 }).x).toBeCloseTo(20, 10);
    // Almost entirely past it — the shorter trip is forward, to start at 30.
    expect(resolveDragPosition(document, mover, { x: 29, y: 40 }).x).toBeCloseTo(30, 10);
  });
});

describe('obstaclesFor', () => {
  it('covers the other pieces and the defect zones', () => {
    const mover = piece('a', rectangle(10, 10), { x: 0, y: 0 });
    const other = piece('b', rectangle(10, 10), { x: 40, y: 0 });
    const document = doc([mover, other]);
    document.defectZones = [{ id: 'd1', x: 0, y: 0, width: 5, height: 5 }];
    // Splice lines are constraints, not obstacles — they must not appear here.
    document.spliceLines = [{ id: 's1', x: 70 }];

    expect(obstaclesFor(document, 'a')).toHaveLength(2);
  });

  it('applies rotation and flip when building an obstacle', () => {
    const rotated: PlacedPiece = {
      ...piece('b', rectangle(20, 10), { x: 0, y: 0 }),
      rotation: 90,
    };
    const document = doc([rotated]);
    const [obstacle] = obstaclesFor(document, 'other');
    if (!obstacle) throw new Error('expected an obstacle');
    // A 20×10 rectangle turned 90° is 10 wide and 20 tall.
    expect(obstacle.bounds.maxX - obstacle.bounds.minX).toBeCloseTo(10, 10);
    expect(obstacle.bounds.maxY - obstacle.bounds.minY).toBeCloseTo(20, 10);
  });
});
