/**
 * Debounced auto-save.
 *
 * Every document mutation schedules a write; the write happens once the user
 * has been still for the debounce interval. Fire-and-forget by design — the UI
 * never waits on IndexedDB, and a failed write reports itself rather than
 * blocking an edit.
 *
 * Written against MarkerRepository and an injectable clock/scheduler so the
 * timing behaviour is testable without IndexedDB or real time.
 */

import type { MarkerDocument } from '@/marker/schema';
import type { MarkerRepository } from './repository';

/** Long enough that dragging a piece does not write on every frame. */
export const AUTO_SAVE_DEBOUNCE_MS = 2000;

export interface AutoSaveHooks {
  onPending?: () => void;
  onSaving?: () => void;
  onSaved?: (at: string) => void;
  onError?: (message: string) => void;
}

export interface AutoSaveOptions {
  readonly repository: MarkerRepository;
  readonly debounceMs?: number;
  readonly hooks?: AutoSaveHooks;
  readonly now?: () => Date;
  readonly setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface AutoSave {
  /** Note a change and (re)start the debounce. */
  schedule: (document: MarkerDocument) => void;
  /** Write immediately — used on page hide, where a timer would never fire. */
  flush: () => Promise<void>;
  cancel: () => void;
}

export const createAutoSave = (options: AutoSaveOptions): AutoSave => {
  const {
    repository,
    debounceMs = AUTO_SAVE_DEBOUNCE_MS,
    hooks = {},
    now = () => new Date(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = options;

  let pending: MarkerDocument | null = null;
  let handle: ReturnType<typeof setTimeout> | null = null;
  // Serialises writes: two overlapping puts of the same key can otherwise
  // land out of order and persist the older document.
  let inFlight: Promise<void> = Promise.resolve();

  const write = async (): Promise<void> => {
    const document = pending;
    pending = null;
    if (!document) return;

    hooks.onSaving?.();
    try {
      await repository.saveMarker(document);
      hooks.onSaved?.(now().toISOString());
    } catch (error) {
      hooks.onError?.(error instanceof Error ? error.message : 'Save failed');
    }
  };

  const run = () => {
    handle = null;
    inFlight = inFlight.then(write);
  };

  return {
    schedule: (document) => {
      pending = document;
      hooks.onPending?.();
      if (handle !== null) clearTimer(handle);
      handle = setTimer(run, debounceMs);
    },

    flush: async () => {
      if (handle !== null) {
        clearTimer(handle);
        handle = null;
      }
      inFlight = inFlight.then(write);
      await inFlight;
    },

    cancel: () => {
      if (handle !== null) clearTimer(handle);
      handle = null;
      pending = null;
    },
  };
};
