/**
 * Connecting the document store to local storage.
 *
 * Owns the subscription, the page-hide flush, and what happens on startup.
 * Everything here takes a MarkerRepository, so the whole flow can be driven by
 * an in-memory fake in a test.
 */

import type { MarkerDocument } from '@/marker/schema';
import { useMarkerStore } from '@/store/markerStore';
import { usePersistenceStore } from '@/store/persistenceStore';
import { createSeedMarker } from '@/store/seedMarker';
import { createAutoSave, type AutoSave } from './autoSave';
import { dexieRepository } from './database';
import type { MarkerRepository, RestorePoint } from './repository';

export interface Persistence {
  readonly autoSave: AutoSave;
  readonly stop: () => void;
}

export const startPersistence = (
  repository: MarkerRepository = dexieRepository,
): Persistence => {
  const persistence = usePersistenceStore.getState();

  const autoSave = createAutoSave({
    repository,
    hooks: {
      onPending: () => usePersistenceStore.getState().setSaveState('unsaved'),
      onSaving: () => usePersistenceStore.getState().setSaveState('saving'),
      onSaved: (at) => usePersistenceStore.getState().markSaved(at),
      onError: (message) => usePersistenceStore.getState().markFailed(message),
    },
  });

  const unsubscribe = useMarkerStore.subscribe((state, previous) => {
    // Only document changes matter; selection and camera live elsewhere, and
    // an undo-stack change without a document change is not a document edit.
    if (!state.document || state.document === previous.document) return;
    autoSave.schedule(state.document);
  });

  // A closing tab never runs a pending timer, so the last two seconds of work
  // would be lost. visibilitychange is the only hook that fires reliably on
  // mobile; beforeunload does not.
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') void autoSave.flush();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  persistence.setSaveState('idle');

  return {
    autoSave,
    stop: () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      autoSave.cancel();
    },
  };
};

export interface RestoreOutcome {
  readonly marker: MarkerDocument;
  readonly restored: boolean;
}

/**
 * Reopen the last marker, or start a new one.
 *
 * A document that came off disk is already saved, so the caller cancels the
 * write the store subscription would otherwise schedule.
 */
export const restoreOrSeed = async (
  repository: MarkerRepository = dexieRepository,
  persistence?: Persistence,
  openedAt: string = new Date().toISOString(),
): Promise<RestoreOutcome> => {
  let stored: MarkerDocument | undefined;
  try {
    stored = await repository.lastOpened();
  } catch (error) {
    usePersistenceStore
      .getState()
      .markFailed(error instanceof Error ? error.message : 'Could not read local storage');
  }

  if (stored) {
    // Stamp the open before handing it to the store, and write it straight
    // through: this is the one field that changes without being an edit, so
    // it must not ride on the debounce or it will be lost on a quick close.
    const opened: MarkerDocument = { ...stored, lastOpenedAt: openedAt };
    useMarkerStore.getState().loadMarker(opened);
    persistence?.autoSave.cancel();
    try {
      await repository.saveMarker(opened);
      usePersistenceStore.getState().markSaved(openedAt);
    } catch {
      // A failed stamp is not worth blocking the open; the next edit saves.
      usePersistenceStore.getState().markSaved(stored.updatedAt);
    }
    return { marker: opened, restored: true };
  }

  const seeded = createSeedMarker();
  useMarkerStore.getState().loadMarker(seeded);
  return { marker: seeded, restored: false };
};

/**
 * Snapshot the current document before something destructive.
 *
 * TODO(step-9): call this before every Auto-Nest run, which is the case the
 * spec names. The repository prunes to the retention limit on insert.
 */
export const createRestorePoint = async (
  label: string,
  repository: MarkerRepository = dexieRepository,
  id: string = crypto.randomUUID(),
  at: string = new Date().toISOString(),
): Promise<RestorePoint | null> => {
  const marker = useMarkerStore.getState().document;
  if (!marker) return null;

  const point: RestorePoint = {
    id,
    markerId: marker.id,
    label,
    snapshot: marker,
    createdAt: at,
  };
  await repository.addRestorePoint(point);
  return point;
};
