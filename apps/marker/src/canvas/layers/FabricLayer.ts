import Konva from 'konva';
import { chooseStep, formatTick, majorStep, stepsAcross } from '../gridSteps';
import type { MarkerPalette } from '../theme';
import type { FabricLayerInput } from '../types';

/**
 * The static backdrop: fabric, grid, width guide, rulers.
 *
 * Nothing here is interactive, so hit detection is off — which is what the
 * spec's FastLayer was for. Konva 9.3 deprecates FastLayer in favour of
 * `Layer({ listening: false })`, the same optimisation without the warning.
 *
 * Everything is drawn from the design tokens and clipped to what the viewport
 * can actually show, so a 40 m marker costs the same to draw as a 4 m one.
 */

/** Below this the grid is a grey wash that hides the pieces. */
const MIN_GRID_SCALE = 0.5;

/** Smallest on-screen gap worth drawing a grid line for. */
const MIN_GRID_GAP_PX = 8;

/** Ruler labels need far more room than grid lines. */
const MIN_TICK_GAP_PX = 7;
const MIN_LABEL_GAP_PX = 44;

const TICK_LENGTH_PX = 5;
const TICK_LENGTH_MAJOR_PX = 9;
const LABEL_OFFSET_PX = 12;
const RULER_FONT_PX = 10;

export class FabricLayer {
  readonly layer = new Konva.Layer({ listening: false });

  private input: FabricLayerInput | null = null;

  private readonly fabric = new Konva.Rect({
    strokeWidth: 1,
    shadowForStrokeEnabled: false,
    perfectDrawEnabled: false,
  });

  /**
   * The whole grid in one shape. As individual nodes it would be hundreds of
   * lines on the layer, each with its own transform to maintain.
   */
  private readonly grid = new Konva.Shape({
    listening: false,
    strokeWidth: 1,
    shadowForStrokeEnabled: false,
    perfectDrawEnabled: false,
    sceneFunc: (context, shape) => this.drawGrid(context, shape),
  });

  /** Marks the far edge of usable fabric width. */
  private readonly widthGuide = new Konva.Line({
    strokeWidth: 1,
    dash: [6, 4],
    shadowForStrokeEnabled: false,
  });

  /** Ticks and their labels, likewise one shape rather than hundreds. */
  private readonly ruler = new Konva.Shape({
    listening: false,
    strokeWidth: 1,
    shadowForStrokeEnabled: false,
    perfectDrawEnabled: false,
    sceneFunc: (context, shape) => this.drawRuler(context, shape),
  });

  constructor(private readonly palette: MarkerPalette) {
    this.fabric.fill(palette.fabricBg);
    this.fabric.stroke(palette.fabricEdge);
    this.widthGuide.stroke(palette.fabricGuide);
    this.grid.stroke(palette.gridLine);
    this.ruler.stroke(palette.rulerTick);

    this.layer.add(this.fabric, this.grid, this.widthGuide, this.ruler);
    this.layer.visible(false);
  }

