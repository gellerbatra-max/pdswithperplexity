import { describe, expect, it } from 'vitest';
import type { Point } from '@/marker/schema';
import { NO_SPACING, type NestHazards, type NestObstacle, type NestPiece, type NestPlan } from './model';
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

/** A rectangular region of fabric an engine may not use. */
const zone = (x: number, y: number, width: number, height: number): NestObstacle => ({
  polygon: [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ],
});

const hazards = (over: Partial<NestHazards> = {}): NestHazards => ({
  obstacles: [],
  spacing: NO_SPACING,
  ...over,
});

describe('stability against obstacles', () => {
  const pieces = [piece('a', 20, 30), piece('b', 20, 30)];
  // The piece sits at y 0–30; the zone covers y 0–30, so they collide.
  const over = plan({ placements: [at('a', 0, 0)], length: 20 });
  const clear = plan({ placements: [at('a', 0, 40)], length: 20 });
  const defect = hazards({ obstacles: [zone(0, 0, 20, 30)] });

  it('faults a piece laid over a defect zone', () => {
    expect(stabilityOf(over, pieces, defect)).toBe(0);
  });

  it('passes a piece laid clear of the same zone', () => {
    expect(stabilityOf(clear, pieces, defect)).toBe(1);
  });

  it('scores the overlapping plan worse than the safe one', () => {
    // The headline: `best` picks by score, so the unsafe plan has to lose here
    // or it reaches the cutting room.
    const unsafe = scorePlan(over, pieces, null, defect);
    const safe = scorePlan(clear, pieces, null, defect);
    expect(unsafe.stability).toBeLessThan(safe.stability);
    expect(compareScores(safe, unsafe)).toBeLessThan(0);
  });

  it('ignores obstacles when none are given, so geometry-only scoring is unchanged', () => {
    // The default is what a caller with no request in hand can honestly ask.
    expect(stabilityOf(over, pieces)).toBe(1);
    expect(stabilityOf(over, pieces, hazards())).toBe(1);
  });

  it('faults a piece too close to a zone it does not touch', () => {
    // 2 cm clear of the zone, with the knife needing 5.
    const near = plan({ placements: [at('a', 0, 32)], length: 20 });
    expect(stabilityOf(near, pieces, defect)).toBe(1);
    expect(
      stabilityOf(near, pieces, hazards({ ...defect, spacing: { betweenPieces: 5, fromEdge: 0 } })),
    ).toBe(0);
  });

  it('counts a piece once however many zones it fouls', () => {
    // One piece to move is one fault, the same rule the piece-on-piece case uses.
    const many = hazards({ obstacles: [zone(0, 0, 5, 5), zone(10, 10, 5, 5), zone(15, 25, 5, 5)] });
    expect(stabilityOf(over, pieces, many)).toBe(0);
  });

  it('degrades in proportion — one fouled piece of two', () => {
    const mixed = plan({ placements: [at('a', 0, 0), at('b', 0, 40)], length: 20 });
    expect(stabilityOf(mixed, pieces, defect)).toBe(0.5);
  });
});

