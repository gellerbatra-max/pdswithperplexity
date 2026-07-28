import Konva from 'konva';
import { bundleSlots } from '@/marker/bundles';
import { orientedGeometry } from '@/marker/pieceGeometry';
import type { LayDirection, MarkerDocument, PlacedPiece, Point } from '@/marker/schema';
import { findViolations } from '@/marker/violations';
import { boundsOf } from '../collision/aabb';
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
   * Name over size, both centred on the piece.
   *
   * Text is not rotated with the piece: a marker is read at a glance across a
   * whole spread, and labels that follow their piece end up upside down.
   */
  private buildLabels(
    node: PieceNode,
    piece: PlacedPiece,
    box: { centreX: number; centreY: number; width: number; height: number; scale: number },
  ): void {
    const readable = box.scale >= MIN_LABEL_SCALE;
    node.nameLabel.visible(readable);
    node.sizeLabel.visible(readable && piece.size !== '');
    if (!readable) return;

    const { labelSize, labelSizeSmall } = this.palette;
    const stacked = piece.size !== '';

    node.nameLabel.fontSize(labelSize);
    node.nameLabel.text(piece.name);
    node.nameLabel.position({
      x: box.centreX - node.nameLabel.width() / 2,
      // Lift the name by half a line when a size sits under it, so the pair
      // is centred rather than the name alone.
      y: box.centreY - labelSize / 2 - (stacked ? labelSizeSmall / 2 : 0),
    });

    if (!stacked) return;
    node.sizeLabel.fontSize(labelSizeSmall);
    node.sizeLabel.text(piece.size);
    node.sizeLabel.position({
      x: box.centreX - node.sizeLabel.width() / 2,
      y: box.centreY + labelSize / 2 - labelSizeSmall / 2,
    });
  }
}
