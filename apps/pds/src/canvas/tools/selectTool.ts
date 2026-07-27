import type { Vec2 } from '@/geometry';
import {
  setSegmentHandle,
  translatePiece,
  translatePoints,
  type HandleKind,
  type PatternPiece,
  type PointId,
  type SegmentId,
} from '@/pattern';
import { pieceRef, pointRef, segmentRef, type SelectionRef } from '@/store';
import { pickHandle, pickPiece, pickPoint, pickSegment } from '../hitTest';
import type { CanvasTool, ToolContext, ToolGesture, TranslateEdit } from './types';

/**
 * Resolve what is under the pointer, trying each selectable kind in the order
 * the workspace declared. Points before segments before pieces, so the smallest
 * thing under the cursor wins — otherwise a point could never be grabbed,
 * because it always sits on an edge, which always sits on a piece.
 */
const pick = (ctx: ToolContext): SelectionRef | null => {
  for (const kind of ctx.selectableKinds) {
    if (kind === 'point') {
      const hit = pickPoint(ctx.pieces, ctx.world, ctx.pickRadius);
      if (hit) return pointRef(hit.pieceId, hit.pointId);
    } else if (kind === 'segment') {
      const hit = pickSegment(ctx.pieces, ctx.world, ctx.pickRadius);
      if (hit) return segmentRef(hit.pieceId, hit.segmentId);
    } else if (kind === 'piece') {
      const hit = pickPiece(ctx.pieces, ctx.world);
      if (hit) return pieceRef(hit);
    }
  }
  return null;
};

/**
 * Below this the pointer has not really moved — it is a click with a shaky
 * hand. Measured in screen pixels so the threshold means the same thing at
 * every zoom level. Without it, selecting a point would nudge it.
 */
const DRAG_THRESHOLD_PX = 3;

/** Which points a drag on `ref` moves, and how the edit is described. */
const targetFor = (
  ref: SelectionRef,
  piece: PatternPiece,
): { readonly pointIds: readonly PointId[]; readonly target: TranslateEdit['target'] } | null => {
  switch (ref.kind) {
    case 'point':
      return { pointIds: [ref.pointId], target: { kind: 'points', pointIds: [ref.pointId] } };
    case 'segment': {
      const segment = piece.segments.find((s) => s.id === ref.segmentId);
      if (!segment) return null;
      return {
        pointIds: [segment.from, segment.to],
        target: { kind: 'segment', segmentId: ref.segmentId },
      };
    }
    case 'piece':
      return { pointIds: piece.points.map((p) => p.id), target: { kind: 'piece' } };
  }
};

/**
 * Builds the drag. `origin` is the piece as it was on pointerdown; every frame
 * re-derives from it rather than accumulating, so the preview and the committed
 * result are computed the same way and cannot drift apart.
 */
const beginDrag = (
  ref: SelectionRef,
  origin: PatternPiece,
  start: Vec2,
  pointIds: readonly PointId[],
  target: TranslateEdit['target'],
  camera: { readonly zoom: number },
): ToolGesture => {
  let moved = false;

  const deltaFrom = (world: Vec2): Vec2 => ({ x: world.x - start.x, y: world.y - start.y });

  const draft = (delta: Vec2): PatternPiece =>
    target.kind === 'piece'
      ? translatePiece(origin, delta)
      : translatePoints(origin, new Map(pointIds.map((id) => [id, delta])));

  return {
    cursor: 'grabbing',

    onMove: (ctx, actions) => {
      const delta = deltaFrom(ctx.world);
      if (!moved) {
        const travelled = Math.hypot(delta.x, delta.y) * camera.zoom;
        if (travelled < DRAG_THRESHOLD_PX) return;
        moved = true;
      }
      actions.preview(draft(delta));
    },

    onEnd: (ctx, actions) => {
      // Always drop the preview first: if the commit throws, the canvas must
      // fall back to the committed document rather than keep showing a draft
      // that no longer corresponds to anything.
      actions.preview(null);
      if (!moved) return;

      const delta = deltaFrom(ctx.world);
      if (delta.x === 0 && delta.y === 0) return;
      actions.commitTranslate({ pieceId: ref.pieceId, origin, delta, target });
    },
  };
};

