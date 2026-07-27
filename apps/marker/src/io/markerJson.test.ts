import { describe, expect, it } from 'vitest';
import { MigrationError } from '@/marker/migrations';
import type { MarkerDocument } from '@/marker/schema';
import { markerFileName, parseMarker, serializeMarker } from './markerJson';

const doc = (name = 'Spring tee'): MarkerDocument => ({
  id: 'doc-1',
  schemaVersion: 2,
  name,
  fabricWidth: 150,
  endAllowance: 4,
  rotationRule: '90ok',
  cutterBuffer: 0.3,
  pieces: [
    {
      id: 'p1',
      pieceDefId: 'front',
      name: 'Front',
      size: 'M',
      bundle: 'B1',
      fabricCode: 'A',
      geometry: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      position: { x: 5, y: 5 },
      rotation: 90,
      flipped: true,
      placed: true,
      blocked: false,
      cutSequence: 2,
    },
  ],
  trayPieces: [],
  defectZones: [{ id: 'd1', x: 1, y: 2, width: 3, height: 4 }],
  spliceLines: [{ id: 's1', x: 42 }],
  order: { model: 'TEE-100', sizes: [{ size: 'M', quantity: 2, fabricCode: 'A' }] },
  approvalState: 'approved',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-05-02T00:00:00.000Z',
});

describe('round trip', () => {
  it('survives serialise then parse unchanged', () => {
    const original = doc();
    expect(parseMarker(serializeMarker(original))).toEqual(original);
  });

  it('keeps piece detail, zones and splices', () => {
    const restored = parseMarker(serializeMarker(doc()));
    expect(restored.pieces[0]?.rotation).toBe(90);
    expect(restored.pieces[0]?.flipped).toBe(true);
    expect(restored.pieces[0]?.cutSequence).toBe(2);
    expect(restored.defectZones).toHaveLength(1);
    expect(restored.spliceLines[0]?.x).toBe(42);
  });

  it('writes indented JSON, which is read by hand often enough to matter', () => {
    expect(serializeMarker(doc())).toContain('\n  ');
  });
});

describe('parseMarker', () => {
  it('rejects text that is not JSON', () => {
    expect(() => parseMarker('{ not json')).toThrow(/Not valid JSON/);
  });

  it('rejects JSON that is not a document', () => {
    expect(() => parseMarker('[1,2,3]')).toThrow(MigrationError);
  });

  it('migrates an older document rather than half-loading it', () => {
    const restored = parseMarker(JSON.stringify({ id: 'old-1', schemaVersion: 1, name: 'Legacy' }));
    expect(restored.schemaVersion).toBe(2);
    expect(restored.endAllowance).toBe(4);
  });

  it('refuses a document from a newer build', () => {
    expect(() => parseMarker(JSON.stringify({ id: 'x', schemaVersion: 99 }))).toThrow(
      /newer than this build/,
    );
  });
});

describe('markerFileName', () => {
  it('derives a filename from the marker name', () => {
    expect(markerFileName(doc('Spring tee'))).toBe('Spring-tee.marker.json');
  });

  it('strips characters that are unsafe in a filename', () => {
    expect(markerFileName(doc('A/B: 40%*'))).toBe('AB-40.marker.json');
  });

  it('falls back when the name is blank', () => {
    expect(markerFileName(doc('   '))).toBe('marker.marker.json');
  });
});
