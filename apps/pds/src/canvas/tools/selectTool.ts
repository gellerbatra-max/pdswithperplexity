import { pieceRef, pointRef, type SelectionRef } from '@/store';
import { pickPiece, pickPoint } from '../hitTest';
import type { CanvasTool, ToolContext } from './types';

/**
 * Resolve what is under the pointer, trying each selectable kind in the order
 * the workspace declared. Points before pieces means a grade point stays
 * clickable even though it sits on top of its own piece.
 */
const pick = (ctx: ToolContext): SelectionRef | null => {
  for (const kind of ctx.selectableKinds) {
    if (kind === 'point') {
      const hit = pickPoint(ctx.pieces, ctx.world, ctx.pickRadius);
      if (hit) return pointRef(hit.pieceId, hit.pointId);
    } else if (kind === 'piece') {
      const hit = pickPiece(ctx.pieces, ctx.world);
      if (hit) return pieceRef(hit);
    }
  }
  return null;
};

/**
 * Click to select, shift-click to add or remove, click empty space to clear.
 *
 * Dragging is intentionally inert for now. When move-and-nudge lands it becomes
 * a gesture returned from `onPointerDown`, and nothing else has to change.
 */
export const selectTool: CanvasTool = {
  id: 'select',
  cursor: 'default',

  onPointerDown: (ctx, actions) => {
    if (ctx.button !== 0) return;

    const ref = pick(ctx);
    if (ref) actions.select(ref, ctx.modifiers.shift);
    else if (!ctx.modifiers.shift) actions.clearSelection();
  },

  onPointerMove: (ctx, actions) => {
    actions.setHover(pick(ctx));
  },
};