describe('stability against spacing', () => {
  const pieces = [piece('a', 20, 30), piece('b', 20, 30)];
  // Laid 2 cm apart: legal with no buffer, too tight for a 5 cm knife.
  const snug = plan({ placements: [at('a', 0, 0), at('b', 0, 32)], length: 20 });

  it('passes a 2 cm gap when nothing was asked for', () => {
    expect(stabilityOf(snug, pieces, hazards())).toBe(1);
  });

  it('faults both pieces when the gap is under the cutter buffer', () => {
    const buffered = hazards({ spacing: { betweenPieces: 5, fromEdge: 0 } });
    expect(stabilityOf(snug, pieces, buffered)).toBe(0);
  });

  it('passes the same pair once the buffer fits between them', () => {
    const buffered = hazards({ spacing: { betweenPieces: 2, fromEdge: 0 } });
    expect(stabilityOf(snug, pieces, buffered)).toBe(1);
  });

  it('scores a spacing violation worse than a plan that respects it', () => {
    const buffered = hazards({ spacing: { betweenPieces: 5, fromEdge: 0 } });
    const roomy = plan({ placements: [at('a', 0, 0), at('b', 0, 40)], length: 20 });
    const tight = scorePlan(snug, pieces, null, buffered);
    const spaced = scorePlan(roomy, pieces, null, buffered);
    expect(tight.stability).toBeLessThan(spaced.stability);
    expect(compareScores(spaced, tight)).toBeLessThan(0);
  });

  it('faults a piece inside the selvedge margin', () => {
    // The selvedge is distorted, so 10 cm of each edge is not fabric to cut on.
    const margin = hazards({ spacing: { betweenPieces: 0, fromEdge: 10 } });
    const onSelvedge = plan({ placements: [at('a', 0, 5)], length: 20 });
    expect(stabilityOf(onSelvedge, pieces, margin)).toBe(0);
    expect(stabilityOf(onSelvedge, pieces, hazards())).toBe(1);
  });

  it('faults a piece running past the far selvedge', () => {
    // y 65–95 on a 100 sheet is inside the roll but inside the far margin too.
    const margin = hazards({ spacing: { betweenPieces: 0, fromEdge: 10 } });
    const farEdge = plan({ placements: [at('a', 0, 65)], length: 20 });
    expect(stabilityOf(farEdge, pieces, margin)).toBe(0);
    expect(stabilityOf(farEdge, pieces, hazards())).toBe(1);
  });

  it('passes a piece that clears both margins', () => {
    const margin = hazards({ spacing: { betweenPieces: 0, fromEdge: 10 } });
    const inside = plan({ placements: [at('a', 0, 10)], length: 20 });
    expect(stabilityOf(inside, pieces, margin)).toBe(1);
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

  it('does not let a plan that laid nothing win on vacuous safety', () => {
    // The empty plan is safe only because there is nothing on it to be unsafe.
    // Without the gate its stability of 1 beats the complete plan outright and
    // `best` ships the marker with no pieces on it.
    const laidNothing = score({ placementCount: 0, stability: 1, unplacedCount: 2 });
    const laidEverything = score({ placementCount: 2, stability: 0, unplacedCount: 0 });
    expect(compareScores(laidNothing, laidEverything)).toBeGreaterThan(0);
    expect(compareScores(laidEverything, laidNothing)).toBeLessThan(0);
  });

  it('prefers anything laid over nothing laid, however poor', () => {
    const laidNothing = score({ placementCount: 0, stability: 1, unplacedCount: 9, utilization: 0 });
    const laidOne = score({ placementCount: 1, stability: 0.5, unplacedCount: 8, utilization: 4 });
    expect([...[laidNothing, laidOne]].sort(compareScores)[0]).toBe(laidOne);
  });

  it('still ranks two empty plans by the ordinary rules', () => {
    // The gate is the empty-versus-laid case only; it must not swallow the
    // comparison when neither plan placed anything.
    const a = score({ placementCount: 0, unplacedCount: 1 });
    const b = score({ placementCount: 0, unplacedCount: 4 });
    expect(compareScores(a, b)).toBeLessThan(0);
  });

  it('still ranks an incomplete plan on its merits once it laid something', () => {
    // One piece of ten is a poor marker, not a vacuous one, so rules 1–3 apply.
    const partial = score({ placementCount: 1, stability: 1, unplacedCount: 9 });
    const complete = score({ placementCount: 10, stability: 1, unplacedCount: 0 });
    expect(compareScores(complete, partial)).toBeLessThan(0);
  });

  it('is deterministic and symmetric across every pair', () => {
    const plans = [
      score({ placementCount: 0, stability: 1, unplacedCount: 5 }),
      score({ placementCount: 3, stability: 0.5, utilization: 90 }),
      score({ placementCount: 3, stability: 1, utilization: 70 }),
      score({ placementCount: 3, stability: 1, utilization: 70, unplacedCount: 2 }),
    ];
    for (const a of plans) {
      for (const b of plans) {
        // Opposite signs, summing to zero — and zero for a plan against
        // itself, without tripping over -0 the way comparing signs would.
        expect(Math.sign(compareScores(a, b)) + Math.sign(compareScores(b, a))).toBe(0);
      }
    }
    // Same input, same order, every time.
    const once = [...plans].sort(compareScores);
    expect([...plans].sort(compareScores)).toEqual(once);
  });
});
