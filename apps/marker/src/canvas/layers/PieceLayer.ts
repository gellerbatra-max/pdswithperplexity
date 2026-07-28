import Konva from 'konva';
import { bundleSlots } from '@/marker/bundles';
import { orientedGeometry } from '@/marker/pieceGeometry';
import type { LayDirection, MarkerDocument, PlacedPiece, Point } from '@/marker/schema';
import { findViolations } from '@/marker/violations';
import { boundsOf } from '../collision/aabb';
import { chooseTier, fitFontSize, MIN_LABEL_FONT_PX, usableSpace } from '../labelFit';
import type { MarkerPalette } from '../theme';
import type { DragTool } from '../tools/DragTool';
import type { MarkerTransform } from '../types';

/**
 * One Konva.Group per placed piece: selection halo, polygon, grain line, label.
 *
 * Groups are positioned in stage space and hold their points in local pixels,
 * so panning only moves each group — the geometry is rebuilt on zoom or when
 * the piece's own shape changes, not on every frame.
 *
 * Every colour comes from the palette, which is read out of the design tokens.
 * Nothing here has a colour of its own.
 */

/** Below this a label is unreadable and only costs text shaping. */
const MIN_LABEL_SCALE = 0.6;

/** Below this the grain line is a smudge; the piece is a shape, not a piece. */
const MIN_GRAIN_SCALE = 0.35;

/** Grain line spans this share of the piece's shorter dimension. */
const GRAIN_LENGTH_RATIO = 0.55;

const GRAIN_ARROW_PX = 5;
const SELECTION_HALO_WIDTH = 5;

/** Violation pulse period. Slow enough to read as a warning, not a strobe. */
const FLASH_INTERVAL_MS = 450;

export interface PieceLayerInput {
  readonly document: MarkerDocument;
  readonly transform: MarkerTransform;
  readonly stageWidth: number;
  readonly stageHeight: number;
  readonly selection: readonly string[];
}

interface PieceNode {
  readonly group: Konva.Group;
  readonly halo: Konva.Line;
  readonly polygon: Konva.Line;
  readonly grain: Konva.Shape;
  readonly nameLabel: Konva.Text;
  readonly sizeLabel: Konva.Text;

  /** What the local geometry was built from, so we know when to rebuild. */
  geometry: Point[];
  rotation: number;
  flipped: boolean;
  scale: number;

  slot: number;
  selected: boolean;
  violating: boolean;

  /** Local bounds in px, for culling without recomputing the polygon. */
  localMinX: number;
  localMinY: number;
  localMaxX: number;
  localMaxY: number;
  cached: boolean;
}

export class PieceLayer {
  readonly layer = new Konva.Layer();

  private readonly nodes = new Map<string, PieceNode>();
  private dragTool: DragTool | null = null;

  /** Recomputing overlaps on every pan would be wasted work. */
  private violationsFor: MarkerDocument | null = null;
  private violations: Set<string> = new Set();

  private flashTimer: ReturnType<typeof setInterval> | null = null;
  private flashOn = false;

  constructor(private readonly palette: MarkerPalette) {}

  /** Set once, before the first update. */
  setDragTool(dragTool: DragTool): void {
    this.dragTool = dragTool;
  }

  update(input: PieceLayerInput): void {
    const { document } = input;

    // Violations depend on the document alone, so a pan or zoom reuses them.
    if (this.violationsFor !== document) {
      this.violations = findViolations(document);
      this.violationsFor = document;
    }

    const slots = bundleSlots(document);
    const present = new Set<string>();

    for (const piece of document.pieces) {
      present.add(piece.id);
      const node = this.nodes.get(piece.id) ?? this.createNode(piece);
      this.syncNode(node, piece, input, slots.get(piece.bundle) ?? 0);
    }

    for (const [id, node] of this.nodes) {
      if (present.has(id)) continue;
      node.group.destroy();
      this.nodes.delete(id);
    }

    this.setFlashing(this.violations.size > 0);
    this.layer.batchDraw();
  }

  destroy(): void {
    this.setFlashing(false);
    this.nodes.clear();
    this.layer.destroy();
  }

  /**
   * Pulse the violation outlines.
   *
   * A timer rather than a per-frame animation: two and a bit redraws a second
   * is enough to read as a flash, where 60 would repaint the whole layer for
   * an effect nobody can see move.
   */
  private setFlashing(active: boolean): void {
    if (active === (this.flashTimer !== null)) return;

    if (!active) {
      if (this.flashTimer !== null) clearInterval(this.flashTimer);
      this.flashTimer = null;
      this.flashOn = false;
      for (const node of this.nodes.values()) {
        if (node.violating) node.polygon.opacity(1);
      }
      this.layer.batchDraw();
      return;
    }

    this.flashTimer = setInterval(() => {
      this.flashOn = !this.flashOn;
      let painted = false;
      for (const node of this.nodes.values()) {
        if (!node.violating || !node.group.visible()) continue;
        node.polygon.opacity(this.flashOn ? 0.55 : 1);
        painted = true;
      }
      if (painted) this.layer.batchDraw();
    }, FLASH_INTERVAL_MS);
  }

