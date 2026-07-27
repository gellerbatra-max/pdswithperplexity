import { describe, expect, it } from 'vitest';
import type { MarkerDocument, PlacedPiece, Point } from '@/marker/schema';
import { PLOTTER_UNITS_PER_CM, exportMarkerHpgl, toPlotterUnits } from './hpglExporter';

const rect = (width: number, height: number): Point[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

const piece = (
  id: string,
  geometry: Point[],
  position: Point,
  overrides: Partial<PlacedPiece> = {},
): PlacedPiece => ({
  id,
  pieceDefId: `def-${id}`,
  name: id,
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
  name: 'HPGL test',
  fabricWidth: 150,
  endAllowance: 4,
  rotationRule: 'free',
  cutterBuffer: 0,
  pieces,
  trayPieces: [],
  defectZones: [],
  spliceLines: [],
  order: { model: '', sizes: [] },
  approvalState: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
});

describe('plotter units', () => {
  it('is 400 units per centimetre, from 1 plu = 0.025 mm', () => {
    // 1 cm = 10 mm; 10 / 0.025 = 400.
    expect(PLOTTER_UNITS_PER_CM).toBe(400);
    expect(toPlotterUnits(1)).toBe(400);
  });

  it('converts a metre and a millimetre correctly', () => {
    expect(toPlotterUnits(100)).toBe(40_000);
    expect(toPlotterUnits(0.1)).toBe(40);
  });

  it('rounds to whole units, which is all a plotter accepts', () => {
    expect(toPlotterUnits(0.00126)).toBe(1);
    expect(Number.isInteger(toPlotterUnits(37.777))).toBe(true);
  });
});

describe('command stream', () => {
  it('initialises and selects a pen before cutting', () => {
    const commands = exportMarkerHpgl(doc([piece('a', rect(10, 10), { x: 0, y: 0 })])).split('\n');
    expect(commands[0]).toBe('IN;');
    expect(commands[1]).toBe('SP1;');
  });

  it('parks the knife up at the end', () => {
    const commands = exportMarkerHpgl(doc([piece('a', rect(10, 10), { x: 0, y: 0 })]))
      .trimEnd()
      .split('\n');
    expect(commands.at(-2)).toBe('PU;');
    expect(commands.at(-1)).toBe('SP0;');
  });

  it('terminates every command with a semicolon', () => {
    const text = exportMarkerHpgl(
      doc([piece('a', rect(10, 10), { x: 0, y: 0 }), piece('b', rect(10, 10), { x: 20, y: 0 })]),
    );
    for (const command of text.trimEnd().split('\n')) {
      expect(command.endsWith(';')).toBe(true);
    }
  });

  it('travels pen-up to the start, then cuts pen-down', () => {
    const text = exportMarkerHpgl(doc([piece('a', rect(10, 20), { x: 5, y: 5 })]));
    // Start corner at 5,5 cm = 2000,2000 plu.
    expect(text).toContain('PU2000,2000;');
    expect(text).toMatch(/PD[\d,]+;/);
  });

  it('closes the outline by returning to the first point', () => {
    const text = exportMarkerHpgl(doc([piece('a', rect(10, 10), { x: 0, y: 0 })]));
    const cut = text.split('\n').find((line) => line.startsWith('PD'));
    expect(cut).toBeDefined();
    // 10x10 cm from the origin: 4000,0 -> 4000,4000 -> 0,4000 -> back to 0,0.
    expect(cut).toBe('PD4000,0,4000,4000,0,4000,0,0;');
  });

  it('emits one pen-up travel per piece', () => {
    const text = exportMarkerHpgl(
      doc([
        piece('a', rect(10, 10), { x: 0, y: 0 }),
        piece('b', rect(10, 10), { x: 20, y: 0 }),
        piece('c', rect(10, 10), { x: 40, y: 0 }),
      ]),
    );
    expect(text.split('\n').filter((line) => /^PU\d/.test(line))).toHaveLength(3);
  });
});

describe('geometry', () => {
  it('applies the piece position', () => {
    const text = exportMarkerHpgl(doc([piece('a', rect(10, 10), { x: 2.5, y: 1.25 })]));
    expect(text).toContain('PU1000,500;');
  });

  it('applies rotation', () => {
    const text = exportMarkerHpgl(
      doc([piece('a', rect(10, 20), { x: 0, y: 0 }, { rotation: 90 })]),
    );
    // Turned 90° CCW, the far corner lands at -20,10 cm.
    expect(text).toContain('-8000');
  });

  it('skips a degenerate outline instead of emitting a broken path', () => {
    const text = exportMarkerHpgl(
      doc([piece('a', [{ x: 0, y: 0 }, { x: 1, y: 1 }], { x: 0, y: 0 })]),
    );
    expect(text.split('\n').filter((line) => line.startsWith('PD'))).toHaveLength(0);
  });

  it('writes a valid, empty stream for a marker with no pieces', () => {
    expect(exportMarkerHpgl(doc([]))).toBe('IN;\nSP1;\nPU;\nSP0;\n');
  });
});

describe('cut sequence', () => {
  it('follows cutSequence, because file order is the knife path', () => {
    const text = exportMarkerHpgl(
      doc([
        piece('third', rect(10, 10), { x: 40, y: 0 }, { cutSequence: 3 }),
        piece('first', rect(10, 10), { x: 0, y: 0 }, { cutSequence: 1 }),
        piece('second', rect(10, 10), { x: 20, y: 0 }, { cutSequence: 2 }),
      ]),
    );
    const travels = text.split('\n').filter((line) => /^PU\d/.test(line));
    expect(travels).toEqual(['PU0,0;', 'PU8000,0;', 'PU16000,0;']);
  });

  it('puts unsequenced pieces after sequenced ones', () => {
    const text = exportMarkerHpgl(
      doc([
        piece('loose', rect(10, 10), { x: 40, y: 0 }),
        piece('first', rect(10, 10), { x: 0, y: 0 }, { cutSequence: 1 }),
      ]),
    );
    const travels = text.split('\n').filter((line) => /^PU\d/.test(line));
    expect(travels[0]).toBe('PU0,0;');
  });

  it('keeps document order when sequencing is switched off', () => {
    const text = exportMarkerHpgl(
      doc([
        piece('b', rect(10, 10), { x: 20, y: 0 }, { cutSequence: 9 }),
        piece('a', rect(10, 10), { x: 0, y: 0 }, { cutSequence: 1 }),
      ]),
      { respectCutSequence: false },
    );
    const travels = text.split('\n').filter((line) => /^PU\d/.test(line));
    expect(travels[0]).toBe('PU8000,0;');
  });
});
