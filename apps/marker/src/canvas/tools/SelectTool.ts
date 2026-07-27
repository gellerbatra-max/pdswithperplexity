import Konva from 'konva';
import { boundsOf } from '@/canvas/collision/aabb';
import { orientedGeometry } from '@/marker/pieceGeometry';
import type { MarkerDocument } from '@/marker/schema';
import type { MarkerTransform } from '../types';

/**
 * Marquee selection.
 *
 * Dragging on empty fabric rubber-bands a rectangle on the UI layer and
 * selects every piece it touches. Dragging on a piece is DragTool's gesture,
 * so this only starts when the pointer went down on the stage itself.
 */

const MARQUEE_FILL = 'rgba(109, 163, 212, 0.12)';
const MARQUEE_STROKE = '#6da3d4';

/** Below this the gesture was a click, not a marquee. */
const MIN_MARQUEE_PX = 3;

export interface SelectToolContext {
  readonly document: MarkerDocument;
  readonly transform: MarkerTransform;
}

export interface SelectToolCallbacks {
  readonly getContext: () => SelectToolContext | null;
  /** Additive when shift was held; otherwise the marquee replaces. */
  readonly onMarquee: (pieceIds: string[], additive: boolean) => void;
  /** A click on empty fabric, which clears the selection. */
  readonly onClickEmpty: () => void;
}

interface Rect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Pieces the rectangle touches, in marker space.
 *
 * Touching, not containing: requiring full containment means a marquee across
 * a dense marker selects almost nothing, which is not what the gesture looks
 * like it should do.
 */
export const piecesInRect = (document: MarkerDocument, rect: Rect): string[] => {
  const hits: string[] = [];
  for (const piece of document.pieces) {
    const bounds = boundsOf(orientedGeometry(piece));
    const minX = piece.position.x + bounds.minX;
    const maxX = piece.position.x + bounds.maxX;
    const minY = piece.position.y + bounds.minY;
    const maxY = piece.position.y + bounds.maxY;
    if (minX <= rect.maxX && rect.minX <= maxX && minY <= rect.maxY && rect.minY <= maxY) {
      hits.push(piece.id);
    }
  }
  return hits;
};

export class SelectTool {
  private readonly marquee = new Konva.Rect({
    fill: MARQUEE_FILL,
    stroke: MARQUEE_STROKE,
    strokeWidth: 1,
    dash: [4, 3],
    listening: false,
    visible: false,
    shadowForStrokeEnabled: false,
  });

  private origin: { x: number; y: number } | null = null;
  private additive = false;

  constructor(private readonly callbacks: SelectToolCallbacks) {}

  attach(stage: Konva.Stage, uiLayer: Konva.Layer): void {
    uiLayer.add(this.marquee);

    stage.on('mousedown touchstart', (event) => {
      // Only the bare stage starts a marquee; a hit on a piece belongs to
      // DragTool, which is listening on the piece groups.
      if (event.target !== stage) return;
      const point = stage.getPointerPosition();
      if (!point) return;

      this.origin = point;
      this.additive = event.evt instanceof MouseEvent && event.evt.shiftKey;
      this.marquee.setAttrs({ x: point.x, y: point.y, width: 0, height: 0, visible: true });
      uiLayer.batchDraw();
    });

    stage.on('mousemove touchmove', () => {
      if (!this.origin) return;
      const point = stage.getPointerPosition();
      if (!point) return;

      this.marquee.setAttrs({
        x: Math.min(this.origin.x, point.x),
        y: Math.min(this.origin.y, point.y),
        width: Math.abs(point.x - this.origin.x),
        height: Math.abs(point.y - this.origin.y),
      });
      uiLayer.batchDraw();
    });

    stage.on('mouseup touchend', () => {
      const origin = this.origin;
      if (!origin) return;
      this.origin = null;

      const width = this.marquee.width();
      const height = this.marquee.height();
      this.marquee.visible(false);
      uiLayer.batchDraw();

      const context = this.callbacks.getContext();
      if (!context) return;

      if (width < MIN_MARQUEE_PX && height < MIN_MARQUEE_PX) {
        this.callbacks.onClickEmpty();
        return;
      }

      const { transform } = context;
      const left = this.marquee.x();
      const top = this.marquee.y();
      // Stage Y runs down and marker Y runs up, so the rectangle's top edge is
      // the larger marker coordinate.
      const rect: Rect = {
        minX: transform.toMarkerX(left),
        maxX: transform.toMarkerX(left + width),
        minY: transform.toMarkerY(top + height),
        maxY: transform.toMarkerY(top),
      };

      this.callbacks.onMarquee(piecesInRect(context.document, rect), this.additive);
    });
  }

  destroy(): void {
    this.marquee.destroy();
  }
}
