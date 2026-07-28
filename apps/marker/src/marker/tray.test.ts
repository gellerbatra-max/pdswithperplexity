import { describe, expect, it } from 'vitest';
import type { MarkerDocument, Point, TrayPiece } from './schema';
import { matchesQuery, nextPlaceable, remainingOf, trayBundles, trayGroups } from './tray';

const rect: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
];

const tray = (
  id: string,
  name: string,
  bundle: string,
  quantity: number,
  placed: number,
  fabricCode = 'A',
): TrayPiece => ({
  id,
  name,
  size: 'M',
  bundle,
  fabricCode,
  geometry: rect,
  layDirection: '2way',
  quantity,
  placed,
});

const doc = (trayPieces: TrayPiece[]): MarkerDocument => ({
  id: 'doc-1',
  schemaVersion: 3,
  name: 'Test',
  fabricWidth: 150,
  endAllowance: 4,
  rotationRule: 'free',
  cutterBuffer: 0,
  pieces: [],
  trayPieces,
  defectZones: [],
  spliceLines: [],
  order: { model: '', sizes: [] },
  approvalState: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
});

describe('trayGroups', () => {
  it('is empty for an empty tray', () => {
    expect(trayGroups(doc([]))).toEqual([]);
  });

  it('merges the same piece across bundles', () => {
    const groups = trayGroups(
      doc([tray('f1', 'Front', 'B1', 1, 1), tray('f2', 'Front', 'B2', 1, 0)]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]?.quantity).toBe(2);
    expect(groups[0]?.placed).toBe(1);
    expect(groups[0]?.members).toHaveLength(2);
  });

  it('keeps different sizes apart', () => {
    const small = tray('f1', 'Front', 'B1', 1, 0);
    const large: TrayPiece = { ...tray('f2', 'Front', 'B1', 1, 0), size: 'L' };
    expect(trayGroups(doc([small, large]))).toHaveLength(2);
  });

  it('keeps different fabric codes apart', () => {
    const groups = trayGroups(
      doc([tray('f1', 'Front', 'B1', 1, 0), tray('f2', 'Front', 'B1', 1, 0, 'B')]),
    );
    expect(groups).toHaveLength(2);
  });

  it('preserves document order', () => {
    const groups = trayGroups(
      doc([
        tray('s1', 'Sleeve', 'B1', 1, 0),
        tray('f1', 'Front', 'B1', 1, 0),
        tray('s2', 'Sleeve', 'B2', 1, 0),
      ]),
    );
    expect(groups.map((group) => group.name)).toEqual(['Sleeve', 'Front']);
  });
});

describe('nextPlaceable', () => {
  it('finds the first bundle with something left', () => {
    const groups = trayGroups(
      doc([tray('f1', 'Front', 'B1', 1, 1), tray('f2', 'Front', 'B2', 1, 0)]),
    );
    const group = groups[0];
    if (!group) throw new Error('expected a group');
    expect(nextPlaceable(group)?.id).toBe('f2');
  });

  it('is undefined once everything is placed', () => {
    const groups = trayGroups(doc([tray('f1', 'Front', 'B1', 2, 2)]));
    const group = groups[0];
    if (!group) throw new Error('expected a group');
    expect(nextPlaceable(group)).toBeUndefined();
  });
});

describe('remainingOf', () => {
  it('counts what is left to place', () => {
    const [group] = trayGroups(doc([tray('f1', 'Front', 'B1', 3, 1)]));
    expect(remainingOf(group!)).toBe(2);
  });

  it('never goes negative when more was placed than ordered', () => {
    const [group] = trayGroups(doc([tray('f1', 'Front', 'B1', 1, 3)]));
    expect(remainingOf(group!)).toBe(0);
  });
});

