import Konva from 'konva';
import type { MarkerPalette } from '../theme';

/**
 * The heads-up layer: cursor readout, zoom indicator, marquee rectangle.
 *
 * These sit here rather than on FabricLayer because FabricLayer is the static
 * backdrop — it redraws only when the fabric or the camera changes. A cursor
 * readout redraws on every mouse move, and putting it there would repaint the
 * whole backdrop on each one, which is the opposite of why that layer exists.
 * CLAUDE.md's layer stack assigns cursor coordinates and the marquee here.
 *
 * The chips are positioned in stage pixels, not marker centimetres: they are
 * screen furniture and must not move when the marker is panned.
 */

const CHIP_HEIGHT = 22;
const CHIP_PADDING_X = 8;
const CHIP_MARGIN = 10;
const CHIP_FONT_PX = 11;
const CHIP_RADIUS = 4;

/** Roughly the width of one character at the chip font size. */
const CHAR_WIDTH_PX = 6.2;

export interface ZoomIndicator {
  /** px per cm currently in force. */
  readonly scale: number;
  /** px per cm at 100%, so the figure means something to a person. */
  readonly referenceScale: number;
}

export class UILayer {
  readonly layer = new Konva.Layer({ listening: false });

  /** Owned here, handed to SelectTool — the marquee is UI, not a tool's chrome. */
  readonly marquee = new Konva.Rect({
    listening: false,
    visible: false,
    strokeWidth: 1,
    dash: [4, 3],
    shadowForStrokeEnabled: false,
  });

  private readonly cursorChip = new Konva.Label({ visible: false });
  private readonly cursorTag = new Konva.Tag({ cornerRadius: CHIP_RADIUS });
  private readonly cursorText = new Konva.Text({
    padding: CHIP_PADDING_X,
    fontSize: CHIP_FONT_PX,
  });

  private readonly zoomChip = new Konva.Label({ visible: false });
  private readonly zoomTag = new Konva.Tag({ cornerRadius: CHIP_RADIUS });
  private readonly zoomText = new Konva.Text({
    padding: CHIP_PADDING_X,
    fontSize: CHIP_FONT_PX,
  });

  private stageWidth = 0;
  private stageHeight = 0;

  constructor(palette: MarkerPalette) {
    this.marquee.fill(palette.marqueeFill);
    this.marquee.stroke(palette.marqueeLine);

    for (const [label, tag, text] of [
      [this.cursorChip, this.cursorTag, this.cursorText] as const,
      [this.zoomChip, this.zoomTag, this.zoomText] as const,
    ]) {
      tag.fill(palette.hudBg);
      text.fill(palette.hudText);
      text.fontFamily(palette.fontMono);
      label.add(tag, text);
    }

    this.layer.add(this.marquee, this.cursorChip, this.zoomChip);
  }

  setStageSize(width: number, height: number): void {
    this.stageWidth = width;
    this.stageHeight = height;
    this.reposition();
  }

  /**
   * Cursor position in marker centimetres, or null when the pointer leaves.
   *
   * Takes centimetres rather than pixels so the readout cannot disagree with
   * the coordinate system everything else works in.
   */
  setCursor(position: { x: number; y: number } | null): void {
    if (!position) {
      this.cursorChip.visible(false);
      this.layer.batchDraw();
      return;
    }
    this.cursorText.text(`x ${position.x.toFixed(1)}  y ${position.y.toFixed(1)} cm`);
    this.cursorChip.visible(true);
    this.reposition();
  }

  setZoom(indicator: ZoomIndicator): void {
    const percent = Math.round((indicator.scale / indicator.referenceScale) * 100);
    this.zoomText.text(`${percent}%`);
    this.zoomChip.visible(true);
    this.reposition();
  }

  /** Marquee rectangle in stage pixels, drawn while a drag-select is live. */
  showMarquee(x: number, y: number, width: number, height: number): void {
    this.marquee.setAttrs({ x, y, width, height, visible: true });
    this.layer.batchDraw();
  }

  hideMarquee(): void {
    this.marquee.visible(false);
    this.layer.batchDraw();
  }

  destroy(): void {
    this.layer.destroy();
  }

  /**
   * Chips are pinned to the bottom corners.
   *
   * Konva.Text does not report a width until it has been laid out, so the
   * width is estimated from the character count — close enough to place a chip
   * whose own background sizes itself.
   */
  private reposition(): void {
    const cursorWidth = this.cursorText.text().length * CHAR_WIDTH_PX + CHIP_PADDING_X * 2;
    this.cursorChip.position({
      x: CHIP_MARGIN,
      y: this.stageHeight - CHIP_HEIGHT - CHIP_MARGIN,
    });

    const zoomWidth = this.zoomText.text().length * CHAR_WIDTH_PX + CHIP_PADDING_X * 2;
    this.zoomChip.position({
      x: Math.max(CHIP_MARGIN + cursorWidth + CHIP_MARGIN, this.stageWidth - zoomWidth - CHIP_MARGIN),
      y: this.stageHeight - CHIP_HEIGHT - CHIP_MARGIN,
    });

    this.layer.batchDraw();
  }
}
