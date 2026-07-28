import { describe, expect, it } from 'vitest';
import type { Point } from '@/marker/schema';
import type { NestPiece, NestPlan } from './model';
import { compareScores, scorePlan, stabilityOf, timeRun } from './scoring';

const rect = (width: number, height: number): Point[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

const piece = (id: string, width: number, height: number): NestPiece => ({
  id,
  geometry: rect(width, height),
  rotation: 'half-turn',
  quantity: 1,
});

const plan = (over: Partial<NestPlan> = {}): NestPlan => ({
  placements: [],
  unplaced: [],
  length: 0,
  sheet: { width: 100 },
  ...over,
});

const at = (pieceId: string, x: number, y: number, rotation = 0) => ({
  pieceId,
  position: { x, y },
  rotation,
  flipped: false,
});

describe('utilization and waste', () => {
  it('measures placed area over the marker the plan used', () => {
    // One 20x30 piece on a 100-wide sheet, 20 long: 600 of 2000 = 30%.
    const pieces = [piece('a', 20, 30)];
    const score = scorePlan(plan({ placements: [at('a', 0, 0)], length: 20 }), pieces);
    expect(score.placedArea).toBe(600);
    expect(score.markerArea).toBe(2000);
    expect(score.utilization).toBeCloseTo(30, 6);
  });

  it('reports waste as the fabric the pieces did not cover', () => {
    const pieces = [piece('a', 20, 30)];
    const score = scorePlan(plan({ placements: [at('a', 0, 0)], length: 20 }), pieces);
    expect(score.wasteArea).toBe(1400);
  });

  it('adds up every piece that landed', () => {
    const pieces = [piece('a', 20, 30), piece('b', 20, 30)];
    const score = scorePlan(
      plan({ placements: [at('a', 0, 0), at('b', 0, 30)], length: 20 }),
      pieces,
    );
    expect(score.placedArea).toBe(1200);
    expect(score.utilization).toBeCloseTo(60, 6);
  });

  it('measures a rotated piece where it actually lies', () => {
    // Turned 90°, a 20x30 piece is 30 across and 20 along, so the marker is
    // 20 long rather than 30 — but the area it covers has not changed.
    const pieces = [piece('a', 20, 30)];
    const score = scorePlan(plan({ placements: [at('a', 30, 0, 90)], length: 30 }), pieces);
    expect(score.placedArea).toBeCloseTo(600, 6);
  });

  it('is all zeroes for an empty plan, not a division by zero', () => {
    const score = scorePlan(plan(), []);
    expect(score.utilization).toBe(0);
    expect(score.wasteArea).toBe(0);
    expect(score.markerArea).toBe(0);
    expect(Number.isNaN(score.utilization)).toBe(false);
  });

  it('never reports negative waste', () => {
    // Two pieces stacked on the same spot cover more than the marker holds.
    const pieces = [piece('a', 40, 100), piece('b', 40, 100)];
    const score = scorePlan(
      plan({ placements: [at('a', 0, 0), at('b', 0, 0)], length: 40 }),
      pieces,
    );
    expect(score.utilization).toBeGreaterThan(100);
    expect(score.wasteArea).toBe(0);
  });

  it('ignores a placement naming a piece it was not given', () => {
    const score = scorePlan(plan({ placements: [at('ghost', 0, 0)], length: 20 }), []);
    expect(score.placedArea).toBe(0);
  });

  it('counts what did not fit', () => {
    const score = scorePlan(plan({ unplaced: ['a', 'b'] }), []);
    expect(score.unplacedCount).toBe(2);
  });
});

describe('stability', () => {
  const pieces = [piece('a', 20, 30), piece('b', 20, 30)];

  it('is 1 for a clean plan', () => {
    const score = scorePlan(
      plan({ placements: [at('a', 0, 0), at('b', 0, 30)], length: 20 }),
      pieces,
    );
    expect(score.stability).toBe(1);
  });

  it('is 1 for an empty plan — nothing laid is nothing wrong', () => {
    expect(stabilityOf(plan(), pieces)).toBe(1);
  });

  it('falls when two pieces overlap', () => {
    const overlapping = plan({ placements: [at('a', 0, 0), at('b', 0, 10)], length: 20 });
    expect(stabilityOf(overlapping, pieces)).toBe(0);
  });

  it('degrades in proportion rather than collapsing', () => {
    // Four pieces, one overlapping pair: two of four are at fault.
    const four = [piece('a', 10, 10), piece('b', 10, 10), piece('c', 10, 10), piece('d', 10, 10)];
    const mixed = plan({
      placements: [at('a', 0, 0), at('b', 0, 5), at('c', 0, 40), at('d', 0, 60)],
      length: 10,
    });
    expect(stabilityOf(mixed, four)).toBe(0.5);
  });

  it('counts a piece once however many things it overlaps', () => {
    // One piece lying across two others is one piece to move, not two faults
    // on top of the pair it disturbed.
    const three = [piece('a', 10, 10), piece('b', 10, 10), piece('wide', 10, 40)];
    const spanning = plan({
      placements: [at('a', 0, 0), at('b', 0, 20), at('wide', 0, 0)],
      length: 10,
    });
    expect(stabilityOf(spanning, three)).toBe(0);
  });

  it('faults a piece hanging off the fabric width', () => {
    const overhanging = plan({ placements: [at('a', 0, 90)], length: 20 });
    expect(stabilityOf(overhanging, pieces)).toBe(0);
  });

  it('faults a piece behind the start of the fabric', () => {
    const behind = plan({ placements: [at('a', -5, 0)], length: 20 });
    expect(stabilityOf(behind, pieces)).toBe(0);
  });

  it('faults a piece past a maximum length when one is set', () => {
    const tooLong = plan({
      placements: [at('a', 0, 0)],
      length: 20,
      sheet: { width: 100, maxLength: 10 },
    });
    expect(stabilityOf(tooLong, pieces)).toBe(0);
  });

  it('faults a placement it cannot verify', () => {
    // A placement naming an unknown piece cannot be checked, and an
    // unverifiable placement is not a safe one.
    expect(stabilityOf(plan({ placements: [at('ghost', 0, 0)], length: 20 }), pieces)).toBe(0);
  });
});

describe('runtime', () => {
  it('is null when a plan was not timed', () => {
    expect(scorePlan(plan(), []).runtimeMs).toBeNull();
  });

  it('carries a measured time through', () => {
    expect(scorePlan(plan(), [], 12.5).runtimeMs).toBe(12.5);
  });

  it('times a run and returns its value', () => {
    const { value, ms } = timeRun(() => 'done');
    expect(value).toBe('done');
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(ms)).toBe(true);
  });
});

