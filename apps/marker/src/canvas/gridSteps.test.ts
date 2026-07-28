import { describe, expect, it } from 'vitest';
import { chooseStep, formatTick, majorStep, stepsAcross } from './gridSteps';

describe('chooseStep', () => {
  it('keeps a 1 cm step when there is room for it', () => {
    // 20 px per cm: a 1 cm grid is already 20 px apart.
    expect(chooseStep(20, 8)).toBe(1);
  });

  it('opens up as the view zooms out', () => {
    const zoomedIn = chooseStep(20, 8);
    const normal = chooseStep(2, 8);
    const zoomedOut = chooseStep(0.2, 8);
    expect(normal).toBeGreaterThan(zoomedIn);
    expect(zoomedOut).toBeGreaterThan(normal);
  });

  it('only ever returns 1, 2 or 5 times a power of ten', () => {
    for (const scale of [0.01, 0.05, 0.2, 0.7, 1, 2, 3.3, 8, 25, 100]) {
      const step = chooseStep(scale, 8);
      const mantissa = step / 10 ** Math.floor(Math.log10(step));
      expect([1, 2, 5]).toContain(Math.round(mantissa));
    }
  });

  it('always clears the requested gap', () => {
    for (const scale of [0.05, 0.3, 1, 2.5, 7, 40]) {
      expect(chooseStep(scale, 8) * scale).toBeGreaterThanOrEqual(8);
    }
  });

  it('never goes below the minimum step', () => {
    expect(chooseStep(1000, 8)).toBe(1);
    expect(chooseStep(1000, 8, 5)).toBe(5);
  });

  it('survives a nonsense scale rather than looping', () => {
    expect(chooseStep(0, 8)).toBe(1);
    expect(chooseStep(-3, 8)).toBe(1);
    expect(chooseStep(Number.NaN, 8)).toBe(1);
  });
});

describe('majorStep', () => {
  it('lands on a power of ten whatever the minor is', () => {
    // A marker maker counts in metres; a major line at 25 cm is worse than none.
    expect(majorStep(1)).toBe(10);
    expect(majorStep(2)).toBe(10);
    expect(majorStep(5)).toBe(10);
    expect(majorStep(10)).toBe(100);
    expect(majorStep(20)).toBe(100);
    expect(majorStep(50)).toBe(100);
  });

  it('is always a whole multiple of the minor, so majors sit on minors', () => {
    for (const step of [1, 2, 5, 10, 20, 50, 100]) {
      expect(majorStep(step) % step).toBe(0);
    }
  });
});

describe('stepsAcross', () => {
  it('covers the multiples inside a span', () => {
    expect(stepsAcross(0, 100, 10)).toEqual({ first: 0, last: 10 });
  });

  it('starts at the first multiple past the near edge', () => {
    expect(stepsAcross(12, 47, 10)).toEqual({ first: 2, last: 4 });
  });

  it('is empty when no multiple falls inside', () => {
    const range = stepsAcross(11, 19, 100);
    expect(range.last).toBeLessThan(range.first);
  });

  it('handles a negative near edge, which panning produces', () => {
    expect(stepsAcross(-25, 25, 10)).toEqual({ first: -2, last: 2 });
  });

  it('returns an empty range rather than looping on bad input', () => {
    for (const range of [
      stepsAcross(0, 100, 0),
      stepsAcross(0, 100, -5),
      stepsAcross(Number.NaN, 100, 10),
    ]) {
      expect(range.last).toBeLessThan(range.first);
    }
  });
});

describe('formatTick', () => {
  it('drops the decimal on whole centimetres', () => {
    expect(formatTick(0)).toBe('0');
    expect(formatTick(150)).toBe('150');
  });

  it('keeps one decimal on a fractional step', () => {
    expect(formatTick(2.5)).toBe('2.5');
  });
});
