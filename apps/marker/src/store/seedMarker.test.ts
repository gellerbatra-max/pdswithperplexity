import { describe, expect, it } from 'vitest';
import { createSeedMarker } from './seedMarker';

describe('the seeded marker', () => {
  it('links every placed piece to a real tray entry', () => {
    // Regression: placed pieces carried an invented `def-front` id while the
    // tray held `front-1`. Nothing errored — returning a piece to the tray
    // just credited nobody, and the rotation step fell back to a default.
    const marker = createSeedMarker();
    const trayIds = new Set(marker.trayPieces.map((piece) => piece.id));

    for (const piece of marker.pieces) {
      expect(trayIds.has(piece.pieceDefId)).toBe(true);
    }
  });

  it('counts each placed piece against its tray entry', () => {
    const marker = createSeedMarker();
    for (const tray of marker.trayPieces) {
      const placed = marker.pieces.filter((piece) => piece.pieceDefId === tray.id).length;
      expect(tray.placed).toBe(placed);
    }
  });

  it('never claims more placed than the quantity ordered', () => {
    for (const tray of createSeedMarker().trayPieces) {
      expect(tray.placed).toBeLessThanOrEqual(tray.quantity);
    }
  });

  it('is a current-schema document', () => {
    const marker = createSeedMarker();
    expect(marker.schemaVersion).toBe(3);
    expect(marker.lastOpenedAt).toBeTruthy();
  });
});