  private createNode(piece: PlacedPiece): PieceNode {
    const group = new Konva.Group({ name: piece.id });

    // Drawn first and wider than the outline, so it reads as a ring around
    // the piece rather than a thicker edge on it.
    const halo = new Konva.Line({
      closed: true,
      stroke: this.palette.selectedLine,
      strokeWidth: SELECTION_HALO_WIDTH,
      opacity: 0.45,
      lineJoin: 'round',
      listening: false,
      visible: false,
      shadowForStrokeEnabled: false,
      perfectDrawEnabled: false,
    });

    const polygon = new Konva.Line({
      closed: true,
      strokeWidth: 1,
      lineJoin: 'round',
      shadowForStrokeEnabled: false,
      perfectDrawEnabled: false,
    });

    // One shape for the whole grain mark: a line plus its arrowheads would
    // otherwise be three nodes per piece.
    const grain = new Konva.Shape({
      listening: false,
      strokeWidth: 1,
      shadowForStrokeEnabled: false,
      perfectDrawEnabled: false,
      sceneFunc: () => undefined,
    });

    const nameLabel = new Konva.Text({
      fontFamily: this.palette.fontUi,
      fontStyle: '600',
      listening: false,
      perfectDrawEnabled: false,
    });

    const sizeLabel = new Konva.Text({
      fontFamily: this.palette.fontUi,
      listening: false,
      opacity: 0.75,
      perfectDrawEnabled: false,
    });

    group.add(halo, polygon, grain, nameLabel, sizeLabel);
    this.layer.add(group);
    this.dragTool?.attach(group, piece.id);

    const node: PieceNode = {
      group,
      halo,
      polygon,
      grain,
      nameLabel,
      sizeLabel,
      geometry: [],
      rotation: Number.NaN,
      flipped: false,
      scale: Number.NaN,
      slot: -1,
      selected: false,
      violating: false,
      localMinX: 0,
      localMinY: 0,
      localMaxX: 0,
      localMaxY: 0,
      cached: false,
    };
    this.nodes.set(piece.id, node);
    return node;
  }

  private syncNode(
    node: PieceNode,
    piece: PlacedPiece,
    input: PieceLayerInput,
    slot: number,
  ): void {
    const { transform, stageWidth, stageHeight } = input;

    // Geometry is compared by reference: the store replaces the array only
    // when the outline changes, so a drag never triggers a rebuild.
    const stale =
      node.geometry !== piece.geometry ||
      node.rotation !== piece.rotation ||
      node.flipped !== piece.flipped ||
      node.scale !== transform.scale;

    if (stale) this.rebuild(node, piece, input, slot);

    const selected = input.selection.includes(piece.id);
    const violating = this.violations.has(piece.id);

    if (selected !== node.selected || violating !== node.violating || slot !== node.slot) {
      node.selected = selected;
      node.violating = violating;
      node.slot = slot;
      this.paint(node, slot);
      // A cached group keeps painting the colours it was cached with.
      this.invalidate(node);
    }

    node.group.position({
      x: transform.x(piece.position.x),
      y: transform.y(piece.position.y),
    });

    // Viewport culling: a group entirely off-stage costs nothing to skip.
    const left = node.group.x() + node.localMinX;
    const right = node.group.x() + node.localMaxX;
    const top = node.group.y() + node.localMinY;
    const bottom = node.group.y() + node.localMaxY;
    const onScreen = right >= 0 && left <= stageWidth && bottom >= 0 && top <= stageHeight;

    node.group.visible(onScreen);
    if (!onScreen) return;

    // A flashing piece must repaint, so it stays uncached while it pulses.
    if (node.violating) {
      if (node.cached) this.invalidate(node);
      return;
    }

    if (!node.cached && node.localMaxX > node.localMinX && node.localMaxY > node.localMinY) {
      node.group.cache();
      node.cached = true;
    }
  }

  private invalidate(node: PieceNode): void {
    if (!node.cached) return;
    node.group.clearCache();
    node.cached = false;
  }

