import { beforeEach, describe, expect, it } from 'vitest';
import type { MarkerDocument } from '@/marker/schema';
import { useMarkerStore } from '@/store/markerStore';
import { usePersistenceStore } from '@/store/persistenceStore';
import { createMemoryRepository } from './memoryRepository';
import { closeMarker, createRestorePoint, listRecentMarkers, openMarker } from './persistence';
import { RESTORE_POINT_LIMIT } from './repository';

const doc = (id: string, updatedAt: string, name = id): MarkerDocument => ({
  id,
  schemaVersion: 3,
  name,
  fabricWidth: 150,
  endAllowance: 4,
  rotationRule: 'free',
  cutterBuffer: 0,
  pieces: [],
  trayPieces: [],
  defectZones: [],
  spliceLines: [],
  order: { model: '', sizes: [] },
  approvalState: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt,
  lastOpenedAt: updatedAt,
});

beforeEach(() => {
  useMarkerStore.setState({ document: null, past: [], future: [] });
  usePersistenceStore.setState({ saveState: 'idle', lastSavedAt: null, lastError: null });
});

describe('openMarker', () => {
  it('loads the marker into the store', async () => {
    const repository = createMemoryRepository();
    await openMarker(doc('m1', '2026-06-01T00:00:00.000Z'), repository, undefined, '2026-07-01T09:00:00.000Z');
    expect(useMarkerStore.getState().document?.id).toBe('m1');
  });

  it('opens with an empty undo history', async () => {
    const repository = createMemoryRepository();
    await openMarker(doc('m1', '2026-06-01T00:00:00.000Z'), repository);
    expect(useMarkerStore.getState().past).toEqual([]);
    expect(useMarkerStore.getState().future).toEqual([]);
  });

  it('stamps lastOpenedAt and writes it straight through', async () => {
    const repository = createMemoryRepository();
    const opened = await openMarker(
      doc('m1', '2026-06-01T00:00:00.000Z'),
      repository,
      undefined,
      '2026-07-01T09:00:00.000Z',
    );

    expect(opened.lastOpenedAt).toBe('2026-07-01T09:00:00.000Z');
    // Written immediately, not left on the debounce, or a quick close loses
    // it — and it is what orders the home screen.
    expect(repository.markers.get('m1')?.lastOpenedAt).toBe('2026-07-01T09:00:00.000Z');
  });

  it('marks the document saved, since it was just written', async () => {
    const repository = createMemoryRepository();
    await openMarker(doc('m1', '2026-06-01T00:00:00.000Z'), repository, undefined, '2026-07-01T09:00:00.000Z');
    expect(usePersistenceStore.getState().saveState).toBe('saved');
    expect(usePersistenceStore.getState().lastSavedAt).toBe('2026-07-01T09:00:00.000Z');
  });

  it('still opens when the stamp cannot be written', async () => {
    const repository = createMemoryRepository();
    repository.failNextSaves(1, 'quota exceeded');
    await openMarker(doc('m1', '2026-06-01T00:00:00.000Z'), repository);

    expect(useMarkerStore.getState().document?.id).toBe('m1');
    expect(usePersistenceStore.getState().lastError).toBe('quota exceeded');
  });
});

describe('closeMarker', () => {
  it('leaves no marker open, which is what shows the home screen', async () => {
    const repository = createMemoryRepository();
    await openMarker(doc('m1', '2026-06-01T00:00:00.000Z'), repository);
    await closeMarker();
    expect(useMarkerStore.getState().document).toBeNull();
  });

  it('clears the undo history with the document', async () => {
    const repository = createMemoryRepository();
    await openMarker(doc('m1', '2026-06-01T00:00:00.000Z'), repository);
    useMarkerStore.getState().setFabricWidth(180);
    expect(useMarkerStore.getState().past).toHaveLength(1);

    await closeMarker();
    // Undoing back into a closed marker would resurrect it uninvited.
    expect(useMarkerStore.getState().past).toEqual([]);
  });
});

