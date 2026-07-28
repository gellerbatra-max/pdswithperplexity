import { describe, expect, it } from 'vitest';
import {
  UTILISATION_FAIR,
  UTILISATION_GOOD,
  utilisationBand,
  utilisationFill,
} from './utilisation';

describe('utilisationBand', () => {
  it('calls a poor marker low', () => {
    expect(utilisationBand(0)).toBe('low');
    expect(utilisationBand(52.4)).toBe('low');
  });

  it('calls ordinary work fair', () => {
    expect(utilisationBand(70)).toBe('fair');
    expect(utilisationBand(80)).toBe('fair');
  });

  it('calls a good marker good', () => {
    expect(utilisationBand(85)).toBe('good');
    expect(utilisationBand(92.5)).toBe('good');
  });

  it('puts each boundary in the higher band', () => {
    expect(utilisationBand(UTILISATION_FAIR - 0.01)).toBe('low');
    expect(utilisationBand(UTILISATION_FAIR)).toBe('fair');
    expect(utilisationBand(UTILISATION_GOOD - 0.01)).toBe('fair');
    expect(utilisationBand(UTILISATION_GOOD)).toBe('good');
  });

  it('treats any unmeasurable figure as low, never as good', () => {
    // Neither can arise today — the selector guards its own divide by zero —
    // but a bar claiming a marker is good on a number nobody can measure is
    // the worst of the available failures.
    expect(utilisationBand(Number.NaN)).toBe('low');
    expect(utilisationBand(Number.POSITIVE_INFINITY)).toBe('low');
  });
});

describe('utilisationFill', () => {
  it('fills proportionally', () => {
    expect(utilisationFill(0)).toBe(0);
    expect(utilisationFill(42.5)).toBe(42.5);
    expect(utilisationFill(100)).toBe(100);
  });

  it('clamps past full, which overlapping pieces produce', () => {
    // Over 100% is a placement fault; a bar running past its track would read
    // as a rendering fault instead.
    expect(utilisationFill(140)).toBe(100);
  });

  it('never goes negative', () => {
    expect(utilisationFill(-10)).toBe(0);
    expect(utilisationFill(Number.NaN)).toBe(0);
  });
});
