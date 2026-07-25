import type { Vec2 } from '@/geometry';
import type { CanvasTool } from './types';

/**
 * Drag to pan. The running pointer position lives in the gesture closure, so
 * the host holds no drag state of its own.
 */
export const panTool: CanvasTool = {
  id: 'pan',
  cursor: 'grab',

  onPointerDown: (ctx) => {
    let last: Vec2 = ctx.screen;

    return {
      cursor: 'grabbing',
      onMove: (next, actions) => {
        actions.panBy({ x: next.screen.x - last.x, y: next.screen.y - last.y });
        last = next.screen;
      },
    };
  },
};
