/**
 * The command registry.
 *
 * Every keyboard action is a command, so the Keys tab, the palette and the
 * shortcut handler all describe the same list rather than three that drift.
 * Plain TypeScript — no React, no Konva.
 */

import { boundsOf } from '@/canvas/collision/aabb';
import { buttSlide, type SlideDirection } from '@/canvas/tools/ButtSlideTool';
import { resolveDragPosition } from '@/canvas/tools/DragTool';
import { orientedGeometry } from '@/marker/pieceGeometry';
import { markerLength } from '@/marker/selectors';
import type { MarkerDocument, PlacedPiece, Point, RotationRule } from '@/marker/schema';
import { useMarkerStore } from '@/store/markerStore';
import { useUiStore } from '@/store/uiStore';
import { useViewportStore } from '@/store/viewportStore';

/** Fallback marker length, matching the canvas, so `0` fits an empty marker. */
const MIN_FIT_LENGTH = 500;

const NUDGE_CM = 1;
const NUDGE_FINE_CM = 0.1;
const ZOOM_STEP = 1.2;

/**
 * Smallest rotation a piece may turn by.
 *
 * Two constraints apply at once: the document's rotation rule and the piece's
 * own lay direction. The coarser wins — a 90-degree document rule cannot make
 * a two-way piece safe to lay across the grain.
 */
const RULE_STEP: Record<RotationRule, number> = { strict: 180, '90ok': 90, free: 0 };

export const rotationStepFor = (document: MarkerDocument, piece: PlacedPiece): number => {
  const tray = document.trayPieces.find((candidate) => candidate.id === piece.pieceDefId);
  const layStep = tray?.layDirection === '2way' ? 180 : tray?.layDirection === '4way' ? 90 : 45;
  return Math.max(RULE_STEP[document.rotationRule], layStep);
};

export interface CommandContext {
  readonly document: MarkerDocument;
  readonly selection: readonly string[];
}

export interface Command {
  readonly id: string;
  readonly label: string;
  /** As shown in the Keys tab. */
  readonly keys: string;
  readonly run: (context: CommandContext) => void;
  /** Commands needing a selection are hidden from the palette without one. */
  readonly needsSelection?: boolean;
}

const selectedPieces = (context: CommandContext): PlacedPiece[] =>
  context.document.pieces.filter((piece) => context.selection.includes(piece.id));

/** Move each selected piece, letting collision decide where it lands. */
const nudge = (context: CommandContext, dx: number, dy: number): void => {
  const store = useMarkerStore.getState();
  for (const piece of selectedPieces(context)) {
    const wanted = { x: piece.position.x + dx, y: piece.position.y + dy };
    store.updatePiece(piece.id, {
      position: resolveDragPosition(context.document, piece, wanted),
    });
  }
};

/**
 * Where a re-oriented piece should sit so it does not appear to jump.
 *
 * The canonical transform rotates and mirrors about the piece's local origin,
 * which is correct for nesting — the nester picks a position afterwards — but
 * makes a keyboard rotation fling the piece across the marker. Holding the
 * bounding-box centre still is what "rotate in place" means to a human. The
 * result is then settled through collision, since turning a piece can put it
 * on top of a neighbour.
 */
const centreOf = (piece: PlacedPiece): Point => {
  const bounds = boundsOf(orientedGeometry(piece));
  return {
    x: piece.position.x + (bounds.minX + bounds.maxX) / 2,
    y: piece.position.y + (bounds.minY + bounds.maxY) / 2,
  };
};

const reorient = (
  document: MarkerDocument,
  piece: PlacedPiece,
  patch: Partial<Pick<PlacedPiece, 'rotation' | 'flipped'>>,
): { rotation: number; flipped: boolean; position: Point } => {
  const centre = centreOf(piece);
  const next: PlacedPiece = { ...piece, ...patch };
  const bounds = boundsOf(orientedGeometry(next));
  const wanted: Point = {
    x: centre.x - (bounds.minX + bounds.maxX) / 2,
    y: centre.y - (bounds.minY + bounds.maxY) / 2,
  };
  return {
    rotation: next.rotation,
    flipped: next.flipped,
    position: resolveDragPosition(document, next, wanted),
  };
};

