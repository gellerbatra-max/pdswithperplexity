import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FABRIC_WIDTH,
  DEFAULT_MARKER_NAME,
  copyName,
  createMarker,
  duplicateMarker,
} from './newMarker';
import type { TrayPiece } from './schema';

const tray = (id: string): TrayPiece => ({
  id,
  name: 'Front',
  size: 'M',
  bundle: 'B1',
  fabricCode: 'A',
  geometry: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  layDirection: '2way',
  quantity: 1,
  placed: 0,
});

describe('createMarker', () => {
  it('is a current-schema document with nothing placed', () => {
    const marker = createMarker({ id: 'm1', now: '2026-07-01T00:00:00.000Z' });
    expect(marker.schemaVersion).toBe(3);
    expect(marker.pieces).toEqual([]);
    expect(marker.trayPieces).toEqual([]);
  });

  it('defaults the name and width rather than leaving them blank', () => {
    const marker = createMarker({ id: 'm1', now: '2026-07-01T00:00:00.000Z' });
    expect(marker.name).toBe(DEFAULT_MARKER_NAME);
    expect(marker.fabricWidth).toBe(DEFAULT_FABRIC_WIDTH);
  });

  it('falls back when given a blank or whitespace name', () => {
    expect(createMarker({ name: '   ' }).name).toBe(DEFAULT_MARKER_NAME);
    expect(createMarker({ name: '' }).name).toBe(DEFAULT_MARKER_NAME);
  });

  it('trims a supplied name', () => {
    expect(createMarker({ name: '  Spring tee  ' }).name).toBe('Spring tee');
  });

  it('refuses a width of zero or less', () => {
    expect(createMarker({ fabricWidth: 0 }).fabricWidth).toBe(DEFAULT_FABRIC_WIDTH);
    expect(createMarker({ fabricWidth: -20 }).fabricWidth).toBe(DEFAULT_FABRIC_WIDTH);
  });

  it('carries imported tray pieces in', () => {
    const marker = createMarker({ trayPieces: [tray('t1'), tray('t2')] });
    expect(marker.trayPieces).toHaveLength(2);
  });

  it('copies the tray rather than aliasing the caller’s array', () => {
    const pieces = [tray('t1')];
    const marker = createMarker({ trayPieces: pieces });
    pieces.push(tray('t2'));
    expect(marker.trayPieces).toHaveLength(1);
  });

  it('stamps all three timestamps the same at creation', () => {
    const marker = createMarker({ now: '2026-07-01T00:00:00.000Z' });
    expect(marker.createdAt).toBe('2026-07-01T00:00:00.000Z');
    expect(marker.updatedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(marker.lastOpenedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('gives each marker its own id', () => {
    expect(createMarker().id).not.toBe(createMarker().id);
  });
});

describe('duplicateMarker', () => {
  const source = () => ({
    ...createMarker({ id: 'm1', name: 'Spring tee', now: '2026-01-01T00:00:00.000Z' }),
    trayPieces: [tray('t1')],
  });

  it('gives the copy a new id', () => {
    // Sharing an id would make the copy overwrite its original on the next
    // auto-save.
    const copy = duplicateMarker(source(), { id: 'm2', now: '2026-07-01T00:00:00.000Z' });
    expect(copy.id).toBe('m2');
    expect(copy.id).not.toBe('m1');
  });

  it('restamps the timestamps rather than inheriting them', () => {
    const copy = duplicateMarker(source(), { now: '2026-07-01T00:00:00.000Z' });
    expect(copy.createdAt).toBe('2026-07-01T00:00:00.000Z');
    expect(copy.lastOpenedAt).toBe('2026-07-01T00:00:00.000Z');
  });

  it('keeps the contents', () => {
    const copy = duplicateMarker(source());
    expect(copy.trayPieces).toHaveLength(1);
    expect(copy.fabricWidth).toBe(source().fabricWidth);
  });

  it('deep-copies, so editing the copy leaves the original alone', () => {
    const original = source();
    const copy = duplicateMarker(original);
    copy.trayPieces[0]!.placed = 5;
    expect(original.trayPieces[0]?.placed).toBe(0);
  });

  it('names the copy', () => {
    expect(duplicateMarker(source()).name).toBe('Spring tee (copy)');
  });
});

describe('copyName', () => {
  it('marks a first copy', () => {
    expect(copyName('Spring tee')).toBe('Spring tee (copy)');
  });

  it('counts instead of stacking suffixes', () => {
    // "(copy) (copy) (copy)" tells you nothing except that someone gave up.
    expect(copyName('Spring tee (copy)')).toBe('Spring tee (copy 2)');
    expect(copyName('Spring tee (copy 2)')).toBe('Spring tee (copy 3)');
    expect(copyName('Spring tee (copy 9)')).toBe('Spring tee (copy 10)');
  });

  it('leaves a name that merely mentions copy alone', () => {
    expect(copyName('Copy of last season')).toBe('Copy of last season (copy)');
  });
});
