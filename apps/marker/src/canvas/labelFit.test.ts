import { describe, expect, it } from 'vitest';
import {
  LABEL_PADDING_PX,
  MIN_LABEL_FONT_PX,
  chooseTier,
  fitFontSize,
  usableSpace,
} from './labelFit';

describe('usableSpace', () => {
  it('takes the padding off both sides', () => {
    expect(usableSpace({ width: 100, height: 50 })).toEqual({
      width: 100 - LABEL_PADDING_PX * 2,
      height: 50 - LABEL_PADDING_PX * 2,
    });
  });

  it('goes negative for a piece narrower than its own padding', () => {
    // The caller reads this as "no room", rather than clamping to zero and
    // pretending a 2px piece can hold text.
    expect(usableSpace({ width: 2, height: 2 }).width).toBeLessThan(0);
  });
});

describe('fitFontSize', () => {
  it('keeps the preferred size when the text already fits', () => {
    expect(fitFontSize(40, 11, 100)).toBe(11);
  });

  it('shrinks proportionally when it does not', () => {
    // 80% of the room means 80% of the font — still above the readable floor.
    expect(fitFontSize(100, 12, 80)).toBe(9);
  });

  it('rounds down, so the fitted text never exceeds the space', () => {
    const fitted = fitFontSize(100, 11, 85);
    expect(fitted).not.toBeNull();
    expect(((fitted ?? 0) / 11) * 100).toBeLessThanOrEqual(85);
  });

  it('refuses to go below the readable floor', () => {
    // A 60px name in 10px of room would need a 2px font.
    expect(fitFontSize(60, 11, 10, MIN_LABEL_FONT_PX)).toBeNull();
  });

  it('honours a caller-supplied floor', () => {
    expect(fitFontSize(100, 12, 50, 6)).toBe(6);
    expect(fitFontSize(100, 12, 50, 7)).toBeNull();
  });

  it('returns null for nonsense rather than a nonsense font', () => {
    expect(fitFontSize(0, 11, 100)).toBeNull();
    expect(fitFontSize(40, 0, 100)).toBeNull();
    expect(fitFontSize(40, 11, 0)).toBeNull();
    expect(fitFontSize(40, 11, -5)).toBeNull();
  });
});

describe('chooseTier', () => {
  const base = {
    nameFits: true,
    sizeFits: true,
    hasSize: true,
    nameFontSize: 11,
    sizeFontSize: 10,
    truncatable: true,
  };

  it('gives a large piece the full two-line label', () => {
    expect(chooseTier({ ...base, space: { width: 200, height: 120 } })).toBe('full');
  });

  it('drops the size line when there is no height for two', () => {
    // 16px of usable height cannot hold an 11px and a 10px line.
    expect(chooseTier({ ...base, space: { width: 200, height: 22 } })).toBe('name');
  });

  it('drops the size line when the size itself will not fit across', () => {
    expect(chooseTier({ ...base, space: { width: 200, height: 120 }, sizeFits: false })).toBe(
      'name',
    );
  });

  it('shows just the name when the piece carries no size', () => {
    expect(chooseTier({ ...base, space: { width: 200, height: 120 }, hasSize: false })).toBe(
      'name',
    );
  });

  it('truncates when the name will not fit even shrunk', () => {
    expect(chooseTier({ ...base, space: { width: 40, height: 120 }, nameFits: false })).toBe(
      'truncated',
    );
  });

  it('shows nothing when the name cannot even be truncated usefully', () => {
    expect(
      chooseTier({
        ...base,
        space: { width: 40, height: 120 },
        nameFits: false,
        truncatable: false,
      }),
    ).toBe('none');
  });

  it('shows nothing on a piece with no usable width', () => {
    expect(chooseTier({ ...base, space: { width: 4, height: 120 } })).toBe('none');
  });

  it('shows nothing on a piece too short for one readable line', () => {
    // A 12px-tall piece leaves 6px once padded — below the readable floor.
    expect(chooseTier({ ...base, space: { width: 200, height: 12 } })).toBe('none');
  });

  it('never returns full without room for both lines', () => {
    for (let height = 0; height < 60; height += 1) {
      const tier = chooseTier({ ...base, space: { width: 300, height } });
      if (tier === 'full') {
        expect(usableSpace({ width: 300, height }).height).toBeGreaterThanOrEqual(
          base.nameFontSize + base.sizeFontSize,
        );
      }
    }
  });
});
