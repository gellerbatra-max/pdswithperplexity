import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarkerDocument } from '@/marker/schema';
import { AUTO_SAVE_DEBOUNCE_MS, createAutoSave } from './autoSave';
import { createMemoryRepository } from './memoryRepository';

const doc = (overrides: { id?: string; name?: string; updatedAt?: string } = {}): MarkerDocument => ({
  id: overrides.id ?? 'doc-1',
  schemaVersion: 2,
  name: overrides.name ?? 'Test',
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
  updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('debouncing', () => {
  it('does not write before the interval elapses', async () => {
    const repository = createMemoryRepository();
    const autoSave = createAutoSave({ repository });

    autoSave.schedule(doc());
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS - 1);

    expect(repository.saveCount()).toBe(0);
  });

  it('writes once the interval elapses', async () => {
    const repository = createMemoryRepository();
    const autoSave = createAutoSave({ repository });

    autoSave.schedule(doc());
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS);

    expect(repository.saveCount()).toBe(1);
    expect(repository.markers.get('doc-1')?.name).toBe('Test');
  });

  it('collapses a burst of edits into one write', async () => {
    const repository = createMemoryRepository();
    const autoSave = createAutoSave({ repository });

    // What dragging a piece looks like: many mutations, none of them final.
    for (let i = 0; i < 60; i += 1) {
      autoSave.schedule(doc({ name: `edit-${i}` }));
      await vi.advanceTimersByTimeAsync(16);
    }
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS);

    expect(repository.saveCount()).toBe(1);
    expect(repository.markers.get('doc-1')?.name).toBe('edit-59');
  });

  it('writes again for a change made after a save', async () => {
    const repository = createMemoryRepository();
    const autoSave = createAutoSave({ repository });

    autoSave.schedule(doc({ name: 'first' }));
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS);
    autoSave.schedule(doc({ name: 'second' }));
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS);

    expect(repository.saveCount()).toBe(2);
    expect(repository.markers.get('doc-1')?.name).toBe('second');
  });
});

describe('flush', () => {
  it('writes immediately without waiting for the timer', async () => {
    const repository = createMemoryRepository();
    const autoSave = createAutoSave({ repository });

    autoSave.schedule(doc({ name: 'closing' }));
    await autoSave.flush();

    expect(repository.saveCount()).toBe(1);
    expect(repository.markers.get('doc-1')?.name).toBe('closing');
  });

  it('does not write a second time when the timer would have fired', async () => {
    const repository = createMemoryRepository();
    const autoSave = createAutoSave({ repository });

    autoSave.schedule(doc());
    await autoSave.flush();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS * 2);

    expect(repository.saveCount()).toBe(1);
  });

  it('is harmless with nothing pending', async () => {
    const repository = createMemoryRepository();
    const autoSave = createAutoSave({ repository });

    await autoSave.flush();

    expect(repository.saveCount()).toBe(0);
  });
});

describe('cancel', () => {
  it('drops the pending write', async () => {
    const repository = createMemoryRepository();
    const autoSave = createAutoSave({ repository });

    autoSave.schedule(doc());
    autoSave.cancel();
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS * 2);

    expect(repository.saveCount()).toBe(0);
  });
});

describe('hooks', () => {
  it('reports pending, saving and saved in order', async () => {
    const repository = createMemoryRepository();
    const seen: string[] = [];
    const autoSave = createAutoSave({
      repository,
      hooks: {
        onPending: () => seen.push('pending'),
        onSaving: () => seen.push('saving'),
        onSaved: () => seen.push('saved'),
        onError: () => seen.push('error'),
      },
    });

    autoSave.schedule(doc());
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS);

    expect(seen).toEqual(['pending', 'saving', 'saved']);
  });

  it('reports the failure instead of throwing at the caller', async () => {
    const repository = createMemoryRepository();
    repository.failNextSaves(1, 'quota exceeded');
    const errors: string[] = [];
    const autoSave = createAutoSave({ repository, hooks: { onError: (m) => errors.push(m) } });

    autoSave.schedule(doc());
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS);

    expect(errors).toEqual(['quota exceeded']);
  });

  it('recovers on the next change after a failure', async () => {
    const repository = createMemoryRepository();
    repository.failNextSaves(1);
    const autoSave = createAutoSave({ repository });

    autoSave.schedule(doc({ name: 'lost' }));
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS);
    autoSave.schedule(doc({ name: 'kept' }));
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS);

    expect(repository.markers.get('doc-1')?.name).toBe('kept');
  });
});

describe('write ordering', () => {
  it('persists the last document when writes overlap', async () => {
    // A slow write must not let an older document land on top of a newer one.
    const repository = createMemoryRepository();
    const order: string[] = [];
    const slow = {
      ...repository,
      saveMarker: async (document: MarkerDocument) => {
        const delay = document.name === 'first' ? 50 : 1;
        await new Promise((resolve) => setTimeout(resolve, delay));
        order.push(document.name);
        await repository.saveMarker(document);
      },
    };
    const autoSave = createAutoSave({ repository: slow });

    autoSave.schedule(doc({ name: 'first' }));
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS);
    autoSave.schedule(doc({ name: 'second' }));
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_DEBOUNCE_MS + 100);

    expect(order).toEqual(['first', 'second']);
    expect(repository.markers.get('doc-1')?.name).toBe('second');
  });
});
