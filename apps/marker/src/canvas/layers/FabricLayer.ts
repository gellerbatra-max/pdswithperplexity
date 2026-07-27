import Konva from 'konva';
import type { FabricLayerInput } from '../types';

/**
 * The static backdrop: fabric rectangle, width guide, ruler ticks.
 *
 * Nothing here is interactive, so hit detection is off — which is what the
 * spec's FastLayer was for. Konva 9.3 deprecates FastLayer in favour of
 * `Layer({ listening: false })`, which is the same optimisation without the
 * warning. It redraws only when the fabric dimensions or the camera change.
 */

const FABRIC_FILL = '#f4f4f5';
const FABRIC_STROKE = '#d4d4d8';
const GUIDE_STROKE = '#a1a1aa';
const TICK_STROKE = '#a1a1aa';

const TICK_SPACING_CM = 10;
const TICK_LENGTH_PX = 6;

/**
 * Zoomed far enough out, 10 cm ticks collapse into a grey smear that costs
 * thousands of path segments to draw. Below this gap the spacing steps up a
 * decade at a time instead.
 */
const MIN_TICK_GAP_PX = 4;

export class FabricLayer {
  readonly layer = new Konva.Layer({ listening: false });

  private input: FabricLayerInput | null = null;

  private readonly fabric = new Konva.Rect({
    fill: FABRIC_FILL,
    stroke: FABRIC_STROKE,
    strokeWidth: 1,
    shadowForStrokeEnabled: false,
    perfectDrawEnabled: false,
  });

  /** Marks the far edge of usable fabric width. */
  private readonly widthGuide = new Konva.Line({
    stroke: GUIDE_STROKE,
    strokeWidth: 1,
    dash: [6, 4],
    shadowForStrokeEnabled: false,
  });

  /**
   * Every tick is one path in a single shape. Drawing them as individual Konva
   * nodes would put hundreds of objects on the layer for a long marker.
   */
  private readonly ruler = new Konva.Shape({
    stroke: TICK_STROKE,
    strokeWidth: 1,
    shadowForStrokeEnabled: false,
    perfectDrawEnabled: false,
    sceneFunc: (context, shape) => {
      const input = this.input;
      if (!input) return;
      const { transform, fabricLength } = input;

      let step = TICK_SPACING_CM;
      while (step * transform.scale < MIN_TICK_GAP_PX) step *= 10;

      const baseline = transform.y(0);
      context.beginPath();
      for (let cm = 0; cm <= fabricLength; cm += step) {
        const x = transform.x(cm);
        context.moveTo(x, baseline);
        context.lineTo(x, baseline + TICK_LENGTH_PX);
      }
      context.strokeShape(shape);
    },
  });

  constructor() {
    this.layer.add(this.fabric, this.widthGuide, this.ruler);
    this.layer.visible(false);
  }

  update(input: FabricLayerInput): void {
    this.input = input;
    const { fabricWidth, fabricLength, transform } = input;

    // y() flips the axis, so the fabric's top edge in stage space is y(fabricWidth).
    const left = transform.x(0);
    const top = transform.y(fabricWidth);
    this.fabric.setAttrs({
      x: left,
      y: top,
      width: fabricLength * transform.scale,
      height: fabricWidth * transform.scale,
    });

    this.widthGuide.points([left, top, transform.x(fabricLength), top]);

    this.layer.visible(true);
    this.layer.batchDraw();
  }

  /** Hide everything — used when no marker is open. */
  clear(): void {
    this.input = null;
    this.layer.visible(false);
    this.layer.batchDraw();
  }

  destroy(): void {
    this.layer.destroy();
  }
}