describe('compareScores', () => {
  const score = (over: Partial<ReturnType<typeof scorePlan>> = {}) => ({
    ...scorePlan(plan(), []),
    stability: 1,
    unplacedCount: 0,
    utilization: 50,
    ...over,
  });

  it('prefers the safer plan whatever its utilisation', () => {
    // A tight marker with an overlap has to be fixed before anything is cut.
    const safe = score({ stability: 1, utilization: 60 });
    const unsafe = score({ stability: 0.5, utilization: 95 });
    expect(compareScores(safe, unsafe)).toBeLessThan(0);
  });

  it('prefers the plan that placed more, once both are safe', () => {
    const complete = score({ unplacedCount: 0, utilization: 60 });
    const short = score({ unplacedCount: 3, utilization: 95 });
    expect(compareScores(complete, short)).toBeLessThan(0);
  });

  it('prefers the tighter plan when safety and completeness match', () => {
    expect(compareScores(score({ utilization: 80 }), score({ utilization: 70 }))).toBeLessThan(0);
  });

  it('ignores runtime — cloth outlives a second of nesting', () => {
    const slow = score({ runtimeMs: 9000 });
    const fast = score({ runtimeMs: 1 });
    expect(compareScores(slow, fast)).toBe(0);
  });

  it('sorts a list best first', () => {
    const plans = [
      score({ utilization: 40 }),
      score({ stability: 0.2, utilization: 99 }),
      score({ utilization: 80 }),
    ];
    const sorted = [...plans].sort(compareScores);
    expect(sorted[0]?.utilization).toBe(80);
    expect(sorted[2]?.stability).toBe(0.2);
  });
});
