import { describe, expect, it } from 'vitest';
import { arrangeRecent, matchesMarker, summarise } from './recent';
import type { MarkerDocument, PlacedPiece, Point } from './schema';

const rect = (w: number, h: number): Point[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

const piece = (id: string, position: Point, size = 40): PlacedPiece => ({
  id,
  pieceDefId: 't1',
  name: 'Front',
  size: 'M',
  bundle: 'B1',
  fabricCode: 'A',
  geometry: rect(size, size),
  position,
  rotation: 0,
  flipped: false,
  placed: true,
  blocked: false,
});

const marker = (
  id: string,
  overrides: Partial<MarkerDocument> = {},
): MarkerDocument => ({
  id,
  schemaVersion: 3,
  name: id,
  fabricWidth: 100,
  endAllowance: 4,
  rotationRule: 'free',
  cutterBuffer: 0,
  pieces: [],
  trayPieces: [],
  defectZones: [],
  spliceLines: [],
  order: { model: '', sizes: [] },
  approvalState: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('matchesMarker', () => {
  it('matches everything on an empty query', () => {
    expect(matchesMarker(marker('m1'), '')).toBe(true);
    expect(matchesMarker(marker('m1'), '   ')).toBe(true);
  });

  it('matches on the name', () => {
    expect(matchesMarker(marker('m1', { name: 'Spring tee' }), 'spring')).toBe(true);
  });

  it('matches on the order model', () => {
    const m = marker('m1', { order: { model: 'TEE-900', sizes: [] } });
    expect(matchesMarker(m, 'tee-900')).toBe(true);
  });

  it('matches on the status, which is what a card shows', () => {
    // An empty marker is UNMADE, so "unmade" should find it.
    expect(matchesMarker(marker('m1'), 'unmade')).toBe(true);
  });

  it('ignores case', () => {
    expect(matchesMarker(marker('m1', { name: 'Spring tee' }), 'SPRING')).toBe(true);
  });

  it('rejects what it does not contain', () => {
    expect(matchesMarker(marker('m1', { name: 'Spring tee' }), 'winter')).toBe(false);
  });
});

describe('arrangeRecent', () => {
  const set = () => [
    marker('a', { name: 'Zebra', lastOpenedAt: '2026-06-01T00:00:00.000Z', createdAt: '2026-05-01T00:00:00.000Z' }),
    marker('b', { name: 'apple', lastOpenedAt: '2026-06-03T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }),
    marker('c', { name: 'Mango', lastOpenedAt: '2026-06-02T00:00:00.000Z', createdAt: '2026-03-01T00:00:00.000Z' }),
  ];

  it('defaults to most recently opened first', () => {
    expect(arrangeRecent(set()).map((m) => m.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by name without being case-sensitive', () => {
    // A code-point sort would put "Zebra" before "apple".
    expect(arrangeRecent(set(), { sort: 'name' }).map((m) => m.name)).toEqual([
      'apple',
      'Mango',
      'Zebra',
    ]);
  });

  it('sorts by creation date, newest first', () => {
    expect(arrangeRecent(set(), { sort: 'created' }).map((m) => m.id)).toEqual(['a', 'c', 'b']);
  });

  it('sorts by utilisation, best first', () => {
    const busy = marker('busy', { pieces: [piece('p1', { x: 0, y: 0 })] });
    const idle = marker('idle');
    expect(arrangeRecent([idle, busy], { sort: 'utilisation' }).map((m) => m.id)).toEqual([
      'busy',
      'idle',
    ]);
  });

  it('filters before it sorts', () => {
    const arranged = arrangeRecent(set(), { query: 'a', sort: 'name' });
    // "Zebra", "apple" and "Mango" all contain an "a".
    expect(arranged.map((m) => m.name)).toEqual(['apple', 'Mango', 'Zebra']);
  });

  it('returns nothing when the query matches nothing', () => {
    expect(arrangeRecent(set(), { query: 'zzzz' })).toEqual([]);
  });

  it('does not mutate the list it was given', () => {
    const original = set();
    const before = original.map((m) => m.id);
    arrangeRecent(original, { sort: 'name' });
    expect(original.map((m) => m.id)).toEqual(before);
  });

  it('handles an empty list', () => {
    expect(arrangeRecent([])).toEqual([]);
  });
});

describe('summarise', () => {
  it('counts markers, placed pieces and completed markers', () => {
    const empty = marker('a');
    const withPieces = marker('b', { pieces: [piece('p1', { x: 0, y: 0 }), piece('p2', { x: 60, y: 0 })] });
    const total = summarise([empty, withPieces]);
    expect(total.markers).toBe(2);
    expect(total.pieces).toBe(2);
    // 'b' has pieces and no outstanding tray, so it reads as MADE.
    expect(total.made).toBe(1);
  });

  it('is all zeroes for an empty list', () => {
    expect(summarise([])).toEqual({ markers: 0, pieces: 0, made: 0 });
  });
});
