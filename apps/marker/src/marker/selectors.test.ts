import { describe, expect, it } from 'vitest';
import type { MarkerDocument, PlacedPiece, Point, TrayPiece } from './schema';
import {
  consumption,
  garmentCount,
  markerArea,
  markerLength,
  markerStatus,
  placedPieceArea,
  utilization,
} from './selectors';

const rect = (width: number, height: number): Point[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

const placedPiece = (id: string, geometry: Point[], position: Point): PlacedPiece => ({
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

const trayPiece = (id: string, bundle: string, quantity: number, placed: number): TrayPiece => ({
  id,
  name: id,
  size: 'M',
  bundle,
  fabricCode: 'A',
  geometry: rect(10, 10),
  layDirection: 'free',
  quantity,
  placed,
});

/** Fresh empty document — 100 cm fabric, nothing placed. */
const emptyDoc = (): MarkerDocument => ({
  id: 'doc-1',
  schemaVersion: 3,
  name: 'Test marker',
  fabricWidth: 100,
  endAllowance: 4,
  rotationRule: 'free',
  cutterBuffer: 0,
  pieces: [],
  trayPieces: [],
  defectZones: [],
  spliceLines: [],
  order: { model: 'TEE-100', sizes: [] },
  approvalState: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
});

/** Two 10×10 squares, the second offset 20 cm along the fabric. */
const twoSquareDoc = (): MarkerDocument => {
  const doc = emptyDoc();
  doc.pieces = [
    placedPiece('a', rect(10, 10), { x: 0, y: 0 }),
    placedPiece('b', rect(10, 10), { x: 20, y: 0 }),
  ];
  return doc;
};

describe('markerLength', () => {
  it('is zero when nothing is placed', () => {
    expect(markerLength(emptyDoc())).toBe(0);
  });

  it('reaches the far edge of the furthest piece', () => {
    expect(markerLength(twoSquareDoc())).toBe(30);
  });

  it('measures the rotated width, not the original width', () => {
    const doc = emptyDoc();
    const piece = placedPiece('wide', rect(20, 10), { x: 0, y: 0 });
    piece.rotation = 90;
    doc.pieces = [piece];
    // A 20×10 rectangle turned 90° occupies 10 cm along the fabric.
    expect(markerLength(doc)).toBeCloseTo(10, 10);
  });

  it('is unchanged by a horizontal flip', () => {
    const doc = emptyDoc();
    const piece = placedPiece('wide', rect(20, 10), { x: 5, y: 0 });
    piece.flipped = true;
    doc.pieces = [piece];
    expect(markerLength(doc)).toBeCloseTo(25, 10);
  });
});

describe('markerArea', () => {
  it('is fabric width times marker length', () => {
    expect(markerArea(twoSquareDoc())).toBe(3000);
  });

  it('is zero on an empty marker', () => {
    expect(markerArea(emptyDoc())).toBe(0);
  });
});

describe('placedPieceArea', () => {
  it('sums the polygon areas of every placed piece', () => {
    expect(placedPieceArea(twoSquareDoc())).toBe(200);
  });

  it('ignores degenerate polygons with fewer than three points', () => {
    const doc = emptyDoc();
    doc.pieces = [
      placedPiece('line', [{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: 0, y: 0 }),
    ];
    expect(placedPieceArea(doc)).toBe(0);
  });

  it('measures a triangle correctly', () => {
    const doc = emptyDoc();
    doc.pieces = [
      placedPiece(
        't',
        [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 0, y: 10 },
        ],
        { x: 0, y: 0 },
      ),
    ];
    expect(placedPieceArea(doc)).toBe(50);
  });

  it('is unaffected by rotation and flip, which preserve area', () => {
    const doc = twoSquareDoc();
    const [first] = doc.pieces;
    if (!first) throw new Error('fixture must have a piece');
    first.rotation = 37;
    first.flipped = true;
    expect(placedPieceArea(doc)).toBeCloseTo(200, 10);
  });
});

describe('utilization', () => {
  it('reports the covered percentage', () => {
    // 200 cm² of pieces on a 3000 cm² marker.
    expect(utilization(twoSquareDoc())).toBeCloseTo(200 / 30, 10);
  });

  it('is zero rather than NaN when the marker has no area', () => {
    expect(utilization(emptyDoc())).toBe(0);
  });

  it('reaches 100 when pieces tile the marker exactly', () => {
    const doc = emptyDoc();
    doc.fabricWidth = 10;
    doc.pieces = [placedPiece('full', rect(10, 10), { x: 0, y: 0 })];
    expect(utilization(doc)).toBeCloseTo(100, 10);
  });
});

describe('garmentCount', () => {
  it('is zero with no tray pieces', () => {
    expect(garmentCount(emptyDoc())).toBe(0);
  });

  it('counts only bundles with every piece placed', () => {
    const doc = emptyDoc();
    doc.trayPieces = [
      trayPiece('front-1', 'B1', 1, 1),
      trayPiece('back-1', 'B1', 1, 1),
      trayPiece('front-2', 'B2', 1, 1),
      trayPiece('sleeve-2', 'B2', 2, 1),
    ];
    // B1 is complete; B2 is one sleeve short.
    expect(garmentCount(doc)).toBe(1);
  });

  it('counts a bundle whose pieces are over-placed', () => {
    const doc = emptyDoc();
    doc.trayPieces = [trayPiece('front', 'B1', 2, 3)];
    expect(garmentCount(doc)).toBe(1);
  });
});

describe('consumption', () => {
  it('is metres of fabric per garment', () => {
    const doc = twoSquareDoc();
    doc.trayPieces = [trayPiece('front', 'B1', 1, 1)];
    // (30 cm marker + 4 cm allowance) / 100 = 0.34 m for one garment.
    expect(consumption(doc)).toBeCloseTo(0.34, 10);
  });

  it('divides across garments', () => {
    const doc = twoSquareDoc();
    doc.trayPieces = [trayPiece('front', 'B1', 1, 1), trayPiece('front', 'B2', 1, 1)];
    expect(consumption(doc)).toBeCloseTo(0.17, 10);
  });

  it('is zero rather than Infinity when no garment is complete', () => {
    const doc = twoSquareDoc();
    doc.trayPieces = [trayPiece('front', 'B1', 2, 1)];
    expect(consumption(doc)).toBe(0);
  });
});

describe('markerStatus', () => {
  it('is UNMADE when nothing is placed', () => {
    expect(markerStatus(emptyDoc())).toBe('UNMADE');
  });

  it('is UNMADE for an empty document even though no tray piece is outstanding', () => {
    const doc = emptyDoc();
    doc.trayPieces = [];
    expect(markerStatus(doc)).toBe('UNMADE');
  });

  it('is MADE when every tray quantity is placed', () => {
    const doc = twoSquareDoc();
    doc.trayPieces = [trayPiece('front', 'B1', 1, 1), trayPiece('back', 'B1', 1, 1)];
    expect(markerStatus(doc)).toBe('MADE');
  });

  it('is PARTIAL when some quantity is outstanding', () => {
    const doc = twoSquareDoc();
    doc.trayPieces = [trayPiece('front', 'B1', 1, 1), trayPiece('back', 'B1', 2, 1)];
    expect(markerStatus(doc)).toBe('PARTIAL');
  });
});
