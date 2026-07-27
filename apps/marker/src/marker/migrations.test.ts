import { describe, expect, it } from 'vitest';
import { MigrationError, migrate } from './migrations';

describe('migrate', () => {
  it('rejects input that is not a document', () => {
    expect(() => migrate(null)).toThrow(MigrationError);
    expect(() => migrate('a marker')).toThrow(MigrationError);
    expect(() => migrate([])).toThrow(MigrationError);
  });

  it('rejects a document written by a newer build', () => {
    expect(() => migrate({ id: 'm1', schemaVersion: 4 })).toThrow(/newer than this build/);
  });

  it('rejects a document with no id, which could never be reopened', () => {
    expect(() => migrate({ schemaVersion: 2 })).toThrow(/missing an id/);
  });

  it('stamps the current schema version', () => {
    expect(migrate({ id: 'm1' }).schemaVersion).toBe(3);
  });

  it('carries a v2 document forward by seeding lastOpenedAt from updatedAt', () => {
    const doc = migrate({
      id: 'm1',
      schemaVersion: 2,
      updatedAt: '2026-05-02T00:00:00.000Z',
    });
    expect(doc.schemaVersion).toBe(3);
    // A v2 document has no record of being opened; when it was last written
    // is the closest honest answer, and keeps it in sensible sort order.
    expect(doc.lastOpenedAt).toBe('2026-05-02T00:00:00.000Z');
  });

  it('keeps an explicit lastOpenedAt when the document already has one', () => {
    const doc = migrate({
      id: 'm1',
      schemaVersion: 3,
      updatedAt: '2026-05-02T00:00:00.000Z',
      lastOpenedAt: '2026-06-09T00:00:00.000Z',
    });
    expect(doc.lastOpenedAt).toBe('2026-06-09T00:00:00.000Z');
  });

  it('falls back to the epoch when a document has neither timestamp', () => {
    expect(migrate({ id: 'm1' }).lastOpenedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('fills defaults for everything a v1 document lacks', () => {
    const doc = migrate({ id: 'm1', schemaVersion: 1, name: 'Old marker' });
    expect(doc.name).toBe('Old marker');
    expect(doc.endAllowance).toBe(4);
    expect(doc.cutterBuffer).toBe(0);
    expect(doc.rotationRule).toBe('strict');
    expect(doc.approvalState).toBe('draft');
    expect(doc.pieces).toEqual([]);
    expect(doc.trayPieces).toEqual([]);
    expect(doc.order).toEqual({ model: '', sizes: [] });
  });

  it('preserves values that are already present', () => {
    const doc = migrate({
      id: 'm1',
      schemaVersion: 2,
      name: 'Shirt',
      fabricWidth: 150,
      endAllowance: 6,
      rotationRule: '90ok',
      cutterBuffer: 0.5,
      approvalState: 'approved',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-02T00:00:00.000Z',
    });
    expect(doc.fabricWidth).toBe(150);
    expect(doc.endAllowance).toBe(6);
    expect(doc.rotationRule).toBe('90ok');
    expect(doc.cutterBuffer).toBe(0.5);
    expect(doc.approvalState).toBe('approved');
    expect(doc.createdAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('falls back to a recognisable epoch when timestamps are absent', () => {
    const doc = migrate({ id: 'm1' });
    expect(doc.createdAt).toBe('1970-01-01T00:00:00.000Z');
    expect(doc.updatedAt).toBe('1970-01-01T00:00:00.000Z');
  });

  it('rejects out-of-range enum values instead of trusting them', () => {
    const doc = migrate({ id: 'm1', rotationRule: 'sideways', cutterBuffer: 0.7 });
    expect(doc.rotationRule).toBe('strict');
    expect(doc.cutterBuffer).toBe(0);
  });

  it('restores placed pieces and marks them placed', () => {
    const doc = migrate({
      id: 'm1',
      pieces: [
        {
          id: 'p1',
          name: 'Front',
          geometry: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
          position: { x: 5, y: 5 },
          rotation: 90,
          flipped: true,
          cutSequence: 3,
        },
      ],
    });
    const [piece] = doc.pieces;
    if (!piece) throw new Error('expected one piece');
    expect(piece.id).toBe('p1');
    expect(piece.placed).toBe(true);
    expect(piece.geometry).toHaveLength(3);
    expect(piece.position).toEqual({ x: 5, y: 5 });
    expect(piece.rotation).toBe(90);
    expect(piece.flipped).toBe(true);
    expect(piece.cutSequence).toBe(3);
    expect(piece.fabricCode).toBe('A');
  });

  it('omits absent optional fields rather than setting them undefined', () => {
    const doc = migrate({ id: 'm1', pieces: [{ id: 'p1' }] });
    const [piece] = doc.pieces;
    if (!piece) throw new Error('expected one piece');
    expect('cutSequence' in piece).toBe(false);
    expect('bufferOverride' in piece).toBe(false);
    expect('comparison' in doc).toBe(false);
  });

  it('gives id-less pieces a deterministic id from their position in the list', () => {
    const doc = migrate({ id: 'm1', pieces: [{}, {}] });
    expect(doc.pieces.map((piece) => piece.id)).toEqual(['piece-0', 'piece-1']);
  });

  it('discards non-array collections instead of throwing', () => {
    const doc = migrate({ id: 'm1', pieces: 'not an array', trayPieces: 42 });
    expect(doc.pieces).toEqual([]);
    expect(doc.trayPieces).toEqual([]);
  });

  it('carries a comparison layer across when one is present', () => {
    const doc = migrate({
      id: 'm1',
      comparison: { markerName: 'Previous', opacity: 0.4, visible: false, pieces: [{ id: 'c1' }] },
    });
    expect(doc.comparison?.markerName).toBe('Previous');
    expect(doc.comparison?.opacity).toBe(0.4);
    expect(doc.comparison?.visible).toBe(false);
    expect(doc.comparison?.pieces).toHaveLength(1);
  });

  it('is idempotent — migrating twice changes nothing', () => {
    const once = migrate({ id: 'm1', schemaVersion: 1, name: 'Shirt', fabricWidth: 150 });
    expect(migrate(once)).toEqual(once);
  });
});
