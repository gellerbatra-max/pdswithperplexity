import type { Unit } from './types';

/** Millimetres are the canonical internal unit; everything converts through mm. */
const MM_PER_UNIT: Record<Unit, number> = {
  mm: 1,
  cm: 10,
  in: 25.4,
};

export const toMillimetres = (value: number, from: Unit): number => value * MM_PER_UNIT[from];

export const fromMillimetres = (mm: number, to: Unit): number => mm / MM_PER_UNIT[to];

export const formatLength = (mm: number, unit: Unit, fractionDigits = 1): string =>
  `${fromMillimetres(mm, unit).toFixed(fractionDigits)} ${unit}`;
