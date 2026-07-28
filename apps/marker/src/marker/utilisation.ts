/**
 * Reading a utilisation figure as good, fair or poor.
 *
 * Fabric is the largest cost in a cut garment, so this number is the one a
 * marker maker is judged on. The bands below are the ones the trade uses:
 * under 70% something is wrong with the marker, 70–85% is ordinary work, and
 * 85% and up is a good marker. They are a judgement, not a law — a stiff
 * fabric with a strict lay direction will never reach the top band, and a
 * factory with its own standard should change these two numbers.
 *
 * Pure: a number in, a band out.
 */

export type UtilisationBand = 'low' | 'fair' | 'good';

/** Below this, the marker needs rework rather than a nudge. */
export const UTILISATION_FAIR = 70;

/** At or above this, the marker is doing well. */
export const UTILISATION_GOOD = 85;

export const utilisationBand = (percent: number): UtilisationBand => {
  if (!Number.isFinite(percent) || percent < UTILISATION_FAIR) return 'low';
  if (percent < UTILISATION_GOOD) return 'fair';
  return 'good';
};

/**
 * How much of the bar to fill, 0–100.
 *
 * Clamped, because utilisation can exceed 100 when pieces overlap — the bar
 * would otherwise run past its track and read as a rendering fault instead of
 * the placement fault it is.
 */
export const utilisationFill = (percent: number): number => {
  if (!Number.isFinite(percent) || percent <= 0) return 0;
  return Math.min(100, percent);
};
