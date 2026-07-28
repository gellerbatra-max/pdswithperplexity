/**
 * Ordering and filtering the recent-markers list.
 *
 * Pure, so the rules that decide what a user sees first are testable without
 * a database or a DOM.
 */

import { markerStatus, utilization } from './selectors';
import type { MarkerDocument } from './schema';

export type RecentSort = 'opened' | 'name' | 'utilisation' | 'created';

export const SORT_LABELS: Record<RecentSort, string> = {
  opened: 'Last opened',
  name: 'Name',
  utilisation: 'Utilisation',
  created: 'Date created',
};

/** Matches on the fields a card actually shows. */
export const matchesMarker = (marker: MarkerDocument, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return [marker.name, marker.order.model, markerStatus(marker)]
    .join(' ')
    .toLowerCase()
    .includes(needle);
};

/**
 * Filter, then sort.
 *
 * Timestamps are ISO 8601, so a string comparison is a chronological one.
 * Names use `localeCompare`, because a list sorted by code points puts
 * "Zip pouch" before "ätude" and looks broken to anyone who reads it.
 */
export const arrangeRecent = (
  markers: readonly MarkerDocument[],
  options: { query?: string; sort?: RecentSort } = {},
): MarkerDocument[] => {
  const query = options.query ?? '';
  const sort = options.sort ?? 'opened';

  const filtered = markers.filter((marker) => matchesMarker(marker, query));

  return [...filtered].sort((a, b) => {
    switch (sort) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'utilisation':
        // Best first: the useful question is "which of these went well".
        return utilization(b) - utilization(a);
      case 'created':
        return b.createdAt.localeCompare(a.createdAt);
      case 'opened':
      default:
        return b.lastOpenedAt.localeCompare(a.lastOpenedAt);
    }
  });
};

export interface RecentSummary {
  readonly markers: number;
  readonly pieces: number;
  readonly made: number;
}

/** One line of context above the grid, so the list is not just a wall of cards. */
export const summarise = (markers: readonly MarkerDocument[]): RecentSummary => ({
  markers: markers.length,
  pieces: markers.reduce((sum, marker) => sum + marker.pieces.length, 0),
  made: markers.filter((marker) => markerStatus(marker) === 'MADE').length,
});
