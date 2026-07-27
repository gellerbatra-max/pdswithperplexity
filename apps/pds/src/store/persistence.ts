import { exportDocument, importDocument } from '@/io';
import type { PatternDocument } from '@/pattern';
import { useDocumentStore } from './documentStore';

/**
 * Autosave to IndexedDB — the only persistence today. `io/json.ts` already
 * round-trips the document losslessly and is versioned; this module just gets
 * those bytes in and out of the browser's local database. There is no file
 * story yet (no download/upload, no cloud sync) — that's a separate decision
 * once this is proven out.
 */

const DB_NAME = 'pds';
const DB_VERSION = 1;
const STORE_NAME = 'documents';
const AUTOSAVE_KEY = 'autosave';
const AUTOSAVE_DEBOUNCE_MS = 800;

const openDatabase = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });

const saveAutosave = async (document: PatternDocument): Promise<void> => {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(exportDocument(document, 'pds-json'), AUTOSAVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    });
  } finally {
    db.close();
  }
};

const loadAutosave = async (): Promise<PatternDocument | null> => {
  const db = await openDatabase();
  let payload: string | undefined;
  try {
    payload = await new Promise<string | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(AUTOSAVE_KEY);
      request.onsuccess = () => resolve(request.result as string | undefined);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB read failed'));
    });
  } finally {
    db.close();
  }
  if (!payload) return null;
  return importDocument(payload, 'pds-json');
};

let debounceTimer: ReturnType<typeof setTimeout> | undefined;

const scheduleAutosave = (): void => {
  if (debounceTimer !== undefined) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = undefined;
    void flushAutosave();
  }, AUTOSAVE_DEBOUNCE_MS);
};

/** Writes the current document immediately, bypassing the debounce. */
export const flushAutosave = async (): Promise<void> => {
  if (debounceTimer !== undefined) {
    clearTimeout(debounceTimer);
    debounceTimer = undefined;
  }
  const state = useDocumentStore.getState();
  if (state.saveState === 'saved') return;

  useDocumentStore.setState({ saveState: 'saving' });
  try {
    await saveAutosave(useDocumentStore.getState().document);
    useDocumentStore.getState().markSaved();
  } catch (error) {
    // Never lie about save state: a failed write leaves the document unsaved,
    // visibly, rather than reporting success it didn't earn.
    console.error('Autosave failed', error);
    useDocumentStore.setState({ saveState: 'unsaved' });
  }
};

/** Loads the autosaved document, if one exists. Returns false if there is none. */
export const hydrateFromAutosave = async (): Promise<boolean> => {
  try {
    const document = await loadAutosave();
    if (!document) return false;
    useDocumentStore.getState().setDocument(document);
    return true;
  } catch (error) {
    console.error('Failed to load autosave', error);
    return false;
  }
};

// Fires on every document change; the debounce means a burst of edits (typing,
// a drag once tools exist) writes once, shortly after the burst goes idle.
useDocumentStore.subscribe((state, previous) => {
  if (state.saveState !== 'unsaved' || state.document === previous.document) return;
  scheduleAutosave();
});