  /** Colours only — nothing here depends on the piece's shape. */
  private paint(node: PieceNode, slot: number): void {
    const bundle = this.palette.bundles[slot] ?? {
      line: this.palette.pieceLine,
      fill: this.palette.pieceFill,
      chip: this.palette.pieceLine,
    };

    node.polygon.fill(node.violating ? this.palette.violationFill : bundle.fill);

    if (node.violating) {
      node.polygon.stroke(this.palette.violationLine);
      node.polygon.strokeWidth(2);
      node.polygon.dash(this.palette.violationDash);
    } else {
      node.polygon.stroke(node.selected ? this.palette.selectedLine : bundle.line);
      node.polygon.strokeWidth(node.selected ? this.palette.selectedWidth : 1);
      node.polygon.dash([]);
    }
    node.polygon.opacity(1);

    node.halo.visible(node.selected);
    node.grain.stroke(node.violating ? this.palette.violationLine : bundle.line);
    node.nameLabel.fill(bundle.line);
    node.sizeLabel.fill(bundle.line);
  }

  private rebuild(
    node: PieceNode,
    piece: PlacedPiece,
    input: PieceLayerInput,
    slot: number,
  ): void {
    const { transform, document } = input;
    const oriented = orientedGeometry(piece);
    const { scale } = transform;

    const points: number[] = [];
    for (const point of oriented) {
      // Marker Y runs up, stage Y runs down.
      points.push(point.x * scale, -point.y * scale);
    }
    node.polygon.points(points);
    node.halo.points(points);

    if (oriented.length > 0) {
      const bounds = boundsOf(oriented);
      node.localMinX = bounds.minX * scale;
      node.localMaxX = bounds.maxX * scale;
      node.localMinY = -bounds.maxY * scale;
      node.localMaxY = -bounds.minY * scale;
    } else {
      node.localMinX = 0;
      node.localMaxX = 0;
      node.localMinY = 0;
      node.localMaxY = 0;
    }

    const centreX = (node.localMinX + node.localMaxX) / 2;
    const centreY = (node.localMinY + node.localMaxY) / 2;
    const width = node.localMaxX - node.localMinX;
    const height = node.localMaxY - node.localMinY;

    this.buildGrain(node, piece, document, { centreX, centreY, width, height, scale });
    this.buildLabels(node, piece, { centreX, centreY, width, height, scale });
    this.paint(node, slot);

    node.geometry = piece.geometry;
    node.rotation = piece.rotation;
    node.flipped = piece.flipped;
    node.scale = scale;
    node.slot = slot;

    this.invalidate(node);
  }

  /**
   * The grain line: which way the piece is lying.
   *
   * Drawn along the piece's own +Y, which is where a pattern piece carries its
   * grain, and rotated with it — so the mark turns when the piece turns and
   * reverses when it is flipped, making both visible at a glance. A two-way
   * piece gets arrowheads at both ends, because it may be laid either way
   * along the grain; a four-way or free piece gets one.
   *
   * TODO(grain-vector): DXF files carry a real grain line as its own entity.
   * Until the importer keeps it, this is the piece's local axis, which is
   * right for the great majority of pieces and wrong for a bias-cut one.
   */
  private buildGrain(
    node: PieceNode,
    piece: PlacedPiece,
    document: MarkerDocument,
    box: { centreX: number; centreY: number; width: number; height: number; scale: number },
  ): void {
    const tray = document.trayPieces.find((candidate) => candidate.id === piece.pieceDefId);
    const layDirection: LayDirection = tray?.layDirection ?? 'free';
    const doubleHeaded = layDirection === '2way';

    const radians = (piece.rotation * Math.PI) / 180;
    // Local +Y in marker space is -Y on the stage, hence the negated sine.
    const flip = piece.flipped ? -1 : 1;
    const axisX = Math.sin(radians) * flip;
    const axisY = -Math.cos(radians);

    const half = (Math.min(box.width, box.height) * GRAIN_LENGTH_RATIO) / 2;
    const { centreX, centreY } = box;
    const visible = box.scale >= MIN_GRAIN_SCALE && half > GRAIN_ARROW_PX;

    node.grain.visible(visible);
    if (!visible) return;

    node.grain.sceneFunc((context, shape) => {
      const tipX = centreX + axisX * half;
      const tipY = centreY + axisY * half;
      const tailX = centreX - axisX * half;
      const tailY = centreY - axisY * half;

      context.beginPath();
      context.moveTo(tailX, tailY);
      context.lineTo(tipX, tipY);

      // Arrowheads, drawn from the axis so they turn with the piece.
      const wingX = -axisY * GRAIN_ARROW_PX * 0.6;
      const wingY = axisX * GRAIN_ARROW_PX * 0.6;
      context.moveTo(tipX, tipY);
      context.lineTo(tipX - axisX * GRAIN_ARROW_PX + wingX, tipY - axisY * GRAIN_ARROW_PX + wingY);
      context.moveTo(tipX, tipY);
      context.lineTo(tipX - axisX * GRAIN_ARROW_PX - wingX, tipY - axisY * GRAIN_ARROW_PX - wingY);

      if (doubleHeaded) {
        context.moveTo(tailX, tailY);
        context.lineTo(
          tailX + axisX * GRAIN_ARROW_PX + wingX,
          tailY + axisY * GRAIN_ARROW_PX + wingY,
        );
        context.moveTo(tailX, tailY);
        context.lineTo(
          tailX + axisX * GRAIN_ARROW_PX - wingX,
          tailY + axisY * GRAIN_ARROW_PX - wingY,
        );
      }

      context.strokeShape(shape);
    });
  }

