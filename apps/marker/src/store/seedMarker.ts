import type { MarkerDocument, PlacedPiece, Point, TrayPiece } from '@/marker/schema';

/**
 * A 150 cm marker with three test pieces, following the seedDocument pattern
 * in PDS.
 *
 * The shapes are convex on purpose: the SAT narrow phase is only sound for
 * convex polygons, so a concave test piece would exercise a known-broken path
 * rather than the drag behaviour these are here to prove. See the TODO in
 * canvas/collision/sat.ts.
 *
 * TODO(step-7): replace with a real DXF import once the tray can be populated
 * from a file.
 */

const rectangle = (width: number, height: number): Point[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

/** A tapered sleeve — still convex, but not a box. */
const sleeve = (): Point[] => [
  { x: 0, y: 0 },
  { x: 34, y: 6 },
  { x: 34, y: 42 },
  { x: 0, y: 52 },
];

const piece = (
  id: string,
  trayPieceId: string,
  name: string,
  geometry: Point[],
  position: Point,
): PlacedPiece => ({
  id,
  // Must name a real tray entry: returning a piece to the tray credits this
  // id, and the rotation step is read from the tray piece's lay direction.
  // An invented id makes both silently do nothing.
  pieceDefId: trayPieceId,
  name,
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

const tray = (
  id: string,
  name: string,
  bundle: string,
  geometry: Point[],
  placed: number,
): TrayPiece => ({
  id,
  name,
  size: 'M',
  bundle,
  fabricCode: 'A',
  geometry,
  layDirection: '2way',
  quantity: 1,
  placed,
});

export const createSeedMarker = (): MarkerDocument => ({
  id: 'seed-marker',
  schemaVersion: 3,
  name: 'Untitled marker',
  fabricWidth: 150,
  endAllowance: 4,
  rotationRule: '90ok',
  cutterBuffer: 0.3,
  pieces: [
    piece('front', 'front-1', 'Front', rectangle(46, 62), { x: 10, y: 10 }),
    piece('back', 'back-1', 'Back', rectangle(46, 62), { x: 62, y: 10 }),
    piece('sleeve', 'sleeve-1', 'Sleeve', sleeve(), { x: 114, y: 14 }),
  ],
  // Two bundles of the same three pieces: the first is fully placed, the
  // second is not. That makes the marker PARTIAL with one complete garment,
  // so the ribbon shows a real utilisation and consumption rather than zero.
  trayPieces: [
    tray('front-1', 'Front', 'B1', rectangle(46, 62), 1),
    tray('back-1', 'Back', 'B1', rectangle(46, 62), 1),
    tray('sleeve-1', 'Sleeve', 'B1', sleeve(), 1),
    tray('front-2', 'Front', 'B2', rectangle(46, 62), 0),
    tray('back-2', 'Back', 'B2', rectangle(46, 62), 0),
    tray('sleeve-2', 'Sleeve', 'B2', sleeve(), 0),
  ],
  defectZones: [],
  spliceLines: [],
  order: {
    model: 'TEE-100',
    sizes: [{ size: 'M', quantity: 2, fabricCode: 'A' }],
  },
  approvalState: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
});
