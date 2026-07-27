import { beforeEach, describe, expect, it } from 'vitest';
import type { MarkerDocument, PlacedPiece, TrayPiece } from '@/marker/schema';
import { HISTORY_LIMIT, useMarkerStore } from './markerStore';

const piece = (id: string): PlacedPiece => ({
  id,
  pieceDefId: `def-${id}`,
  name: id,
  size: 'M',
  bundle: 'B1',
  fabricCode: 'A',
  geometry: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ],
  position: { x: 0, y: 0 },
  rotation: 0,
  flipped: false,
  placed: true,
  blocked: false,
});

const doc = (): MarkerDocument => ({
  id: 'doc-1',
  schemaVersion: 3,
  name: 'Test marker',
  fabricWidth: 150,
  endAllowance: 4,
  rotationRule: 'free',
  cutterBuffer: 0,
  pieces: [],
  trayPieces: [],
  defectZones: [],
  spliceLines: [],
  order: { model: 'TEE-100', sizes: [] },
  approvalState: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
});

const state = () => useMarkerStore.getState();

beforeEach(() => {
  useMarkerStore.setState({ document: null, past: [], future: [] });
});

describe('before a marker is loaded', () => {
  it('starts empty', () => {
    expect(state().document).toBeNull();
    expect(state().past).toEqual([]);
    expect(state().future).toEqual([]);
  });

  it('treats every mutation as a no-op rather than throwing', () => {
    state().addPiece(piece('a'));
    state().updatePiece('a', { rotation: 90 });
    state().removePiece('a');
    state().setFabricWidth(150);
    state().addDefectZone({ id: 'd1', x: 0, y: 0, width: 5, height: 5 });
    state().addSpliceLine({ id: 's1', x: 10 });
    state().undo();
    state().redo();
    expect(state().document).toBeNull();
    expect(state().past).toEqual([]);
  });
});

describe('loadMarker', () => {
  it('opens the document', () => {
    state().loadMarker(doc());
    expect(state().document?.id).toBe('doc-1');
  });

  it('discards history from the previous document', () => {
    state().loadMarker(doc());
    state().addPiece(piece('a'));
    expect(state().past).toHaveLength(1);
    state().loadMarker(doc());
    expect(state().past).toEqual([]);
    expect(state().future).toEqual([]);
  });
});