const rotate = (context: CommandContext, sign: 1 | -1): void => {
  const store = useMarkerStore.getState();
  for (const piece of selectedPieces(context)) {
    const step = rotationStepFor(context.document, piece);
    const rotation = (((piece.rotation + sign * step) % 360) + 360) % 360;
    store.updatePiece(piece.id, reorient(context.document, piece, { rotation }));
  }
};

const slide = (context: CommandContext, direction: SlideDirection): void => {
  const store = useMarkerStore.getState();
  for (const piece of selectedPieces(context)) {
    store.updatePiece(piece.id, { position: buttSlide(context.document, piece, direction) });
  }
};

const fitToMarker = (): void => {
  const document = useMarkerStore.getState().document;
  if (!document) return;
  useViewportStore
    .getState()
    .zoomToFit(Math.max(markerLength(document), MIN_FIT_LENGTH), document.fabricWidth);
};

export const COMMANDS: readonly Command[] = [
  {
    id: 'rotate-cw',
    label: 'Rotate clockwise',
    keys: 'R',
    needsSelection: true,
    run: (context) => rotate(context, -1),
  },
  {
    id: 'rotate-ccw',
    label: 'Rotate counter-clockwise',
    keys: 'Shift+R',
    needsSelection: true,
    run: (context) => rotate(context, 1),
  },
  {
    id: 'flip-horizontal',
    label: 'Flip horizontal',
    keys: 'F',
    needsSelection: true,
    run: (context) => {
      const store = useMarkerStore.getState();
      for (const piece of selectedPieces(context)) {
        store.updatePiece(piece.id, reorient(context.document, piece, { flipped: !piece.flipped }));
      }
    },
  },
  {
    id: 'flip-vertical',
    label: 'Flip vertical',
    keys: 'Shift+F',
    needsSelection: true,
    run: (context) => {
      const store = useMarkerStore.getState();
      // There is no vertical-flip field: a vertical flip is a horizontal flip
      // turned half a turn, which is the same transform.
      for (const piece of selectedPieces(context)) {
        store.updatePiece(
          piece.id,
          reorient(context.document, piece, {
            flipped: !piece.flipped,
            rotation: (((piece.rotation + 180) % 360) + 360) % 360,
          }),
        );
      }
    },
  },
  { id: 'nudge-left', label: 'Nudge left 1 cm', keys: '←', needsSelection: true, run: (c) => nudge(c, -NUDGE_CM, 0) },
  { id: 'nudge-right', label: 'Nudge right 1 cm', keys: '→', needsSelection: true, run: (c) => nudge(c, NUDGE_CM, 0) },
  { id: 'nudge-up', label: 'Nudge up 1 cm', keys: '↑', needsSelection: true, run: (c) => nudge(c, 0, NUDGE_CM) },
  { id: 'nudge-down', label: 'Nudge down 1 cm', keys: '↓', needsSelection: true, run: (c) => nudge(c, 0, -NUDGE_CM) },
  { id: 'nudge-left-fine', label: 'Nudge left 1 mm', keys: 'Shift+←', needsSelection: true, run: (c) => nudge(c, -NUDGE_FINE_CM, 0) },
  { id: 'nudge-right-fine', label: 'Nudge right 1 mm', keys: 'Shift+→', needsSelection: true, run: (c) => nudge(c, NUDGE_FINE_CM, 0) },
  { id: 'nudge-up-fine', label: 'Nudge up 1 mm', keys: 'Shift+↑', needsSelection: true, run: (c) => nudge(c, 0, NUDGE_FINE_CM) },
  { id: 'nudge-down-fine', label: 'Nudge down 1 mm', keys: 'Shift+↓', needsSelection: true, run: (c) => nudge(c, 0, -NUDGE_FINE_CM) },
  { id: 'butt-slide-left', label: 'Butt-slide left', keys: 'L', needsSelection: true, run: (c) => slide(c, 'left') },
  { id: 'butt-slide-up', label: 'Butt-slide up', keys: 'U', needsSelection: true, run: (c) => slide(c, 'up') },
  {
    id: 'return-to-tray',
    label: 'Return piece to tray',
    keys: 'Delete',
    needsSelection: true,
    run: (context) => {
      useMarkerStore.getState().returnToTray(context.selection);
      useUiStore.getState().clearSelection();
    },
  },
  {
    id: 'select-bundle',
    label: 'Select whole bundle',
    keys: 'Alt+click',
    needsSelection: true,
    run: (context) => {
      const bundles = new Set(selectedPieces(context).map((piece) => piece.bundle));
      useUiStore
        .getState()
        .setSelection(
          context.document.pieces
            .filter((piece) => bundles.has(piece.bundle))
            .map((piece) => piece.id),
        );
    },
  },
  {
    id: 'deselect',
    label: 'Deselect all',
    keys: 'Esc',
    run: () => useUiStore.getState().clearSelection(),
  },
  { id: 'undo', label: 'Undo', keys: 'Ctrl+Z', run: () => useMarkerStore.getState().undo() },
  { id: 'redo', label: 'Redo', keys: 'Ctrl+Y', run: () => useMarkerStore.getState().redo() },
  {
    id: 'zoom-in',
    label: 'Zoom in',
    keys: '+',
    run: () => {
      const { zoom, setZoom } = useViewportStore.getState();
      setZoom(zoom * ZOOM_STEP);
    },
  },
  {
    id: 'zoom-out',
    label: 'Zoom out',
    keys: '-',
    run: () => {
      const { zoom, setZoom } = useViewportStore.getState();
      setZoom(zoom / ZOOM_STEP);
    },
  },
  { id: 'zoom-fit', label: 'Fit marker to view', keys: '0', run: fitToMarker },
];