describe('listRecentMarkers', () => {
  it('is empty when nothing is stored', async () => {
    expect(await listRecentMarkers(createMemoryRepository())).toEqual([]);
  });

  it('orders by lastOpenedAt, most recent first', async () => {
    const repository = createMemoryRepository();
    await repository.saveMarker({ ...doc('old', '2026-06-30T00:00:00.000Z'), lastOpenedAt: '2026-01-01T00:00:00.000Z' });
    await repository.saveMarker({ ...doc('recent', '2026-02-01T00:00:00.000Z'), lastOpenedAt: '2026-06-01T00:00:00.000Z' });

    // 'old' was written last but opened long ago; the list is about what the
    // user was working on, not what a background save happened to touch.
    expect((await listRecentMarkers(repository)).map((m) => m.id)).toEqual(['recent', 'old']);
  });

  it('reports a storage failure and returns an empty list', async () => {
    const repository = createMemoryRepository();
    const broken = {
      ...repository,
      listMarkers: async () => {
        throw new Error('IndexedDB is disabled');
      },
    };

    expect(await listRecentMarkers(broken)).toEqual([]);
    expect(usePersistenceStore.getState().lastError).toBe('IndexedDB is disabled');
  });
});

describe('deleteMarker', () => {
  it('removes the marker and its restore points together', async () => {
    const repository = createMemoryRepository();
    await repository.saveMarker(doc('m1', '2026-06-01T00:00:00.000Z'));
    useMarkerStore.getState().loadMarker(doc('m1', '2026-06-01T00:00:00.000Z'));
    await createRestorePoint('snap', repository, 'rp-1', '2026-06-02T00:00:00.000Z');

    await repository.deleteMarker('m1');

    expect(await repository.loadMarker('m1')).toBeUndefined();
    // Snapshots of a deleted marker can never be restored into anything.
    expect(await repository.listRestorePoints('m1')).toEqual([]);
  });

  it('leaves other markers alone', async () => {
    const repository = createMemoryRepository();
    await repository.saveMarker(doc('m1', '2026-06-01T00:00:00.000Z'));
    await repository.saveMarker(doc('m2', '2026-06-02T00:00:00.000Z'));
    await repository.deleteMarker('m1');
    expect((await repository.listMarkers()).map((m) => m.id)).toEqual(['m2']);
  });
});

describe('createRestorePoint', () => {
  it('does nothing when no marker is open', async () => {
    const repository = createMemoryRepository();
    expect(await createRestorePoint('before auto-nest', repository)).toBeNull();
  });

  it('snapshots the open marker', async () => {
    const repository = createMemoryRepository();
    useMarkerStore.getState().loadMarker(doc('m1', '2026-06-01T00:00:00.000Z'));

    const point = await createRestorePoint(
      'before auto-nest',
      repository,
      'rp-1',
      '2026-06-02T00:00:00.000Z',
    );

    expect(point?.label).toBe('before auto-nest');
    expect(point?.markerId).toBe('m1');
    expect(await repository.listRestorePoints('m1')).toHaveLength(1);
  });

  it(`keeps at most ${RESTORE_POINT_LIMIT} points and drops the oldest`, async () => {
    const repository = createMemoryRepository();
    useMarkerStore.getState().loadMarker(doc('m1', '2026-06-01T00:00:00.000Z'));

    for (let i = 0; i < RESTORE_POINT_LIMIT + 5; i += 1) {
      const stamp = `2026-06-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`;
      await createRestorePoint(`point-${i}`, repository, `rp-${i}`, stamp);
    }

    const kept = await repository.listRestorePoints('m1');
    expect(kept).toHaveLength(RESTORE_POINT_LIMIT);
    // The first five fell off the back.
    expect(kept[0]?.label).toBe('point-5');
  });

  it('keeps each marker’s points separate', async () => {
    const repository = createMemoryRepository();

    useMarkerStore.getState().loadMarker(doc('m1', '2026-06-01T00:00:00.000Z'));
    await createRestorePoint('a', repository, 'rp-a', '2026-06-01T00:00:00.000Z');
    useMarkerStore.getState().loadMarker(doc('m2', '2026-06-02T00:00:00.000Z'));
    await createRestorePoint('b', repository, 'rp-b', '2026-06-02T00:00:00.000Z');

    expect(await repository.listRestorePoints('m1')).toHaveLength(1);
    expect(await repository.listRestorePoints('m2')).toHaveLength(1);
  });
});

describe('restore point snapshots', () => {
  it('captures the document as it was, not as it becomes', async () => {
    const repository = createMemoryRepository();
    useMarkerStore.getState().loadMarker(doc('m1', '2026-06-01T00:00:00.000Z', 'before'));

    await createRestorePoint('snap', repository, 'rp-1', '2026-06-02T00:00:00.000Z');
    useMarkerStore.getState().setFabricWidth(200);

    const [point] = await repository.listRestorePoints('m1');
    expect(point?.snapshot.fabricWidth).toBe(150);
    expect(useMarkerStore.getState().document?.fabricWidth).toBe(200);
  });
});
