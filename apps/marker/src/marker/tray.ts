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