/**
 * A curve handle belonging to a currently-selected edge, if the pointer is on
 * one. Checked before anything else on pointerdown: handles sit near their
 * endpoint, so picking points first would make a handle next to its own anchor
 * impossible to grab.
 */
const pickSelectedHandle = (
  ctx: ToolContext,
): { pieceId: string; segmentId: SegmentId; handle: HandleKind } | null => {
  for (const ref of ctx.selection) {
    if (ref.kind !== 'segment') continue;
    const piece = ctx.pieces.find((p) => p.id === ref.pieceId);
    if (!piece) continue;
    const handle = pickHandle(piece, ref.segmentId, ctx.world, ctx.pickRadius);
    if (handle) return { pieceId: ref.pieceId, segmentId: ref.segmentId, handle };
  }
  return null;
};

/** Drags one control handle, reshaping the edge under the pointer. */
const beginHandleDrag = (
  target: { pieceId: string; segmentId: SegmentId; handle: HandleKind },
  origin: PatternPiece,
): ToolGesture => ({
  cursor: 'grabbing',

  onMove: (ctx, actions) => {
    actions.preview(setSegmentHandle(origin, target.segmentId, target.handle, ctx.world));
  },

  onEnd: (ctx, actions) => {
    actions.preview(null);
    actions.commitHandle({
      pieceId: target.pieceId,
      origin,
      segmentId: target.segmentId,
      handle: target.handle,
      position: ctx.world,
    });
  },
});

/**
 * Click to select, shift-click to add or remove, click empty space to clear —
 * and drag to move whatever was picked. Dragging a selected edge's control
 * handle reshapes it; double-clicking an edge adds a point where you clicked.
 *
 * A drag never touches the document while it is in flight; it draws a preview
 * and commits one command on pointerup. See `store/previewStore.ts`.
 */
export const selectTool: CanvasTool = {
  id: 'select',
  cursor: 'default',

  onPointerDown: (ctx, actions) => {
    if (ctx.button !== 0) return;

    // Handles win over everything, and only for the current selection.
    const handle = pickSelectedHandle(ctx);
    if (handle && !ctx.modifiers.shift) {
      const piece = ctx.pieces.find((p) => p.id === handle.pieceId);
      if (piece) return beginHandleDrag(handle, piece);
    }

    const ref = pick(ctx);
    if (!ref) {
      if (!ctx.modifiers.shift) actions.clearSelection();
      return;
    }

    actions.select(ref, ctx.modifiers.shift);

    // Shift-click is selection bookkeeping, not the start of a move.
    if (ctx.modifiers.shift) return;

    const piece = ctx.pieces.find((p) => p.id === ref.pieceId);
    if (!piece) return;

    const resolved = targetFor(ref, piece);
    if (!resolved) return;

    return beginDrag(ref, piece, ctx.world, resolved.pointIds, resolved.target, ctx.camera);
  },

  onPointerMove: (ctx, actions) => {
    actions.setHover(pick(ctx));
  },

  /*
   * Double-click on an edge adds a point there; alt-double-click drops a notch
   * instead. Position matters for both — a balance notch is placed at a
   * measured spot along the seam, not at a convenient one — so each takes the
   * `t` the hit test solved for rather than offering a fixed split from a menu.
   */
  onDoubleClick: (ctx, actions) => {
    const hit = pickSegment(ctx.pieces, ctx.world, ctx.pickRadius);
    if (!hit) return;
    if (ctx.modifiers.alt) actions.addNotch(hit.pieceId, hit.segmentId, hit.t);
    else actions.insertPoint(hit.pieceId, hit.segmentId, hit.t);
  },
};
