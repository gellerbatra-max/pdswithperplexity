import Dexie, { type Table } from 'dexie';
import type { MarkerDocument } from '@/marker/schema';
import { RESTORE_POINT_LIMIT, type MarkerRepository, type RestorePoint } from './repository';

/**
 * Local persistence. Every customer document stays on this machine.
 *
 * Documents are stored as plain structured-cloneable objects, which a
 * MarkerDocument already is — no serialisation step, and no chance of the
 * stored shape drifting from the in-memory one.
 */
class MarkerDatabase extends Dexie {
  markers!: Table<MarkerDocument>;
  restorePoints!: Table<RestorePoint>;

  constructor() {
    super('nestiq-marker');
    this.version(1).stores({
      markers: 'id, name, updatedAt',
      restorePoints: 'id, markerId, createdAt',
    });
    // schemaVersion 3 added lastOpenedAt. Existing rows need the field before
    // they can be indexed on it, or they drop out of `lastOpened` entirely.
    this.version(2)
      .stores({
        markers: 'id, name, updatedAt, lastOpenedAt',
        restorePoints: 'id, markerId, createdAt',
      })
      .upgrade((transaction) =>
        transaction
          .table<MarkerDocument>('markers')
          .toCollection()
          .modify((marker) => {
            marker.schemaVersion = 3;
            marker.lastOpenedAt = marker.lastOpenedAt ?? marker.updatedAt;
          }),
      );
  }
}

export const db = new MarkerDatabase();

export const dexieRepository: MarkerRepository = {
  saveMarker: async (document) => {
    await db.markers.put(document);
  },

  loadMarker: (id) => db.markers.get(id),

  // lastOpenedAt is ISO 8601, so lexical order is chronological order. Sorting
  // on updatedAt would surface whichever marker an auto-save touched last.
  lastOpened: () => db.markers.orderBy('lastOpenedAt').last(),

  listMarkers: () => db.markers.orderBy('lastOpenedAt').reverse().toArray(),

  addRestorePoint: async (point) => {
    await db.restorePoints.put(point);
    await dexieRepository.pruneRestorePoints(point.markerId, RESTORE_POINT_LIMIT);
  },

  listRestorePoints: (markerId) =>
    db.restorePoints.where('markerId').equals(markerId).sortBy('createdAt'),

  pruneRestorePoints: async (markerId, keep) => {
    const points = await db.restorePoints.where('markerId').equals(markerId).sortBy('createdAt');
    const excess = points.slice(0, Math.max(0, points.length - keep));
    if (excess.length === 0) return 0;
    await db.restorePoints.bulkDelete(excess.map((point) => point.id));
    return excess.length;
  },
};
