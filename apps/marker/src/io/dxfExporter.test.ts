import { describe, expect, it } from 'vitest';
import type { MarkerDocument, PlacedPiece, Point } from '@/marker/schema';
import { importDxf } from './dxf/importDxf';
import { exportMarkerDxf } from './dxfExporter';

const rect = (width: number, height: number): Point[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

const piece = (
  id: string,
  name: string,
  geometry: Point[],
  position: Point,
  overrides: Partial<PlacedPiece> = {},
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
  ...overrides,
});

const doc = (pieces: PlacedPiece[]): MarkerDocument => ({
  id: 'doc-1',
  schemaVersion: 3,
  name: 'Export test',
  fabricWidth: 150,
  endAllowance: 4,
  rotationRule: 'free',
  cutterBuffer: 0.3,
  pieces,
  trayPieces: [],
  defectZones: [],
  spliceLines: [],
  order: { model: 'TEE-100', sizes: [] },
  approvalState: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
});

/** Group-code pairs, as a DXF reader sees them. */
const pairsOf = (text: string): { code: number; value: string }[] => {
  const lines = text.split('\n');
  const pairs: { code: number; value: string }[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt((lines[i] ?? '').trim(), 10);
    if (!Number.isFinite(code)) break;
    pairs.push({ code, value: (lines[i + 1] ?? '').trim() });
  }
  return pairs;
};

describe('file structure', () => {
  it('declares R12', () => {
    const text = exportMarkerDxf(doc([piece('a', 'Front', rect(50, 70), { x: 0, y: 0 })]));
    expect(text).toContain('AC1009');
  });

  it('pairs every group code with a value', () => {
    const text = exportMarkerDxf(doc([piece('a', 'Front', rect(50, 70), { x: 0, y: 0 })]));
    // An odd line count means a code without its value — the classic way to
    // produce a file that fails to open.
    expect(text.trimEnd().split('\n').length % 2).toBe(0);
  });

  it('has every required section, in order, and ends with EOF', () => {
    const pairs = pairsOf(exportMarkerDxf(doc([piece('a', 'Front', rect(50, 70), { x: 0, y: 0 })])));
    const sections = pairs
      .map((entry, index) => (entry.code === 2 && pairs[index - 1]?.value === 'SECTION' ? entry.value : null))
      .filter((value): value is string => value !== null);

    expect(sections).toEqual(['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES']);
    expect(pairs.at(-1)).toEqual({ code: 0, value: 'EOF' });
  });

  it('balances SECTION and ENDSEC', () => {
    const pairs = pairsOf(exportMarkerDxf(doc([piece('a', 'Front', rect(50, 70), { x: 0, y: 0 })])));
    const opens = pairs.filter((p) => p.code === 0 && p.value === 'SECTION').length;
    const closes = pairs.filter((p) => p.code === 0 && p.value === 'ENDSEC').length;
    expect(opens).toBe(closes);
  });

  it('declares every layer it uses', () => {
    const pairs = pairsOf(exportMarkerDxf(doc([piece('a', 'Front', rect(50, 70), { x: 0, y: 0 })])));
    const declared = new Set(
      pairs
        .map((entry, index) => (entry.code === 2 && pairs[index - 1]?.value === 'LAYER' ? entry.value : null))
        .filter((value): value is string => value !== null),
    );
    const used = new Set(pairs.filter((entry) => entry.code === 8).map((entry) => entry.value));
    for (const layer of used) expect(declared.has(layer)).toBe(true);
  });

  it('uses POLYLINE rather than LWPOLYLINE, which R12 predates', () => {
    const text = exportMarkerDxf(doc([piece('a', 'Front', rect(50, 70), { x: 0, y: 0 })]));
    expect(text).toContain('POLYLINE');
    expect(text).not.toContain('LWPOLYLINE');
  });

  it('closes every POLYLINE with a SEQEND', () => {
    const pairs = pairsOf(
      exportMarkerDxf(
        doc([
          piece('a', 'Front', rect(50, 70), { x: 0, y: 0 }),
          piece('b', 'Back', rect(50, 70), { x: 60, y: 0 }),
        ]),
      ),
    );
    // POLYLINE and INSERT both open an entity that SEQEND terminates.
    const opens = pairs.filter(
      (p) => p.code === 0 && (p.value === 'POLYLINE' || p.value === 'INSERT'),
    ).length;
    const seqends = pairs.filter((p) => p.code === 0 && p.value === 'SEQEND').length;
    expect(seqends).toBe(opens);
  });

  it('declares an ATTDEF for every ATTRIB tag it writes', () => {
    const pairs = pairsOf(exportMarkerDxf(doc([piece('a', 'Front', rect(50, 70), { x: 0, y: 0 })])));
    const tagsFor = (entity: string) =>
      new Set(
        pairs
          .map((entry, index) => {
            if (entry.code !== 2) return null;
            for (let back = index - 1; back >= 0; back -= 1) {
              const previous = pairs[back];
              if (previous?.code === 0) return previous.value === entity ? entry.value : null;
            }
            return null;
          })
          .filter((value): value is string => value !== null),
      );
    expect([...tagsFor('ATTRIB')].sort()).toEqual([...tagsFor('ATTDEF')].sort());
  });
});