export const commandById = (id: string): Command | undefined =>
  COMMANDS.find((command) => command.id === id);

/**
 * Which command a key event runs, or undefined.
 *
 * Modifier handling is explicit rather than pattern-matched on the label: the
 * label is for humans, and letting it drive dispatch is how a shortcut quietly
 * stops working after a wording change.
 */
export const commandForKey = (event: {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): Command | undefined => {
  const accel = event.ctrlKey || event.metaKey;

  if (accel) {
    const key = event.key.toLowerCase();
    if (key === 'z') return commandById(event.shiftKey ? 'redo' : 'undo');
    if (key === 'y') return commandById('redo');
    return undefined;
  }

  if (event.altKey) return undefined;

  switch (event.key) {
    case 'r':
    case 'R':
      return commandById(event.shiftKey ? 'rotate-ccw' : 'rotate-cw');
    case 'f':
    case 'F':
      return commandById(event.shiftKey ? 'flip-vertical' : 'flip-horizontal');
    case 'l':
    case 'L':
      return commandById('butt-slide-left');
    case 'u':
    case 'U':
      return commandById('butt-slide-up');
    case 'ArrowLeft':
      return commandById(event.shiftKey ? 'nudge-left-fine' : 'nudge-left');
    case 'ArrowRight':
      return commandById(event.shiftKey ? 'nudge-right-fine' : 'nudge-right');
    case 'ArrowUp':
      return commandById(event.shiftKey ? 'nudge-up-fine' : 'nudge-up');
    case 'ArrowDown':
      return commandById(event.shiftKey ? 'nudge-down-fine' : 'nudge-down');
    case 'Delete':
    case 'Backspace':
      return commandById('return-to-tray');
    case 'Escape':
      return commandById('deselect');
    case '+':
    case '=':
      return commandById('zoom-in');
    case '-':
      return commandById('zoom-out');
    case '0':
      return commandById('zoom-fit');
    default:
      return undefined;
  }
};
