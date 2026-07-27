import { describe, expect, it } from 'vitest';
import type { MarkerDocument, Point, TrayPiece } from './schema';
import { nextPlaceable, trayGroups } from './tray';

const rect: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
];

const tray = (
  id: string,
  name: string,
  bundle: string,
  quantity: number,
  placed: number,
  fabricCode = 'A',
): TrayPiece => ({
  id,
  name,
  size: 'M',
  bundle,
  fabricCode,
  geometry: rect,
  layDirection: '2way',
  quantity,
  placed,
});

const doc = (trayPieces: TrayPiece[]): MarkerDocument => ({
  id: 'doc-1',
  schemaVersion: 3,
  name: 'Test',
  fabricWidth: 150,
  endAllowance: 4,
  rotationRule: 'free',
  cutterBuffer: 0,
  pieces: [],
  trayPieces,
  defectZones: [],
  spliceLines: [],
  order: { model: '', sizes: [] },
  approvalState: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
});

describe('trayGroups', () => {
  it('is empty for an empty tray', () => {
    expect(trayGroups(doc([]))).toEqual([]);
  });

  it('merges the same piece across bundles', () => {
    const groups = trayGroups(
      doc([tray('f1', 'Front', 'B1', 1, 1), tray('f2', 'Front', 'B2', 1, 0)]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.quantity).toBe(2);
    expect(groups[0]?.placed).toBe(1);
    expect(groups[0]?.members).toHaveLength(2);
  });

  it('keeps different sizes apart', () => {
    const small = tray('f1', 'Front', 'B1', 1, 0);
    const large: TrayPiece = { ...tray('f2', 'Front', 'B1', 1, 0), size: 'L' };
    expect(trayGroups(doc([small, large]))).toHaveLength(2);
  });

  it('keeps different fabric codes apart', () => {
    const groups = trayGroups(
      doc([tray('f1', 'Front', 'B1', 1, 0), tray('f2', 'Front', 'B1', 1, 0, 'B')]),
    );
    expect(groups).toHaveLength(2);
  });

  it('preserves document order', () => {
    const groups = trayGroups(
      doc([
        tray('s1', 'Sleeve', 'B1', 1, 0),
        tray('f1', 'Front', 'B1', 1, 0),
        tray('s2', 'Sleeve', 'B2', 1, 0),
      ]),
    );
    expect(groups.map((group) => group.name)).toEqual(['Sleeve', 'Front']);
  });
});

describe('nextPlaceable', () => {
  it('finds the first bundle with something left', () => {
    const groups = trayGroups(
      doc([tray('f1', 'Front', 'B1', 1, 1), tray('f2', 'Front', 'B2', 1, 0)]),
    );
    const group = groups[0];
    if (!group) throw new Error('expected a group');
    expect(nextPlaceable(group)?.id).toBe('f2');
  });

  it('is undefined once everything is placed', () => {
    const groups = trayGroups(doc([tray('f1', 'Front', 'B1', 2, 2)]));
    const group = groups[0];
    if (!group) throw new Error('expected a group');
    expect(nextPlaceable(group)).toBeUndefined();
  });
});
