import { describe, expect, it } from 'vitest';
import { fuzzyMatch, fuzzyRank } from './fuzzy';

describe('fuzzyMatch', () => {
  it('matches an exact substring', () => {
    expect(fuzzyMatch('rotate', 'Rotate clockwise')).not.toBeNull();
  });

  it('matches characters spread through the text', () => {
    // The whole point: this contains no such substring.
    expect(fuzzyMatch('rotcw', 'Rotate clockwise')).not.toBeNull();
    expect(fuzzyMatch('bsl', 'Butt-slide left')).not.toBeNull();
  });

  it('ignores case in both directions', () => {
    expect(fuzzyMatch('ROTATE', 'Rotate clockwise')).not.toBeNull();
    expect(fuzzyMatch('rotate', 'ROTATE CLOCKWISE')).not.toBeNull();
  });

  it('rejects characters that are not there', () => {
    expect(fuzzyMatch('zzz', 'Rotate clockwise')).toBeNull();
  });

  it('rejects characters that are there but out of order', () => {
    // Subsequence, not bag-of-letters: "wc" is backwards for "clockwise".
    expect(fuzzyMatch('wcolc', 'clockwise')).toBeNull();
  });

  it('matches everything on an empty query, so the list keeps its order', () => {
    const match = fuzzyMatch('', 'Rotate clockwise');
    expect(match?.score).toBe(0);
    expect(match?.indices).toEqual([]);
  });

  it('reports where it matched, for highlighting', () => {
    const match = fuzzyMatch('rot', 'Rotate');
    expect(match?.indices).toEqual([0, 1, 2]);
  });

  it('scores a tight match above a scattered one', () => {
    // Both contain "flip" as a subsequence; only the first contains it whole.
    const tight = fuzzyMatch('flip', 'Flip horizontal');
    const scattered = fuzzyMatch('flip', 'Fold left in place');
    if (!tight || !scattered) throw new Error('both should match');
    expect(tight.score).toBeGreaterThan(scattered.score);
  });

  it('scores a word-start match above a mid-word one', () => {
    const wordStart = fuzzyMatch('c', 'Rotate clockwise');
    const midWord = fuzzyMatch('c', 'Deselect all');
    if (!wordStart || !midWord) throw new Error('both should match');
    expect(wordStart.score).toBeGreaterThan(midWord.score);
  });
});

describe('fuzzyRank', () => {
  const commands = [
    'Rotate clockwise',
    'Rotate counter-clockwise',
    'Flip horizontal',
    'Flip vertical',
    'Butt-slide left',
    'Undo',
  ];

  it('drops what does not match', () => {
    const ranked = fuzzyRank('flip', commands, (text) => text);
    expect(ranked.map((entry) => entry.item)).toEqual(['Flip horizontal', 'Flip vertical']);
  });

  it('puts the best match first', () => {
    const ranked = fuzzyRank('rotcc', commands, (text) => text);
    expect(ranked[0]?.item).toBe('Rotate counter-clockwise');
  });

  it('keeps the declared order for an empty query', () => {
    // A palette that reshuffles the moment it opens is disorienting.
    expect(fuzzyRank('', commands, (text) => text).map((entry) => entry.item)).toEqual(commands);
  });

  it('keeps the declared order among equal scores', () => {
    const ranked = fuzzyRank('rotate', commands, (text) => text);
    expect(ranked.map((entry) => entry.item)).toEqual([
      'Rotate clockwise',
      'Rotate counter-clockwise',
    ]);
  });

  it('returns nothing when nothing matches', () => {
    expect(fuzzyRank('zzzz', commands, (text) => text)).toEqual([]);
  });

  it('searches whatever text the caller supplies', () => {
    // The palette searches label plus keys, so "ctrl+z" finds undo.
    const items = [{ label: 'Undo', keys: 'Ctrl+Z' }, { label: 'Redo', keys: 'Ctrl+Y' }];
    const ranked = fuzzyRank('ctrl+z', items, (item) => `${item.label} ${item.keys}`);
    expect(ranked[0]?.item.label).toBe('Undo');
  });
});