  update(input: FabricLayerInput): void {
    this.input = input;
    const { fabricWidth, fabricLength, transform } = input;

    // y() flips the axis, so the fabric's top edge in stage space is
    // y(fabricWidth).
    const left = transform.x(0);
    const top = transform.y(fabricWidth);
    this.fabric.setAttrs({
      x: left,
      y: top,
      width: fabricLength * transform.scale,
      height: fabricWidth * transform.scale,
    });

    this.widthGuide.points([left, top, transform.x(fabricLength), top]);
    this.grid.visible(transform.scale >= MIN_GRID_SCALE);

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

  /**
   * Only the span the stage can show.
   *
   * Without this the loops run the length of the marker, most of it off-screen,
   * and the cost of a pan grows with the size of the order.
   */
  private visibleSpan(input: FabricLayerInput): {
    fromX: number;
    toX: number;
    fromY: number;
    toY: number;
  } {
    const { transform, stageWidth, stageHeight, fabricLength, fabricWidth } = input;
    return {
      fromX: Math.max(0, transform.toMarkerX(0)),
      toX: Math.min(fabricLength, transform.toMarkerX(stageWidth)),
      // Stage Y runs down, so the bottom of the screen is the smaller marker y.
      fromY: Math.max(0, transform.toMarkerY(stageHeight)),
      toY: Math.min(fabricWidth, transform.toMarkerY(0)),
    };
  }

  private drawGrid(context: Konva.Context, shape: Konva.Shape): void {
    const input = this.input;
    if (!input) return;

    const { transform, fabricWidth, fabricLength } = input;
    const span = this.visibleSpan(input);
    if (span.toX <= span.fromX || span.toY <= span.fromY) return;

    const step = chooseStep(transform.scale, MIN_GRID_GAP_PX);
    const major = majorStep(step);

    const bottom = transform.y(Math.max(0, span.fromY));
    const topEdge = transform.y(Math.min(fabricWidth, span.toY));
    const leftEdge = transform.x(Math.max(0, span.fromX));
    const rightEdge = transform.x(Math.min(fabricLength, span.toX));

    // Two passes so minor and major lines can differ in weight without
    // restroking the whole path per line.
    for (const pass of ['minor', 'major'] as const) {
      const interval = pass === 'minor' ? step : major;
      context.beginPath();

      const columns = stepsAcross(span.fromX, span.toX, interval);
      for (let n = columns.first; n <= columns.last; n += 1) {
        const cm = n * interval;
        if (pass === 'minor' && cm % major === 0) continue;
        const x = transform.x(cm);
        context.moveTo(x, topEdge);
        context.lineTo(x, bottom);
      }

      const rows = stepsAcross(span.fromY, span.toY, interval);
      for (let n = rows.first; n <= rows.last; n += 1) {
        const cm = n * interval;
        if (pass === 'minor' && cm % major === 0) continue;
        const y = transform.y(cm);
        context.moveTo(leftEdge, y);
        context.lineTo(rightEdge, y);
      }

      shape.stroke(pass === 'minor' ? this.palette.gridLine : this.palette.gridLineMajor);
      context.strokeShape(shape);
    }
  }

  private drawRuler(context: Konva.Context, shape: Konva.Shape): void {
    const input = this.input;
    if (!input) return;

    const { transform } = input;
    const span = this.visibleSpan(input);
    if (span.toX <= span.fromX) return;

    const step = chooseStep(transform.scale, MIN_TICK_GAP_PX);
    const major = majorStep(step);
    const labelStep = chooseStep(transform.scale, MIN_LABEL_GAP_PX);

    const baseline = transform.y(0);

    // Minor ticks.
    context.beginPath();
    const minor = stepsAcross(span.fromX, span.toX, step);
    for (let n = minor.first; n <= minor.last; n += 1) {
      const cm = n * step;
      if (cm % major === 0) continue;
      const x = transform.x(cm);
      context.moveTo(x, baseline);
      context.lineTo(x, baseline + TICK_LENGTH_PX);
    }
    shape.stroke(this.palette.rulerTick);
    context.strokeShape(shape);

    // Major ticks.
    context.beginPath();
    const majors = stepsAcross(span.fromX, span.toX, major);
    for (let n = majors.first; n <= majors.last; n += 1) {
      const x = transform.x(n * major);
      context.moveTo(x, baseline);
      context.lineTo(x, baseline + TICK_LENGTH_MAJOR_PX);
    }
    shape.stroke(this.palette.rulerTickMajor);
    context.strokeShape(shape);

    // Labels, at their own interval so they never collide.
    context.setAttr('fillStyle', this.palette.rulerLabel);
    context.setAttr('font', `${RULER_FONT_PX}px ${this.palette.fontUi}`);
    context.setAttr('textAlign', 'center');
    context.setAttr('textBaseline', 'top');

    const labels = stepsAcross(span.fromX, span.toX, labelStep);
    for (let n = labels.first; n <= labels.last; n += 1) {
      const cm = n * labelStep;
      context.fillText(formatTick(cm), transform.x(cm), baseline + LABEL_OFFSET_PX);
    }
  }
}
