import { describe, expect, it } from 'vitest';
import type { MarkerDocument, PlacedPiece, Point } from './schema';
import { findViolations } from './violations';

const rect = (width: number, height: number): Point[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

const piece = (id: string, position: Point, overrides: Partial<PlacedPiece> = {}): PlacedPiece => ({
  id,
  pieceDefId: `def-${id}`,
  name: id,
  size: 'M',
  bundle: 'B1',
  fabricCode: 'A',
  geometry: rect(10, 10),
  position,
  rotation: 0,
  flipped: false,
  placed: true,
  blocked: false,
  ...overrides,
});

const doc = (pieces: PlacedPiece[], cutterBuffer: 0 | 0.3 | 0.5 | 1 = 0): MarkerDocument => ({
  id: 'doc-1',
  schemaVersion: 3,
  name: 'Violations',
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

describe('clean markers', () => {
  it('reports nothing for an empty marker', () => {
    expect(findViolations(doc([])).size).toBe(0);
  });

  it('reports nothing for pieces that are apart', () => {
    const document = doc([piece('a', { x: 0, y: 0 }), piece('b', { x: 40, y: 0 })]);
    expect(findViolations(document).size).toBe(0);
  });

  it('allows pieces butted exactly edge to edge', () => {
    // The normal case in a tight marker; flagging it would light up the whole
    // spread the moment it got good.
    const document = doc([piece('a', { x: 0, y: 0 }), piece('b', { x: 10, y: 0 })]);
    expect(findViolations(document).size).toBe(0);
  });
});

describe('overlaps', () => {
  it('flags both pieces, not just the newcomer', () => {
    const document = doc([piece('a', { x: 0, y: 0 }), piece('b', { x: 5, y: 0 })]);
    expect([...findViolations(document)].sort()).toEqual(['a', 'b']);
  });

  it('flags every piece in a pile', () => {
    // What clicking a tray row three times looks like: all at the origin.
    const document = doc([
      piece('a', { x: 0, y: 0 }),
      piece('b', { x: 0, y: 0 }),
      piece('c', { x: 0, y: 0 }),
    ]);
    expect(findViolations(document).size).toBe(3);
  });

  it('flags only the pieces actually touching', () => {
    const document = doc([
      piece('a', { x: 0, y: 0 }),
      piece('b', { x: 5, y: 0 }),
      piece('clear', { x: 60, y: 0 }),
    ]);
    const violations = findViolations(document);
    expect(violations.has('clear')).toBe(false);
    expect(violations.size).toBe(2);
  });

  it('sees an overlap created by rotation', () => {
    const rotated = piece('a', { x: 20, y: 0 }, { geometry: rect(40, 10), rotation: 90 });
    // Turned, it reaches back across its neighbour.
    const document = doc([rotated, piece('b', { x: 10, y: 10 })]);
    expect(findViolations(document).size).toBe(2);
  });
});

describe('the cutter buffer', () => {
  it('flags pieces closer than the buffer even without an overlap', () => {
    const document = doc([piece('a', { x: 0, y: 0 }), piece('b', { x: 10.2, y: 0 })], 0.5);
    expect(findViolations(document).size).toBe(2);
  });

  it('accepts pieces exactly the buffer apart', () => {
    const document = doc([piece('a', { x: 0, y: 0 }), piece('b', { x: 10.5, y: 0 })], 0.5);
    expect(findViolations(document).size).toBe(0);
  });

  it('uses the wider of the two buffers', () => {
    // A piece with its own keep-out does not lose it beside one with none.
    const fussy = piece('a', { x: 0, y: 0 }, { bufferOverride: 2 });
    const document = doc([fussy, piece('b', { x: 11, y: 0 })], 0);
    expect(findViolations(document).size).toBe(2);
  });
});

describe('defect zones', () => {
  it('flags a piece sitting on a defect', () => {
    const document = doc([piece('a', { x: 0, y: 0 })]);
    document.defectZones = [{ id: 'd1', x: 5, y: 5, width: 20, height: 20 }];
    expect([...findViolations(document)]).toEqual(['a']);
  });

  it('ignores a defect the piece clears', () => {
    const document = doc([piece('a', { x: 0, y: 0 })]);
    document.defectZones = [{ id: 'd1', x: 50, y: 50, width: 20, height: 20 }];
    expect(findViolations(document).size).toBe(0);
  });
});

describe('the fabric edge', () => {
  it('is not a violation', () => {
    // Deliberately: a piece can only get outside the edge by being put there,
    // and flagging the boundary would fire during ordinary work at the selvedge.
    const document = doc([piece('a', { x: 0, y: 95 })]);
    expect(findViolations(document).size).toBe(0);
  });
});
