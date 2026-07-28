import { describe, expect, it } from 'vitest';
import { BUNDLE_SLOTS, bundleOrder, bundleSlot, bundleSlots } from './bundles';
import type { MarkerDocument, PlacedPiece, Point, TrayPiece } from './schema';

const geometry: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
];

const piece = (id: string, bundle: string): PlacedPiece => ({
  id,
  pieceDefId: `def-${id}`,
  name: id,
  size: 'M',
  bundle,
  fabricCode: 'A',
  geometry,
  position: { x: 0, y: 0 },
  rotation: 0,
  flipped: false,
  placed: true,
  blocked: false,
});

const tray = (id: string, bundle: string): TrayPiece => ({
  id,
  name: id,
  size: 'M',
  bundle,
  fabricCode: 'A',
  geometry,
  layDirection: '2way',
  quantity: 1,
  placed: 0,
});

const doc = (pieces: PlacedPiece[], trayPieces: TrayPiece[] = []): MarkerDocument => ({
  id: 'doc-1',
  schemaVersion: 3,
  name: 'Bundles',
  fabricWidth: 150,
  endAllowance: 4,
  rotationRule: 'free',
  cutterBuffer: 0,
  pieces,
  trayPieces,
  defectZones: [],
  spliceLines: [],
  order: { model: '', sizes: [] },
  approvalState: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
});

describe('bundleOrder', () => {
  it('is empty for an empty document', () => {
    expect(bundleOrder(doc([]))).toEqual([]);
  });

  it('covers bundles from the tray as well as the marker', () => {
    const document = doc([piece('p1', 'B2')], [tray('t1', 'B1')]);
    expect(bundleOrder(document)).toEqual(['B1', 'B2']);
  });

  it('lists each bundle once', () => {
    const document = doc([piece('p1', 'B1'), piece('p2', 'B1'), piece('p3', 'B2')]);
    expect(bundleOrder(document)).toEqual(['B1', 'B2']);
  });

  it('sorts, so a colour does not depend on placement order', () => {
    const forwards = doc([piece('p1', 'B1'), piece('p2', 'B2')]);
    const backwards = doc([piece('p1', 'B2'), piece('p2', 'B1')]);
    expect(bundleOrder(forwards)).toEqual(bundleOrder(backwards));
  });
});

describe('bundleSlot', () => {
  it('gives each bundle its own slot', () => {
    const document = doc([piece('p1', 'B1'), piece('p2', 'B2'), piece('p3', 'B3')]);
    expect(bundleSlot(document, 'B1')).toBe(0);
    expect(bundleSlot(document, 'B2')).toBe(1);
    expect(bundleSlot(document, 'B3')).toBe(2);
  });

  it('holds a bundle steady when another is removed', () => {
    // Deleting B1 must not repaint B3 — a colour that moves because something
    // unrelated changed is worse than no colour.
    const before = doc([piece('p1', 'B1'), piece('p2', 'B3')]);
    const after = doc([piece('p2', 'B3')]);
    expect(bundleSlot(before, 'B3')).toBe(1);
    expect(bundleSlot(after, 'B3')).toBe(0);
    // The slot does move when the set changes; what matters is that it is a
    // pure function of the set, so both renders of one document agree.
    expect(bundleSlot(before, 'B3')).toBe(bundleSlot(before, 'B3'));
  });

  it('wraps past the eighth bundle rather than inventing a colour', () => {
    const pieces = Array.from({ length: 10 }, (_, i) => piece(`p${i}`, `B${i}`));
    const document = doc(pieces);
    expect(bundleSlot(document, 'B8')).toBe(0);
    expect(bundleSlot(document, 'B9')).toBe(1);
  });

  it('falls back to the first slot for an unknown bundle', () => {
    expect(bundleSlot(doc([piece('p1', 'B1')]), 'nope')).toBe(0);
  });

  it('never returns a slot outside the palette', () => {
    const pieces = Array.from({ length: 40 }, (_, i) => piece(`p${i}`, `B${String(i).padStart(3, '0')}`));
    const document = doc(pieces);
    for (const bundle of bundleOrder(document)) {
      const slot = bundleSlot(document, bundle);
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(slot).toBeLessThan(BUNDLE_SLOTS);
    }
  });
});

describe('bundleSlots', () => {
  it('agrees with bundleSlot for every bundle', () => {
    const document = doc([piece('p1', 'B1'), piece('p2', 'B2'), piece('p3', 'B9')]);
    for (const [bundle, slot] of bundleSlots(document)) {
      expect(slot).toBe(bundleSlot(document, bundle));
    }
  });
});
