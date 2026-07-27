import { create } from 'zustand';
import type { PatternDocument } from '@/pattern';
import { useDocumentStore } from './documentStore';

/**
 * A reversible document edit.
 *
 * `do`/`undo` are pure functions over the document — no store access, no
 * captured document snapshot. A command captures only what it needs to reverse
 * itself (e.g. one piece's prior value, read at construction time), never the
 * whole document: the document holds every piece, so snapshotting it per
 * keystroke would not hold up under a drag. See `documentCommands.ts` for the
 * factories that build these from live store state.
 */
export interface DocumentCommand {
  /**
   * What was done, imperative and subject-free — "Rename piece", "Duplicate
   * piece". Pairs with `detail`, which names the subject. Every command
   * factory in `documentCommands.ts` fills both the same way, so a history
   * list can render `label` + `detail` in two columns without special cases.
   */
  readonly label: string;
  /** The subject and the change: "Yoke", "Sleeve · ×2 → ×4". */
  readonly detail?: string;
  /**
   * Consecutive commands that share a `coalesceKey`, executed within
   * `COALESCE_WINDOW_MS` of each other, replace the top of the undo stack
   * instead of pushing a new entry. Without this, typing a document name
   * would push one undo step per keystroke. Each command's `do` must set an
   * absolute value (not a delta) for this to produce the right result when
   * only the latest of a coalesced run is replayed on redo.
   */
  readonly coalesceKey?: string;
  do(document: PatternDocument): PatternDocument;
  undo(document: PatternDocument): PatternDocument;
}

/**
 * A command as it sits on the stack. `at` is stamped by `execute`, so a history
 * list can render relative times ("2m ago") without every factory having to
 * remember to set a timestamp.
 */
export interface HistoryEntry {
  readonly command: DocumentCommand;
  readonly at: number;
}

const COALESCE_WINDOW_MS = 1000;

/**
 * Undo/redo as an inverse-command stack. `store/documentStore.ts` still holds
 * the document; this store only ever touches it through `applyDocument`, so
 * every command here is the single path a mutation can take into the live
 * document.
 */
export interface HistoryState {
  /** Oldest first; the last entry is what `undo` will reverse. */
  readonly past: readonly HistoryEntry[];
  /** The last entry is what `redo` will replay. */
  readonly future: readonly HistoryEntry[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Applies a command to the live document and pushes it onto the undo stack. */
  execute: (command: DocumentCommand) => void;
  undo: () => void;
  redo: () => void;
  /** Drops all history. Call when swapping in an unrelated document (new/open). */
  reset: () => void;
}

// Coalescing needs "was the last execute recent", which is a question about
// wall-clock time, not store state — it stays outside `set` so undo/redo (which
// should never coalesce into whatever ran before them) can reset it for free.
let lastExecutedAt = 0;

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  canUndo: false,
  canRedo: false,

  execute: (command) => {
    const documentState = useDocumentStore.getState();
    documentState.applyDocument(command.do(documentState.document));

    const now = Date.now();
    const { past } = get();
    const top = past.length > 0 ? past[past.length - 1] : undefined;
    const recent = now - lastExecutedAt <= COALESCE_WINDOW_MS;
    lastExecutedAt = now;

    // A coalesced entry takes the newer command's `do` and metadata but keeps
    // the original's `undo`, so one undo reverses the whole burst.
    const nextPast =
      top !== undefined &&
      command.coalesceKey !== undefined &&
      top.command.coalesceKey === command.coalesceKey &&
      recent
        ? [
            ...past.slice(0, -1),
            { command: { ...command, undo: top.command.undo }, at: now },
          ]
        : [...past, { command, at: now }];

    set({ past: nextPast, future: [], canUndo: true, canRedo: false });
  },

  undo: () => {
    const { past, future } = get();
    const entry = past[past.length - 1];
    if (!entry) return;

    const documentState = useDocumentStore.getState();
    documentState.applyDocument(entry.command.undo(documentState.document));

    const nextPast = past.slice(0, -1);
    lastExecutedAt = 0;
    set({
      past: nextPast,
      future: [...future, entry],
      canUndo: nextPast.length > 0,
      canRedo: true,
    });
  },

  redo: () => {
    const { past, future } = get();
    const entry = future[future.length - 1];
    if (!entry) return;

    const documentState = useDocumentStore.getState();
    documentState.applyDocument(entry.command.do(documentState.document));

    const nextFuture = future.slice(0, -1);
    lastExecutedAt = 0;
    set({
      past: [...past, { command: entry.command, at: Date.now() }],
      future: nextFuture,
      canUndo: true,
      canRedo: nextFuture.length > 0,
    });
  },

  reset: () => {
    lastExecutedAt = 0;
    set({ past: [], future: [], canUndo: false, canRedo: false });
  },
}));
