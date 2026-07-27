/**
 * In-memory MarkerRepository for tests.
 *
 * Not a .test.ts file — vitest would try to run it. Kept beside the interface
 * it implements so a change to one is obvious in the other.
 */

import type { MarkerDocument } from '@/marker/schema';
import type { MarkerRepository, RestorePoint } from './repository';

export interface MemoryRepository extends MarkerRepository {
  readonly markers: Map<string, MarkerDocument>;
  readonly points: Map<string, RestorePoint>;
  /** Writes attempted, including ones made to fail. */
  saveCount: () => number;
  /** Make the next `count` writes reject, to exercise the error path. */
  failNextSaves: (count: number, message?: string) => void;
}

export const createMemoryRepository = (): MemoryRepository => {
  const markers = new Map<string, MarkerDocument>();
  const points = new Map<string, RestorePoint>();
  let saves = 0;
  let failures = 0;
  let failureMessage = 'disk full';

  const byCreatedAt = (markerId: string): RestorePoint[] =>
    [...points.values()]
      .filter((point) => point.markerId === markerId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const repository: MemoryRepository = {
    markers,
    points,
    saveCount: () => saves,
    failNextSaves: (count, message = 'disk full') => {
      failures = count;
      failureMessage = message;
    },

    saveMarker: async (document) => {
      saves += 1;
      if (failures > 0) {
        failures -= 1;
        throw new Error(failureMessage);
      }
      // Stored by value, as IndexedDB would: a later mutation of the live
      // object must not appear to have been saved.
      markers.set(document.id, structuredClone(document));
    },

    loadMarker: async (id) => markers.get(id),

    lastOpened: async () =>
      [...markers.values()].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1),

    listMarkers: async () =>
      [...markers.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),

    addRestorePoint: async (point) => {
      points.set(point.id, structuredClone(point));
      await repository.pruneRestorePoints(point.markerId, 20);
    },

    listRestorePoints: async (markerId) => byCreatedAt(markerId),

    pruneRestorePoints: async (markerId, keep) => {
      const ordered = byCreatedAt(markerId);
      const excess = ordered.slice(0, Math.max(0, ordered.length - keep));
      for (const point of excess) points.delete(point.id);
      return excess.length;
    },
  };

  return repository;
};
