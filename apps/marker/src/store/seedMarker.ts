import type { MarkerDocument } from '@/marker/schema';

/**
 * A blank 150 cm marker, following the seedDocument pattern in PDS.
 *
 * TODO(step-7): replace with a real DXF import once the tray can be populated
 * from a file. Until then this is what the canvas has to render.
 */
export const createSeedMarker = (): MarkerDocument => ({
  id: 'seed-marker',
  schemaVersion: 2,
  name: 'Untitled marker',
  fabricWidth: 150,
  endAllowance: 4,
  rotationRule: '90ok',
  cutterBuffer: 0.3,
  pieces: [],
  trayPieces: [],
  defectZones: [],
  spliceLines: [],
  order: { model: '', sizes: [] },
  approvalState: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});
