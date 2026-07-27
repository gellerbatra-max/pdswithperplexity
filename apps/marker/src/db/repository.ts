/**
 * What persistence has to provide, independent of how.
 *
 * Auto-save and app startup depend on this interface rather than on Dexie, so
 * both are testable against an in-memory fake — IndexedDB does not exist in a
 * Node test runner, and pulling in a shim to test debounce timing would be a
 * poor trade.
 */

import type { MarkerDocument } from '@/marker/schema';

export interface RestorePoint {
  id: string;
  markerId: string;
  label: string;
  snapshot: MarkerDocument;
  createdAt: string;
}

export interface MarkerRepository {
  saveMarker: (document: MarkerDocument) => Promise<void>;
  loadMarker: (id: string) => Promise<MarkerDocument | undefined>;
  /** The most recently updated marker — what the app reopens on load. */
  lastOpened: () => Promise<MarkerDocument | undefined>;
  listMarkers: () => Promise<MarkerDocument[]>;
  addRestorePoint: (point: RestorePoint) => Promise<void>;
  listRestorePoints: (markerId: string) => Promise<RestorePoint[]>;
  /** Drop the oldest points beyond `keep`, returning how many were removed. */
  pruneRestorePoints: (markerId: string, keep: number) => Promise<number>;
}

/** Restore points retained per marker, oldest discarded first. */
export const RESTORE_POINT_LIMIT = 20;
