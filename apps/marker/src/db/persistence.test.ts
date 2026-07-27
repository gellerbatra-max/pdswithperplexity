import { beforeEach, describe, expect, it } from 'vitest';
import type { MarkerDocument } from '@/marker/schema';
import { useMarkerStore } from '@/store/markerStore';
import { usePersistenceStore } from '@/store/persistenceStore';
import { createMemoryRepository } from './memoryRepository';
import { createRestorePoint, restoreOrSeed } from './persistence';
import { RESTORE_POINT_LIMIT } from './repository';

const doc = (id: string, updatedAt: string, name = id): MarkerDocument => ({
  id,
  schemaVersion: 2,
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
});

beforeEach(() => {
  useMarkerStore.setState({ document: null, past: [], future: [] });
  usePersistenceStore.setState({ saveState: 'idle', lastSavedAt: null, lastError: null });
});

describe('restoreOrSeed', () => {
  it('seeds a new marker when nothing is stored', async () => {
    const repository = createMemoryRepository();
    const outcome = await restoreOrSeed(repository);

    expect(outcome.restored).toBe(false);
    expect(useMarkerStore.getState().document).not.toBeNull();
  });

  it('reopens the most recently updated marker', async () => {
    const repository = createMemoryRepository();
    await repository.saveMarker(doc('old', '2026-01-01T00:00:00.000Z'));
    await repository.saveMarker(doc('newest', '2026-06-01T00:00:00.000Z'));
    await repository.saveMarker(doc('middle', '2026-03-01T00:00:00.000Z'));

    const outcome = await restoreOrSeed(repository);

    expect(outcome.restored).toBe(true);
    expect(useMarkerStore.getState().document?.id).toBe('newest');
  });

  it('opens a restored marker with an empty undo history', async () => {
    const repository = createMemoryRepository();
    await repository.saveMarker(doc('m1', '2026-06-01T00:00:00.000Z'));

    await restoreOrSeed(repository);

    expect(useMarkerStore.getState().past).toEqual([]);
    expect(useMarkerStore.getState().future).toEqual([]);
  });

  it('marks a restored marker as already saved', async () => {
    const repository = createMemoryRepository();
    await repository.saveMarker(doc('m1', '2026-06-01T00:00:00.000Z'));

    await restoreOrSeed(repository);

    expect(usePersistenceStore.getState().saveState).toBe('saved');
    expect(usePersistenceStore.getState().lastSavedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('falls back to a seed and reports when storage cannot be read', async () => {
    const repository = createMemoryRepository();
    const broken = {
      ...repository,
      lastOpened: async () => {
        throw new Error('IndexedDB is disabled');
      },
    };

    const outcome = await restoreOrSeed(broken);

    expect(outcome.restored).toBe(false);
    expect(useMarkerStore.getState().document).not.toBeNull();
    expect(usePersistenceStore.getState().lastError).toBe('IndexedDB is disabled');
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
