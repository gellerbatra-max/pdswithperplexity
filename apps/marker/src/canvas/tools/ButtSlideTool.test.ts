import { describe, expect, it } from 'vitest';
import type { MarkerDocument, PlacedPiece, Point } from '@/marker/schema';
import { SLIDE_PRECISION_CM, buttSlide, canSlide } from './ButtSlideTool';

const rect = (width: number, height: number): Point[] => [
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
  name: 'Slide test',
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

describe('sliding into open space', () => {
  it('slides left to the marker origin when nothing is in the way', () => {
    const mover = piece('a', rect(10, 10), { x: 40, y: 20 });
    expect(buttSlide(doc([mover]), mover, 'left').x).toBeCloseTo(0, 6);
  });

  it('slides up to the far fabric edge when nothing is in the way', () => {
    const mover = piece('a', rect(10, 10), { x: 40, y: 20 });
    // 100 cm fabric, 10 cm piece: the furthest legal origin is y = 90.
    expect(buttSlide(doc([mover]), mover, 'up').y).toBeCloseTo(90, 6);
  });

  it('leaves the other axis alone', () => {
    const mover = piece('a', rect(10, 10), { x: 40, y: 20 });
    expect(buttSlide(doc([mover]), mover, 'left').y).toBeCloseTo(20, 6);
    expect(buttSlide(doc([mover]), mover, 'up').x).toBeCloseTo(40, 6);
  });

  it('does not move a piece already against the edge', () => {
    const mover = piece('a', rect(10, 10), { x: 0, y: 0 });
    expect(buttSlide(doc([mover]), mover, 'left')).toEqual({ x: 0, y: 0 });
  });
});

describe('sliding into an obstacle', () => {
  it('comes to rest against the piece it meets', () => {
    const wall = piece('wall', rect(10, 100), { x: 0, y: 0 });
    const mover = piece('a', rect(10, 10), { x: 50, y: 20 });

    const rest = buttSlide(doc([wall, mover]), mover, 'left');

    // The wall's far edge is x = 10, so the mover's origin lands there.
    expect(rest.x).toBeGreaterThanOrEqual(10 - SLIDE_PRECISION_CM);
    expect(rest.x).toBeLessThanOrEqual(10 + SLIDE_PRECISION_CM);
  });

  it('lands within 0.1 mm of contact', () => {
    const wall = piece('wall', rect(10, 100), { x: 0, y: 0 });
    const mover = piece('a', rect(10, 10), { x: 73.418, y: 20 });

    const rest = buttSlide(doc([wall, mover]), mover, 'left');

    expect(Math.abs(rest.x - 10)).toBeLessThanOrEqual(SLIDE_PRECISION_CM);
  });

  it('holds the cutter buffer at rest', () => {
    const wall = piece('wall', rect(10, 100), { x: 0, y: 0 });
    const mover = piece('a', rect(10, 10), { x: 50, y: 20 });

    const rest = buttSlide(doc([wall, mover], 0.5), mover, 'left');

    // 10 cm wall plus a 0.5 cm gap.
    expect(rest.x).toBeGreaterThanOrEqual(10.5 - SLIDE_PRECISION_CM);
  });

  it('stops against a defect zone', () => {
    const mover = piece('a', rect(10, 10), { x: 50, y: 20 });
    const document = doc([mover]);
    document.defectZones = [{ id: 'd1', x: 0, y: 0, width: 20, height: 100 }];

    expect(buttSlide(document, mover, 'left').x).toBeGreaterThanOrEqual(20 - SLIDE_PRECISION_CM);
  });

  it('stops below a piece when sliding up', () => {
    const ceiling = piece('ceiling', rect(100, 10), { x: 0, y: 60 });
    const mover = piece('a', rect(10, 10), { x: 20, y: 0 });

    const rest = buttSlide(doc([ceiling, mover]), mover, 'up');

    expect(rest.y).toBeGreaterThanOrEqual(50 - SLIDE_PRECISION_CM);
    expect(rest.y).toBeLessThanOrEqual(50 + SLIDE_PRECISION_CM);
  });

  it('ignores a piece that is not in the path', () => {
    // Sitting well above the mover's row, so it blocks nothing.
    const bystander = piece('other', rect(10, 10), { x: 0, y: 80 });
    const mover = piece('a', rect(10, 10), { x: 50, y: 20 });

    expect(buttSlide(doc([bystander, mover]), mover, 'left').x).toBeCloseTo(0, 6);
  });

  it('does not tunnel through an obstacle to open space beyond it', () => {
    // Sliding stops at the first thing hit, even though x = 0 is clear.
    const wall = piece('wall', rect(5, 100), { x: 30, y: 0 });
    const mover = piece('a', rect(10, 10), { x: 60, y: 20 });

    expect(buttSlide(doc([wall, mover]), mover, 'left').x).toBeGreaterThanOrEqual(
      35 - SLIDE_PRECISION_CM,
    );
  });
});

describe('rotated pieces', () => {
  it('slides on the rotated outline, not the original', () => {
    const mover: PlacedPiece = { ...piece('a', rect(40, 10), { x: 50, y: 20 }), rotation: 90 };
    // Turned 90°, the outline spans x from -10 to 0, so its left edge is at
    // position.x - 10 and it can travel that much further.
    const rest = buttSlide(doc([mover]), mover, 'left');
    expect(rest.x).toBeCloseTo(10, 6);
  });
});

describe('canSlide', () => {
  it('is false at the edge and true away from it', () => {
    expect(canSlide(doc([]), piece('a', rect(10, 10), { x: 0, y: 0 }), 'left')).toBe(false);
    expect(canSlide(doc([]), piece('a', rect(10, 10), { x: 5, y: 0 }), 'left')).toBe(true);
  });

  it('is false for a piece already at the far fabric edge', () => {
    expect(canSlide(doc([]), piece('a', rect(10, 10), { x: 0, y: 90 }), 'up')).toBe(false);
  });
});
