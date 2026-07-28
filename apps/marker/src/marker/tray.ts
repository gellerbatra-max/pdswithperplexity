/**
 * Grouping for the piece tray.
 *
 * The tray lists one row per piece × size × fabric code, not one per bundle —
 * a 24-bundle order would otherwise scroll for pages. Pure read helpers, no
 * React and no store.
 */

import type { TrayPiece } from './schema';

export interface TrayGroup {
  /** Stable across renders: the grouping key itself. */
  readonly key: string;
  readonly name: string;
  readonly size: string;
  readonly fabricCode: string;
  /** Totals across every bundle in the group. */
  readonly quantity: number;
  readonly placed: number;
  readonly members: TrayPiece[];
}

const keyOf = (piece: TrayPiece): string =>
  `${piece.name} ${piece.size} ${piece.fabricCode}`;

/**
 * Takes just the tray rather than the whole document, so a caller can memoise
 * on `trayPieces` alone — the tray does not change when a piece is dragged.
 */
export const trayGroups = (source: { readonly trayPieces: readonly TrayPiece[] }): TrayGroup[] => {
  const groups = new Map<string, TrayGroup>();

  for (const piece of source.trayPieces) {
    const key = keyOf(piece);
    const existing = groups.get(key);
    if (existing) {
      existing.members.push(piece);
      groups.set(key, {
        ...existing,
        quantity: existing.quantity + piece.quantity,
        placed: existing.placed + piece.placed,
      });
      continue;
    }
    groups.set(key, {
      key,
      name: piece.name,
      size: piece.size,
      fabricCode: piece.fabricCode,
      quantity: piece.quantity,
      placed: piece.placed,
      members: [piece],
    });
  }

  return [...groups.values()];
};

/** The next bundle in this group with something left to place. */
export const nextPlaceable = (group: TrayGroup): TrayPiece | undefined =>
  group.members.find((piece) => piece.placed < piece.quantity);

/** Everything left to place in this row. */
export const remainingOf = (group: TrayGroup): number =>
  Math.max(0, group.quantity - group.placed);

export interface TrayBundle {
  readonly bundle: string;
  readonly groups: TrayGroup[];
  readonly quantity: number;
  readonly placed: number;
  /** Every piece in the bundle is on the marker. */
  readonly complete: boolean;
}

/** Case-insensitive match across the fields a row actually shows. */
export const matchesQuery = (group: TrayGroup, bundle: string, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return [group.name, group.size, group.fabricCode, bundle]
    .join(' ')
    .toLowerCase()
    .includes(needle);
};

/**
 * The tray as bundle sections, each grouped by piece × size × fabric.
 *
 * Two levels, because they answer different questions: the bundle is the unit
 * of work a marker maker thinks in, and within it the row is what they click.
 * The inner grouping is the existing `trayGroups`, run per bundle rather than
 * across the whole tray.
 *
 * Finished work sorts to the bottom at both levels — a completed row is a
 * record, not a thing to do, and leaving it in place pushes the remaining work
 * off the bottom of a long order.
 */
export const trayBundles = (
  source: { readonly trayPieces: readonly TrayPiece[] },
  query = '',
): TrayBundle[] => {
  const byBundle = new Map<string, TrayPiece[]>();
  for (const piece of source.trayPieces) {
    const bucket = byBundle.get(piece.bundle);
    if (bucket) bucket.push(piece);
    else byBundle.set(piece.bundle, [piece]);
  }

  const bundles: TrayBundle[] = [];
  for (const [bundle, pieces] of byBundle) {
    const groups = trayGroups({ trayPieces: pieces })
      .filter((group) => matchesQuery(group, bundle, query))
      .sort((a, b) => {
        const aDone = remainingOf(a) === 0 ? 1 : 0;
        const bDone = remainingOf(b) === 0 ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        return a.name.localeCompare(b.name);
      });

    if (groups.length === 0) continue;

    const quantity = groups.reduce((sum, group) => sum + group.quantity, 0);
    const placed = groups.reduce((sum, group) => sum + group.placed, 0);
    bundles.push({ bundle, groups, quantity, placed, complete: placed >= quantity });
  }

  return bundles.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? 1 : -1;
    return a.bundle.localeCompare(b.bundle);
  });
};