describe('matchesQuery', () => {
  const [group] = trayGroups(doc([tray('f1', 'Front Bodice', 'B1', 1, 0)]));

  it('matches everything on an empty query', () => {
    expect(matchesQuery(group!, 'B1', '')).toBe(true);
    expect(matchesQuery(group!, 'B1', '   ')).toBe(true);
  });

  it('matches on name, size, fabric or bundle', () => {
    expect(matchesQuery(group!, 'B1', 'bodice')).toBe(true);
    expect(matchesQuery(group!, 'B1', 'M')).toBe(true);
    expect(matchesQuery(group!, 'B1', 'A')).toBe(true);
    expect(matchesQuery(group!, 'B1', 'b1')).toBe(true);
  });

  it('ignores case', () => {
    expect(matchesQuery(group!, 'B1', 'FRONT')).toBe(true);
  });

  it('rejects what it does not contain', () => {
    expect(matchesQuery(group!, 'B1', 'sleeve')).toBe(false);
  });
});

describe('trayBundles', () => {
  const order = () =>
    doc([
      tray('f1', 'Front', 'B1', 1, 1),
      tray('s1', 'Sleeve', 'B1', 2, 0),
      tray('f2', 'Front', 'B2', 1, 0),
      tray('b2', 'Back', 'B2', 1, 0),
    ]);

  it('is empty for an empty tray', () => {
    expect(trayBundles(doc([]))).toEqual([]);
  });

  it('splits the tray into one section per bundle', () => {
    expect(trayBundles(order()).map((b) => b.bundle)).toEqual(['B1', 'B2']);
  });

  it('groups within a bundle by piece, size and fabric', () => {
    const bundles = trayBundles(doc([tray('a', 'Front', 'B1', 1, 0), tray('b', 'Front', 'B1', 1, 0)]));
    // Two entries of the same piece in one bundle collapse to a single row.
    expect(bundles[0]?.groups).toHaveLength(1);
    expect(bundles[0]?.groups[0]?.quantity).toBe(2);
  });

  it('does not merge the same piece across different bundles', () => {
    // The flat tray view merges them; the bundle view must not, or a bundle
    // would show work belonging to another.
    const bundles = trayBundles(order());
    expect(bundles.find((b) => b.bundle === 'B1')?.groups.map((g) => g.name).sort()).toEqual([
      'Front',
      'Sleeve',
    ]);
  });

  it('totals placed and quantity per bundle', () => {
    const b1 = trayBundles(order()).find((b) => b.bundle === 'B1');
    expect(b1?.quantity).toBe(3);
    expect(b1?.placed).toBe(1);
    expect(b1?.complete).toBe(false);
  });

  it('marks a bundle complete once everything is placed', () => {
    const bundles = trayBundles(doc([tray('f1', 'Front', 'B1', 2, 2)]));
    expect(bundles[0]?.complete).toBe(true);
  });

  it('sorts finished rows to the bottom of their bundle', () => {
    const bundles = trayBundles(
      doc([
        tray('done', 'Aaa done', 'B1', 1, 1),
        tray('todo', 'Zzz todo', 'B1', 1, 0),
      ]),
    );
    // Alphabetically 'Aaa' leads, but it is finished, so it goes last.
    expect(bundles[0]?.groups.map((g) => g.name)).toEqual(['Zzz todo', 'Aaa done']);
  });

  it('sorts finished bundles to the bottom', () => {
    const bundles = trayBundles(
      doc([tray('a', 'Front', 'AAA', 1, 1), tray('b', 'Front', 'ZZZ', 1, 0)]),
    );
    expect(bundles.map((b) => b.bundle)).toEqual(['ZZZ', 'AAA']);
  });

  it('filters rows by query and drops bundles left with nothing', () => {
    const bundles = trayBundles(order(), 'sleeve');
    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.bundle).toBe('B1');
    expect(bundles[0]?.groups.map((g) => g.name)).toEqual(['Sleeve']);
  });

  it('matches a bundle name as well as a piece name', () => {
    const bundles = trayBundles(order(), 'B2');
    expect(bundles.map((b) => b.bundle)).toEqual(['B2']);
  });

  it('returns nothing when the query matches nothing', () => {
    expect(trayBundles(order(), 'zzzz')).toEqual([]);
  });
});
