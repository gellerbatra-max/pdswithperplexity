/**
 * Choosing grid and ruler intervals that suit the current zoom.
 *
 * A fixed 10 cm grid is a grey smear zoomed out and a sparse suggestion zoomed
 * in. The interval has to climb as the scale falls, and it has to climb through
 * numbers a person reads as round — 20 cm and 50 cm are intervals a marker
 * maker counts in; 16 cm and 32 cm are not.
 *
 * Pure: numbers in, numbers out.
 */

/** 1-2-5 within each decade, which is what reads as round at any magnitude. */
const MANTISSAS = [1, 2, 5] as const;

/**
 * Smallest round interval, in cm, whose on-screen gap clears `minGapPx`.
 *
 * Returns at least `minStepCm` so a very deep zoom does not produce a
 * sub-millimetre grid nobody asked for.
 */
export const chooseStep = (
  scalePxPerCm: number,
  minGapPx: number,
  minStepCm = 1,
): number => {
  if (!Number.isFinite(scalePxPerCm) || scalePxPerCm <= 0) return minStepCm;

  const wanted = minGapPx / scalePxPerCm;
  if (wanted <= minStepCm) return minStepCm;

  // Walk decades upward from the one below `wanted` and take the first
  // 1/2/5 multiple that is large enough.
  const decade = Math.floor(Math.log10(wanted));
  for (let power = decade; power <= decade + 2; power += 1) {
    for (const mantissa of MANTISSAS) {
      const step = mantissa * 10 ** power;
      if (step >= wanted && step >= minStepCm) return step;
    }
  }
  return 10 ** (decade + 3);
};

/**
 * The heavier line, always landing on a power of ten.
 *
 * A 1/2/5 minor is multiplied by 10/5/2 respectively, so majors fall on 10,
 * 100, 1000 rather than on 25 or 250 — a marker maker counts in metres, and a
 * major line at 25 cm is worse than none.
 */
export const majorStep = (step: number): number => {
  const power = 10 ** Math.floor(Math.log10(step));
  const mantissa = Math.round(step / power);
  if (mantissa === 1) return step * 10;
  if (mantissa === 2) return step * 5;
  return step * 2;
};

/**
 * Range of multiples of `step` covering a span, inclusive.
 *
 * Used to draw only the lines the viewport can actually show, so the cost of a
 * grid does not grow with the length of the marker.
 */
export const stepsAcross = (
  fromCm: number,
  toCm: number,
  step: number,
): { first: number; last: number } => {
  if (step <= 0 || !Number.isFinite(fromCm) || !Number.isFinite(toCm)) {
    return { first: 0, last: -1 };
  }
  return { first: Math.ceil(fromCm / step), last: Math.floor(toCm / step) };
};

/** Ruler labels drop decimals once the interval is a whole number of cm. */
export const formatTick = (cm: number): string =>
  Number.isInteger(cm) ? String(cm) : cm.toFixed(1);