describe('mutations', () => {
  beforeEach(() => {
    state().loadMarker(doc());
  });

  it('adds a piece', () => {
    state().addPiece(piece('a'));
    expect(state().document?.pieces.map((p) => p.id)).toEqual(['a']);
  });

  it('patches a piece without touching its id', () => {
    state().addPiece(piece('a'));
    state().updatePiece('a', { rotation: 90, position: { x: 5, y: 5 } });
    const [updated] = state().document?.pieces ?? [];
    expect(updated?.id).toBe('a');
    expect(updated?.rotation).toBe(90);
    expect(updated?.position).toEqual({ x: 5, y: 5 });
  });

  it('leaves other pieces alone when patching', () => {
    state().addPiece(piece('a'));
    state().addPiece(piece('b'));
    state().updatePiece('a', { rotation: 90 });
    const other = state().document?.pieces.find((p) => p.id === 'b');
    expect(other?.rotation).toBe(0);
  });

  it('removes a piece', () => {
    state().addPiece(piece('a'));
    state().addPiece(piece('b'));
    state().removePiece('a');
    expect(state().document?.pieces.map((p) => p.id)).toEqual(['b']);
  });

  it('sets the fabric width', () => {
    state().setFabricWidth(180);
    expect(state().document?.fabricWidth).toBe(180);
  });

  it('appends defect zones and splice lines', () => {
    state().addDefectZone({ id: 'd1', x: 1, y: 2, width: 3, height: 4 });
    state().addSpliceLine({ id: 's1', x: 42 });
    expect(state().document?.defectZones).toHaveLength(1);
    expect(state().document?.spliceLines[0]?.x).toBe(42);
  });

  it('refreshes updatedAt', () => {
    state().addPiece(piece('a'));
    expect(state().document?.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
  });

  it('does not mutate the snapshot it replaced', () => {
    state().addPiece(piece('a'));
    const snapshot = state().past[0];
    state().addPiece(piece('b'));
    expect(snapshot?.pieces).toEqual([]);
  });
});

describe('updateSettings', () => {
  beforeEach(() => {
    state().loadMarker(doc());
  });

  it('patches several settings in one history step', () => {
    state().updateSettings({ endAllowance: 8, cutterBuffer: 0.5, rotationRule: 'strict' });
    expect(state().document?.endAllowance).toBe(8);
    expect(state().document?.cutterBuffer).toBe(0.5);
    expect(state().document?.rotationRule).toBe('strict');
    expect(state().past).toHaveLength(1);
  });

  it('leaves untouched settings alone', () => {
    state().updateSettings({ endAllowance: 8 });
    expect(state().document?.fabricWidth).toBe(150);
  });
});

describe('placeFromTray', () => {
  const trayPiece = (id: string, quantity: number, placed: number): TrayPiece => ({
    id,
    name: 'Front',
    size: 'M',
    bundle: 'B1',
    fabricCode: 'A',
    geometry: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    layDirection: '2way',
    quantity,
    placed,
  });

  beforeEach(() => {
    const document = doc();
    document.trayPieces = [trayPiece('t1', 2, 0)];
    state().loadMarker(document);
  });

  it('places a piece and counts it in one step', () => {
    state().placeFromTray('t1', { x: 5, y: 5 });
    expect(state().document?.pieces).toHaveLength(1);
    expect(state().document?.trayPieces[0]?.placed).toBe(1);
    // One history entry, so undo removes the piece and the count together.
    expect(state().past).toHaveLength(1);
  });

  it('copies the tray piece definition onto the placed piece', () => {
    state().placeFromTray('t1', { x: 5, y: 5 });
    const [piece] = state().document?.pieces ?? [];
    expect(piece?.pieceDefId).toBe('t1');
    expect(piece?.name).toBe('Front');
    expect(piece?.bundle).toBe('B1');
    expect(piece?.position).toEqual({ x: 5, y: 5 });
    expect(piece?.placed).toBe(true);
  });

  it('gives each placement a distinct id', () => {
    state().placeFromTray('t1', { x: 0, y: 0 });
    state().placeFromTray('t1', { x: 20, y: 0 });
    const ids = state().document?.pieces.map((piece) => piece.id) ?? [];
    expect(new Set(ids).size).toBe(2);
  });

  it('refuses once the quantity is exhausted', () => {
    state().placeFromTray('t1', { x: 0, y: 0 });
    state().placeFromTray('t1', { x: 20, y: 0 });
    state().placeFromTray('t1', { x: 40, y: 0 });
    expect(state().document?.pieces).toHaveLength(2);
    expect(state().document?.trayPieces[0]?.placed).toBe(2);
  });

  it('undoes the piece and the count together', () => {
    state().placeFromTray('t1', { x: 5, y: 5 });
    state().undo();
    expect(state().document?.pieces).toHaveLength(0);
    expect(state().document?.trayPieces[0]?.placed).toBe(0);
  });

  it('ignores an unknown tray piece', () => {
    state().placeFromTray('nope', { x: 0, y: 0 });
    expect(state().document?.pieces).toHaveLength(0);
  });
});

describe('applyPlacements', () => {
  const trayPiece = (id: string, quantity: number, placed: number): TrayPiece => ({
    id,
    name: `piece-${id}`,
    size: 'M',
    bundle: 'B1',
    fabricCode: 'A',
    geometry: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    layDirection: '2way',
    quantity,
    placed,
  });

  beforeEach(() => {
    const document = doc();
    document.trayPieces = [trayPiece('t1', 3, 0), trayPiece('t2', 1, 0)];
    state().loadMarker(document);
  });

  it('places every result and counts them all', () => {
    state().applyPlacements([
      { pieceDefId: 't1', position: { x: 0, y: 0 }, rotation: 0, flipped: false },
      { pieceDefId: 't1', position: { x: 20, y: 0 }, rotation: 180, flipped: false },
      { pieceDefId: 't2', position: { x: 40, y: 0 }, rotation: 0, flipped: false },
    ]);

    expect(state().document?.pieces).toHaveLength(3);
    expect(state().document?.trayPieces[0]?.placed).toBe(2);
    expect(state().document?.trayPieces[1]?.placed).toBe(1);
  });

  it('is a single undo step for the whole run', () => {
    state().applyPlacements([
      { pieceDefId: 't1', position: { x: 0, y: 0 }, rotation: 0, flipped: false },
      { pieceDefId: 't1', position: { x: 20, y: 0 }, rotation: 0, flipped: false },
      { pieceDefId: 't2', position: { x: 40, y: 0 }, rotation: 0, flipped: false },
    ]);
    expect(state().past).toHaveLength(1);

    state().undo();
    expect(state().document?.pieces).toHaveLength(0);
    expect(state().document?.trayPieces[0]?.placed).toBe(0);
  });

  it('carries rotation through to the placed piece', () => {
    state().applyPlacements([
      { pieceDefId: 't1', position: { x: 5, y: 5 }, rotation: 180, flipped: true },
    ]);
    const [piece] = state().document?.pieces ?? [];
    expect(piece?.rotation).toBe(180);
    expect(piece?.flipped).toBe(true);
    expect(piece?.position).toEqual({ x: 5, y: 5 });
  });

  it('ignores a placement for a tray piece that is not there', () => {
    state().applyPlacements([
      { pieceDefId: 'ghost', position: { x: 0, y: 0 }, rotation: 0, flipped: false },
    ]);
    expect(state().document?.pieces).toHaveLength(0);
    expect(state().past).toEqual([]);
  });

  it('does nothing for an empty result', () => {
    state().applyPlacements([]);
    expect(state().past).toEqual([]);
  });
});

describe('undo and redo', () => {
  beforeEach(() => {
    state().loadMarker(doc());
  });

  it('restores the previous document', () => {
    state().addPiece(piece('a'));
    state().undo();
    expect(state().document?.pieces).toEqual([]);
  });

  it('reapplies an undone change', () => {
    state().addPiece(piece('a'));
    state().undo();
    state().redo();
    expect(state().document?.pieces.map((p) => p.id)).toEqual(['a']);
  });

  it('walks back through several edits', () => {
    state().addPiece(piece('a'));
    state().addPiece(piece('b'));
    state().addPiece(piece('c'));
    state().undo();
    state().undo();
    expect(state().document?.pieces.map((p) => p.id)).toEqual(['a']);
  });

  it('is a no-op with nothing to undo or redo', () => {
    state().undo();
    expect(state().document?.pieces).toEqual([]);
    state().redo();
    expect(state().document?.pieces).toEqual([]);
  });

  it('drops the redo stack once a new edit lands', () => {
    state().addPiece(piece('a'));
    state().undo();
    expect(state().future).toHaveLength(1);
    state().addPiece(piece('b'));
    expect(state().future).toEqual([]);
  });

  it('does not record a snapshot for a change that did nothing', () => {
    state().placeFromTray('missing-tray-piece', { x: 0, y: 0 });
    expect(state().past).toEqual([]);
  });

  it(`keeps at most ${HISTORY_LIMIT} snapshots`, () => {
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) state().addPiece(piece(`p${i}`));
    expect(state().past).toHaveLength(HISTORY_LIMIT);
  });

  it('drops the oldest snapshot first', () => {
    for (let i = 0; i < HISTORY_LIMIT + 1; i += 1) state().addPiece(piece(`p${i}`));
    // The empty starting document has fallen off the back.
    expect(state().past[0]?.pieces).toHaveLength(1);
  });
});
