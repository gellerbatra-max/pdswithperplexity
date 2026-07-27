import type { MarkerDocument, PlacedPiece, Point } from '@/marker/schema';

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
  name: string,
  geometry: Point[],
  position: Point,
): PlacedPiece => ({
  id,
  pieceDefId: `def-${id}`,
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

export const createSeedMarker = (): MarkerDocument => ({
  id: 'seed-marker',
  schemaVersion: 2,
  name: 'Untitled marker',
  fabricWidth: 150,
  endAllowance: 4,
  rotationRule: '90ok',
  cutterBuffer: 0.3,
  pieces: [
    piece('front', 'Front', rectangle(46, 62), { x: 10, y: 10 }),
    piece('back', 'Back', rectangle(46, 62), { x: 62, y: 10 }),
    piece('sleeve', 'Sleeve', sleeve(), { x: 114, y: 14 }),
  ],
  trayPieces: [],
  defectZones: [],
  spliceLines: [],
  order: { model: '', sizes: [] },
  approvalState: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
