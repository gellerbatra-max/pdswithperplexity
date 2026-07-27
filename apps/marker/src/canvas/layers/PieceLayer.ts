import Konva from 'konva';
import { orientedGeometry } from '@/marker/pieceGeometry';
import type { MarkerDocument, PlacedPiece, Point } from '@/marker/schema';
import { boundsOf } from '../collision/aabb';
import type { DragTool } from '../tools/DragTool';
import type { MarkerTransform } from '../types';

/**
 * One Konva.Group per placed piece: the polygon plus its label.
 *
 * Groups are positioned in stage space and hold their points in local pixels,
 * so panning only moves each group — the points are rebuilt on zoom or when
 * the piece's own shape changes, not on every frame.
 */

const PIECE_FILL = '#dbeafe';
const PIECE_STROKE = '#2563eb';
const LABEL_FILL = '#1e3a8a';
const LABEL_FONT_SIZE = 11;

/** Below this a label is unreadable and only costs text shaping. */
const MIN_LABEL_SCALE = 0.6;

export interface PieceLayerInput {
  readonly document: MarkerDocument;
  readonly transform: MarkerTransform;
  readonly stageWidth: number;
  readonly stageHeight: number;
}

interface PieceNode {
  readonly group: Konva.Group;
  readonly polygon: Konva.Line;
  readonly label: Konva.Text;
  /** What the local points were built from, so we know when to rebuild. */
  geometry: Point[];
  rotation: number;
  flipped: boolean;
  scale: number;
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

  /** Set once, before the first update. */
  setDragTool(dragTool: DragTool): void {
    this.dragTool = dragTool;
  }

  update(input: PieceLayerInput): void {
    const present = new Set<string>();

    for (const piece of input.document.pieces) {
      present.add(piece.id);
      const node = this.nodes.get(piece.id) ?? this.createNode(piece);
      this.syncNode(node, piece, input);
    }

    for (const [id, node] of this.nodes) {
      if (present.has(id)) continue;
      node.group.destroy();
      this.nodes.delete(id);
    }

    this.layer.batchDraw();
  }

  destroy(): void {
    this.nodes.clear();
    this.layer.destroy();
  }

  private createNode(piece: PlacedPiece): PieceNode {
    const group = new Konva.Group({ name: piece.id });

    const polygon = new Konva.Line({
      closed: true,
      fill: PIECE_FILL,
      stroke: PIECE_STROKE,
      strokeWidth: 1,
      shadowForStrokeEnabled: false,
      perfectDrawEnabled: false,
    });

    const label = new Konva.Text({
      fontSize: LABEL_FONT_SIZE,
      fontFamily: 'system-ui, sans-serif',
      fill: LABEL_FILL,
      listening: false,
      perfectDrawEnabled: false,
    });

    group.add(polygon, label);
    this.layer.add(group);
    this.dragTool?.attach(group, piece.id);

    const node: PieceNode = {
      group,
      polygon,
      label,
      geometry: [],
      rotation: Number.NaN,
      flipped: false,
      scale: Number.NaN,
      localMinX: 0,
      localMinY: 0,
      localMaxX: 0,
      localMaxY: 0,
      cached: false,
    };
    this.nodes.set(piece.id, node);
    return node;
  }

  private syncNode(node: PieceNode, piece: PlacedPiece, input: PieceLayerInput): void {
    const { transform, stageWidth, stageHeight } = input;

    // Geometry is compared by reference: the store replaces the array only when
    // the outline itself changes, so a drag never triggers a rebuild.
    const stale =
      node.geometry !== piece.geometry ||
      node.rotation !== piece.rotation ||
      node.flipped !== piece.flipped ||
      node.scale !== transform.scale;

    if (stale) this.rebuild(node, piece, transform);

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

    // Cache once visible. Konva cannot cache a zero-area node, which is what a
    // degenerate piece would be.
    if (!node.cached && node.localMaxX > node.localMinX && node.localMaxY > node.localMinY) {
      node.group.cache();
      node.cached = true;
    }
  }

  private rebuild(node: PieceNode, piece: PlacedPiece, transform: MarkerTransform): void {
    const oriented = orientedGeometry(piece);
    const { scale } = transform;

    const points: number[] = [];
    for (const point of oriented) {
      // Marker Y runs up, stage Y runs down.
      points.push(point.x * scale, -point.y * scale);
    }
    node.polygon.points(points);

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

    const readable = scale >= MIN_LABEL_SCALE;
    node.label.visible(readable);
    if (readable) {
      node.label.text(`${piece.name} ${piece.size}`.trim());
      node.label.position({
        x: (node.localMinX + node.localMaxX) / 2 - node.label.width() / 2,
        y: (node.localMinY + node.localMaxY) / 2 - LABEL_FONT_SIZE / 2,
      });
    }

    node.geometry = piece.geometry;
    node.rotation = piece.rotation;
    node.flipped = piece.flipped;
    node.scale = scale;

    if (node.cached) {
      node.group.clearCache();
      node.cached = false;
    }
  }
}