describe('content', () => {
  it('writes one block per definition, shared by repeated pieces', () => {
    const geometry = rect(50, 70);
    const text = exportMarkerDxf(
      doc([
        piece('a', 'Sleeve', geometry, { x: 0, y: 0 }),
        piece('b', 'Sleeve', geometry, { x: 60, y: 0 }, { pieceDefId: 'def-a' }),
      ]),
    );
    const pairs = pairsOf(text);
    const blocks = pairs.filter((p) => p.code === 0 && p.value === 'BLOCK').length;
    const inserts = pairs.filter((p) => p.code === 0 && p.value === 'INSERT').length;
    expect(blocks).toBe(1);
    expect(inserts).toBe(2);
  });

  it('carries rotation and flip on the INSERT', () => {
    const text = exportMarkerDxf(
      doc([piece('a', 'Front', rect(50, 70), { x: 10, y: 20 }, { rotation: 90, flipped: true })]),
    );
    const pairs = pairsOf(text);
    expect(pairs.some((p) => p.code === 50 && Number.parseFloat(p.value) === 90)).toBe(true);
    // A mirror is a negative x scale.
    expect(pairs.some((p) => p.code === 41 && Number.parseFloat(p.value) === -1)).toBe(true);
  });
});

describe('round trip through the importer', () => {
  it('comes back with the same pieces, names and sizes', () => {
    const original = doc([
      piece('a', 'Front', rect(50, 70), { x: 0, y: 0 }),
      piece('b', 'Back', rect(52, 74), { x: 60, y: 0 }),
      piece('c', 'Sleeve', rect(30, 46), { x: 120, y: 0 }),
    ]);

    const reimported = importDxf(exportMarkerDxf(original));

    expect(reimported.pieces).toHaveLength(3);
    expect(reimported.pieces.map((p) => p.name).sort()).toEqual(['Back', 'Front', 'Sleeve']);
    expect(reimported.pieces.every((p) => p.size === 'M')).toBe(true);
    expect(reimported.pieces.every((p) => p.bundle === 'B1')).toBe(true);
  });

  it('preserves piece dimensions', () => {
    const original = doc([piece('a', 'Front', rect(50, 70), { x: 15, y: 25 })]);
    const reimported = importDxf(exportMarkerDxf(original));

    const geometry = reimported.pieces[0]?.geometry ?? [];
    const xs = geometry.map((p) => p.x);
    const ys = geometry.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(50, 3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(70, 3);
  });

  it('reads back in centimetres, not inches', () => {
    const original = doc([piece('a', 'Front', rect(50, 70), { x: 0, y: 0 })]);
    expect(importDxf(exportMarkerDxf(original)).units).toBe('cm');
  });

  it('produces no warnings for a marker it wrote itself', () => {
    const original = doc([
      piece('a', 'Front', rect(50, 70), { x: 0, y: 0 }),
      piece('b', 'Back', rect(52, 74), { x: 60, y: 0 }),
    ]);
    expect(importDxf(exportMarkerDxf(original)).warnings).toEqual([]);
  });
});

describe('edge cases', () => {
  it('writes a valid empty marker', () => {
    const text = exportMarkerDxf(doc([]));
    expect(text).toContain('AC1009');
    expect(pairsOf(text).at(-1)).toEqual({ code: 0, value: 'EOF' });
  });

  it('makes block names safe and unique', () => {
    const text = exportMarkerDxf(
      doc([
        piece('a', 'Front / Left', rect(50, 70), { x: 0, y: 0 }),
        piece('b', 'Front / Left', rect(40, 60), { x: 60, y: 0 }),
      ]),
    );
    const names = pairsOf(text)
      .map((entry, index, all) => (entry.code === 2 && all[index - 1]?.value === 'BLOCK' ? entry.value : null))
      .filter((value): value is string => value !== null);

    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[A-Z0-9_-]+$/);
  });
});
