import { beforeEach, describe, expect, it } from 'vitest';
import { boundsOf } from '@/canvas/collision/aabb';
import { orientedGeometry } from '@/marker/pieceGeometry';
import type { MarkerDocument, PlacedPiece, Point, TrayPiece } from '@/marker/schema';
import { useMarkerStore } from '@/store/markerStore';
import { useUiStore } from '@/store/uiStore';
import { COMMANDS, commandById, commandForKey, rotationStepFor } from './registry';

const rect = (width: number, height: number): Point[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

const piece = (id: string, position: Point, overrides: Partial<PlacedPiece> = {}): PlacedPiece => ({
  id,
  pieceDefId: 'def-1',
  name: id,
  size: 'M',
  bundle: 'B1',
  fabricCode: 'A',
  geometry: rect(10, 10),
  position,
  rotation: 0,
  flipped: false,
  placed: true,
  blocked: false,
  ...overrides,
});

const tray = (id: string, layDirection: TrayPiece['layDirection']): TrayPiece => ({
  id,
  name: 'Front',
  size: 'M',
  bundle: 'B1',
  fabricCode: 'A',
  geometry: rect(10, 10),
  layDirection,
  quantity: 4,
  placed: 1,
});

const doc = (pieces: PlacedPiece[], trayPieces: TrayPiece[] = []): MarkerDocument => ({
  id: 'doc-1',
  schemaVersion: 3,
  name: 'Commands',
  fabricWidth: 100,
  endAllowance: 4,
  rotationRule: 'free',
  cutterBuffer: 0,
  pieces,
  trayPieces,
  defectZones: [],
  spliceLines: [],
  order: { model: '', sizes: [] },
  approvalState: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastOpenedAt: '2026-01-01T00:00:00.000Z',
});

/** Bounding-box centre in marker space — what a rotation must hold still. */
const centreOf = (target: PlacedPiece): Point => {
  const bounds = boundsOf(orientedGeometry(target));
  return {
    x: target.position.x + (bounds.minX + bounds.maxX) / 2,
    y: target.position.y + (bounds.minY + bounds.maxY) / 2,
  };
};

const key = (
  k: string,
  modifiers: { shift?: boolean; ctrl?: boolean; meta?: boolean; alt?: boolean } = {},
) => ({
  key: k,
  shiftKey: modifiers.shift ?? false,
  ctrlKey: modifiers.ctrl ?? false,
  metaKey: modifiers.meta ?? false,
  altKey: modifiers.alt ?? false,
});

const run = (id: string, document: MarkerDocument, selection: string[]) => {
  const command = commandById(id);
  if (!command) throw new Error(`no command ${id}`);
  useMarkerStore.getState().loadMarker(document);
  useUiStore.getState().setSelection(selection);
  command.run({ document, selection });
};

beforeEach(() => {
  useMarkerStore.setState({ document: null, past: [], future: [] });
  useUiStore.setState({ activeTool: 'select', selection: [], dockTab: 'piece', statusMessage: null });
});

describe('the registry itself', () => {
  it('has unique ids', () => {
    const ids = COMMANDS.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every command a label and a key hint', () => {
    for (const command of COMMANDS) {
      expect(command.label.length).toBeGreaterThan(0);
      expect(command.keys.length).toBeGreaterThan(0);
    }
  });
});

describe('key dispatch', () => {
  it('maps the unshifted keys', () => {
    expect(commandForKey(key('r'))?.id).toBe('rotate-cw');
    expect(commandForKey(key('f'))?.id).toBe('flip-horizontal');
    expect(commandForKey(key('l'))?.id).toBe('butt-slide-left');
    expect(commandForKey(key('u'))?.id).toBe('butt-slide-up');
    expect(commandForKey(key('Delete'))?.id).toBe('return-to-tray');
    expect(commandForKey(key('Escape'))?.id).toBe('deselect');
    expect(commandForKey(key('0'))?.id).toBe('zoom-fit');
  });

  it('maps the shifted variants', () => {
    expect(commandForKey(key('R', { shift: true }))?.id).toBe('rotate-ccw');
    expect(commandForKey(key('F', { shift: true }))?.id).toBe('flip-vertical');
    expect(commandForKey(key('ArrowLeft', { shift: true }))?.id).toBe('nudge-left-fine');
    expect(commandForKey(key('ArrowUp', { shift: true }))?.id).toBe('nudge-up-fine');
  });

  it('maps all four arrows', () => {
    expect(commandForKey(key('ArrowLeft'))?.id).toBe('nudge-left');
    expect(commandForKey(key('ArrowRight'))?.id).toBe('nudge-right');
    expect(commandForKey(key('ArrowUp'))?.id).toBe('nudge-up');
    expect(commandForKey(key('ArrowDown'))?.id).toBe('nudge-down');
  });

  it('accepts both = and + for zoom in, as keyboards differ', () => {
    expect(commandForKey(key('='))?.id).toBe('zoom-in');
    expect(commandForKey(key('+'))?.id).toBe('zoom-in');
  });

  it('maps undo and redo on either platform modifier', () => {
    expect(commandForKey(key('z', { ctrl: true }))?.id).toBe('undo');
    expect(commandForKey(key('z', { meta: true }))?.id).toBe('undo');
    expect(commandForKey(key('y', { ctrl: true }))?.id).toBe('redo');
    // Shift+Cmd+Z is redo everywhere it is not Ctrl+Y.
    expect(commandForKey(key('z', { meta: true, shift: true }))?.id).toBe('redo');
  });

  it('leaves other accelerator combinations to the browser', () => {
    // Ctrl+S, Ctrl+P and friends must keep working.
    expect(commandForKey(key('s', { ctrl: true }))).toBeUndefined();
    expect(commandForKey(key('p', { meta: true }))).toBeUndefined();
    expect(commandForKey(key('a', { alt: true }))).toBeUndefined();
    expect(commandForKey(key('q'))).toBeUndefined();
  });
});

describe('rotationStepFor', () => {
  it('follows the piece lay direction under a free document rule', () => {
    const twoWay = doc([piece('p1', { x: 0, y: 0 })], [tray('def-1', '2way')]);
    const fourWay = doc([piece('p1', { x: 0, y: 0 })], [tray('def-1', '4way')]);
    const free = doc([piece('p1', { x: 0, y: 0 })], [tray('def-1', 'free')]);
    const target = piece('p1', { x: 0, y: 0 });

    expect(rotationStepFor(twoWay, target)).toBe(180);
    expect(rotationStepFor(fourWay, target)).toBe(90);
    expect(rotationStepFor(free, target)).toBe(45);
  });

  it('takes the coarser of the document rule and the lay direction', () => {
    const strict: MarkerDocument = {
      ...doc([piece('p1', { x: 0, y: 0 })], [tray('def-1', 'free')]),
      rotationRule: 'strict',
    };
    // A free piece in a strict document still may not turn off-grain.
    expect(rotationStepFor(strict, piece('p1', { x: 0, y: 0 }))).toBe(180);

    const ninety: MarkerDocument = {
      ...doc([piece('p1', { x: 0, y: 0 })], [tray('def-1', 'free')]),
      rotationRule: '90ok',
    };
    expect(rotationStepFor(ninety, piece('p1', { x: 0, y: 0 }))).toBe(90);
  });

  it('assumes free when the tray piece is missing', () => {
    expect(rotationStepFor(doc([piece('p1', { x: 0, y: 0 })]), piece('p1', { x: 0, y: 0 }))).toBe(45);
  });
});

describe('running commands', () => {
  it('nudges by 1 cm and 1 mm', () => {
    const document = doc([piece('p1', { x: 20, y: 20 })]);
    run('nudge-right', document, ['p1']);
    expect(useMarkerStore.getState().document?.pieces[0]?.position.x).toBeCloseTo(21, 6);

    const next = useMarkerStore.getState().document;
    if (!next) throw new Error('no document');
    run('nudge-up-fine', next, ['p1']);
    expect(useMarkerStore.getState().document?.pieces[0]?.position.y).toBeCloseTo(20.1, 6);
  });

  it('keeps a nudge inside the fabric', () => {
    const document = doc([piece('p1', { x: 20, y: 0 })]);
    run('nudge-down', document, ['p1']);
    expect(useMarkerStore.getState().document?.pieces[0]?.position.y).toBe(0);
  });

  it('rotates by the allowed step and wraps at a full turn', () => {
    const document = doc([piece('p1', { x: 20, y: 20 })], [tray('def-1', '4way')]);
    run('rotate-cw', document, ['p1']);
    expect(useMarkerStore.getState().document?.pieces[0]?.rotation).toBe(270);

    const document2 = doc(
      [piece('p1', { x: 20, y: 20 }, { rotation: 270 })],
      [tray('def-1', '4way')],
    );
    run('rotate-ccw', document2, ['p1']);
    expect(useMarkerStore.getState().document?.pieces[0]?.rotation).toBe(0);
  });

  it('rotates about the piece centre, not its local origin', () => {
    // The canonical transform turns a piece about its own origin, which would
    // fling it across the marker; a keyboard rotation has to stay put. The
    // position necessarily moves — it is the centre that must not.
    const before = piece('p1', { x: 30, y: 30 });
    const document = doc([before], [tray('def-1', '4way')]);
    run('rotate-cw', document, ['p1']);

    const after = useMarkerStore.getState().document?.pieces[0];
    if (!after) throw new Error('no piece');
    expect(centreOf(after).x).toBeCloseTo(centreOf(before).x, 6);
    expect(centreOf(after).y).toBeCloseTo(centreOf(before).y, 6);
    expect(after.rotation).toBe(270);
  });

  it('keeps a rotated non-square piece centred', () => {
    const before = piece('p1', { x: 20, y: 40 }, { geometry: rect(40, 10) });
    const document = doc([before], [tray('def-1', '4way')]);
    run('rotate-cw', document, ['p1']);

    const after = useMarkerStore.getState().document?.pieces[0];
    if (!after) throw new Error('no piece');
    expect(centreOf(after).x).toBeCloseTo(centreOf(before).x, 6);
    expect(centreOf(after).y).toBeCloseTo(centreOf(before).y, 6);
    // The origin did move — that is the whole point of the correction.
    expect(after.position.x).not.toBeCloseTo(before.position.x, 6);
  });

  it('keeps a flipped piece centred', () => {
    const before = piece('p1', { x: 30, y: 30 });
    const document = doc([before]);
    run('flip-horizontal', document, ['p1']);

    const after = useMarkerStore.getState().document?.pieces[0];
    if (!after) throw new Error('no piece');
    expect(centreOf(after).x).toBeCloseTo(centreOf(before).x, 6);
    expect(after.flipped).toBe(true);
  });

  it('flips horizontally', () => {
    run('flip-horizontal', doc([piece('p1', { x: 20, y: 20 })]), ['p1']);
    expect(useMarkerStore.getState().document?.pieces[0]?.flipped).toBe(true);
  });

  it('flips vertically as a horizontal flip plus half a turn', () => {
    run('flip-vertical', doc([piece('p1', { x: 20, y: 20 })]), ['p1']);
    const piece0 = useMarkerStore.getState().document?.pieces[0];
    expect(piece0?.flipped).toBe(true);
    expect(piece0?.rotation).toBe(180);
  });

  it('butt-slides left into the origin', () => {
    run('butt-slide-left', doc([piece('p1', { x: 40, y: 20 })]), ['p1']);
    expect(useMarkerStore.getState().document?.pieces[0]?.position.x).toBeCloseTo(0, 2);
  });

  it('returns a piece to the tray and credits the count back', () => {
    const document = doc([piece('p1', { x: 20, y: 20 })], [tray('def-1', '2way')]);
    run('return-to-tray', document, ['p1']);

    const after = useMarkerStore.getState().document;
    expect(after?.pieces).toHaveLength(0);
    expect(after?.trayPieces[0]?.placed).toBe(0);
    expect(useUiStore.getState().selection).toEqual([]);
  });

  it('selects the whole bundle', () => {
    const document = doc([
      piece('p1', { x: 0, y: 0 }),
      piece('p2', { x: 20, y: 0 }),
      piece('p3', { x: 40, y: 0 }, { bundle: 'B2' }),
    ]);
    run('select-bundle', document, ['p1']);
    expect(useUiStore.getState().selection.sort()).toEqual(['p1', 'p2']);
  });

  it('moves every selected piece at once', () => {
    const document = doc([piece('p1', { x: 20, y: 20 }), piece('p2', { x: 60, y: 20 })]);
    run('nudge-right', document, ['p1', 'p2']);
    const positions = useMarkerStore.getState().document?.pieces.map((p) => p.position.x) ?? [];
    expect(positions[0]).toBeCloseTo(21, 6);
    expect(positions[1]).toBeCloseTo(61, 6);
  });

  it('undoes and redoes', () => {
    const document = doc([piece('p1', { x: 20, y: 20 })]);
    run('nudge-right', document, ['p1']);
    commandById('undo')?.run({ document, selection: ['p1'] });
    expect(useMarkerStore.getState().document?.pieces[0]?.position.x).toBe(20);
    commandById('redo')?.run({ document, selection: ['p1'] });
    expect(useMarkerStore.getState().document?.pieces[0]?.position.x).toBeCloseTo(21, 6);
  });
});