  /**
   * Name over size, centred, and never wider than the piece.
   *
   * A label is measured against the piece that carries it, not against the
   * zoom: sizing by zoom alone put "Cuff right" straight across its
   * neighbours, because a 22 x 10 cm cuff was given the same label as a
   * 50 x 68 cm back. Where the full label will not fit, the size line goes
   * first, then the font shrinks, then the name is truncated, then nothing is
   * drawn at all — the grain line and the bundle colour still identify the
   * piece, and a smear across three neighbours identifies nothing.
   *
   * Text is not rotated with the piece: a marker is read at a glance across a
   * whole spread, and labels that follow their piece end up upside down.
   *
   * Fitting is against the bounding box, so a label can still sit over the
   * hollow of a deeply concave piece. Fitting inside the outline itself needs
   * the largest inscribed rectangle, which is a lot of work for the few pieces
   * it would change.
   */
  private buildLabels(
    node: PieceNode,
    piece: PlacedPiece,
    box: { centreX: number; centreY: number; width: number; height: number; scale: number },
  ): void {
    const hide = () => {
      node.nameLabel.visible(false);
      node.sizeLabel.visible(false);
    };

    // Cheap early-out before any text measurement.
    if (box.scale < MIN_LABEL_SCALE || piece.name === '') {
      hide();
      return;
    }

    const usable = usableSpace({ width: box.width, height: box.height });
    if (usable.width <= 0 || usable.height < MIN_LABEL_FONT_PX) {
      hide();
      return;
    }

    const { labelSize, labelSizeSmall } = this.palette;

    // Measure once at the natural size; width scales linearly from there.
    node.nameLabel.fontSize(labelSize);
    node.nameLabel.text(piece.name);
    const naturalNameWidth = node.nameLabel.width();

    const nameFont = fitFontSize(naturalNameWidth, labelSize, usable.width);

    let sizeFont: number | null = null;
    if (piece.size !== '') {
      node.sizeLabel.fontSize(labelSizeSmall);
      node.sizeLabel.text(piece.size);
      sizeFont = fitFontSize(node.sizeLabel.width(), labelSizeSmall, usable.width);
    }

    const tier = chooseTier({
      space: { width: box.width, height: box.height },
      nameFits: nameFont !== null,
      sizeFits: sizeFont !== null,
      hasSize: piece.size !== '',
      nameFontSize: nameFont ?? labelSize,
      sizeFontSize: sizeFont ?? labelSizeSmall,
      truncatable: true,
    });

    if (tier === 'none') {
      hide();
      return;
    }

    if (tier === 'truncated') {
      const truncated = this.truncate(node.nameLabel, piece.name, usable.width, MIN_LABEL_FONT_PX);
      if (truncated === null) {
        hide();
        return;
      }
      node.nameLabel.visible(true);
      node.sizeLabel.visible(false);
      this.centreLine(node.nameLabel, box, MIN_LABEL_FONT_PX, 0);
      return;
    }

    const font = nameFont ?? labelSize;
    node.nameLabel.fontSize(font);
    node.nameLabel.text(piece.name);
    node.nameLabel.visible(true);

    if (tier === 'name') {
      node.sizeLabel.visible(false);
      this.centreLine(node.nameLabel, box, font, 0);
      return;
    }

    const small = sizeFont ?? labelSizeSmall;
    node.sizeLabel.fontSize(small);
    node.sizeLabel.visible(true);
    // Lift the name by half the second line so the pair is centred, not the
    // name alone.
    this.centreLine(node.nameLabel, box, font, -small / 2);
    this.centreLine(node.sizeLabel, box, small, font / 2);
  }

  /** Centre one line horizontally, offset from the piece's middle. */
  private centreLine(
    label: Konva.Text,
    box: { centreX: number; centreY: number },
    fontSize: number,
    offsetY: number,
  ): void {
    label.position({
      x: box.centreX - label.width() / 2,
      y: box.centreY - fontSize / 2 + offsetY,
    });
  }

  /**
   * Shorten a name until it fits, or give up.
   *
   * Fewer than two real characters is not a label — "C…" on a cuff tells you
   * less than the colour already did.
   */
  private truncate(
    label: Konva.Text,
    text: string,
    maxWidth: number,
    fontSize: number,
  ): string | null {
    label.fontSize(fontSize);
    for (let length = text.length - 1; length >= 2; length -= 1) {
      const candidate = `${text.slice(0, length)}…`;
      label.text(candidate);
      if (label.width() <= maxWidth) return candidate;
    }
    return null;
  }
}
