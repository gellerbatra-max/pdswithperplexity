import type Konva from 'konva';
import { orientedGeometry, translate } from '@/marker/pieceGeometry';
import type { MarkerDocument, PlacedPiece, Point } from '@/marker/schema';
import { boundsOf, bufferFor, expand, overlaps, type Bounds } from '../collision/aabb';
import { convexPartsOf } from '../collision/convexParts';
import { orientPoints } from '../collision/orient';
import { satCollision } from '../collision/sat';
import type { MarkerTransform } from '../types';

/**
 * Drag with collision bounce-back.
 *
 * The resolution half is pure and lives below as `resolveDragPosition`; the
 * class is only Konva plumbing. That split is what makes the hard part —
 * where a piece ends up when it is pushed into a corner — testable without a
 * DOM.
 */

/**
 * Resolving one collision can push a piece into another. Each pass fixes the
 * worst overlap and re-checks; the cap stops a piece wedged between two
 * obstacles from spinning. Eight is well beyond what a normal drag needs.
 */
const MAX_RESOLUTION_PASSES = 8;

export interface Obstacle {
  /**
   * Convex parts, not the outline. SAT is only sound on convex polygons, and
   * a concave piece tested whole reports collisions across its own hollow.
   */
  readonly parts: Point[][];
  /** Over the whole outline, for the broad phase. */
  readonly bounds: Bounds;
}

const rectangle = (x: number, y: number, width: number, height: number): Point[] => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

const toObstacle = (parts: Point[][]): Obstacle => ({
  parts,
  bounds: boundsOf(parts.flat()),
});

/**
 * The solid things a dragged piece must not overlap: other placed pieces and
 * defect zones.
 *
 * The fabric boundary and splice lines are deliberately absent — both are
 * constraints rather than obstacles, and SAT handles them badly. A surrounding
 * box would push pieces inward from whichever edge overlapped least, and a
 * splice line is thinner than any piece, so its minimum translation vector is
 * its own width: pushing by it leaves the piece still straddling the line.
 * Both are applied by `constrain` instead.
 */
export const obstaclesFor = (document: MarkerDocument, excludePieceId: string): Obstacle[] => {
  const obstacles: Obstacle[] = [];

  for (const piece of document.pieces) {
    if (piece.id === excludePieceId) continue;
    const parts = convexPartsOf(piece.geometry).map((part) =>
      translate(orientPoints(part, piece), piece.position),
    );
    obstacles.push(toObstacle(parts));
  }

  for (const zone of document.defectZones) {
    // Already convex.
    obstacles.push(toObstacle([rectangle(zone.x, zone.y, zone.width, zone.height)]));
  }

  return obstacles;
};

/**
 * Keep the piece on the fabric.
 *
 * Only the near edges are bounded: y is held inside the fabric width and x is
 * held at or above zero. There is deliberately no upper x bound — marker
 * length is derived from where pieces sit, so clamping to it would stop the
 * marker ever growing.
 */
const clampToFabric = (orientedBounds: Bounds, position: Point, fabricWidth: number): Point => {
  let { y } = position;
  if (y + orientedBounds.maxY > fabricWidth) y = fabricWidth - orientedBounds.maxY;
  // Applied second so a piece taller than the fabric rests on the lower edge
  // rather than floating off the top.
  if (y + orientedBounds.minY < 0) y = -orientedBounds.minY;

  const x = Math.max(position.x, -orientedBounds.minX);
  // Negating a zero bound yields -0, which would travel into the stored
  // document and compare unequal to 0 under Object.is.
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
};

/**
 * A splice line is where the spread will be cut, so no piece may straddle it.
 *
 * Modelled as a constraint rather than a thin obstacle: a piece wider than the
 * line contains it, and SAT's minimum translation for a contained obstacle is
 * the obstacle's own width — pushing by that leaves the piece still across the
 * line, however many passes you run.
 */
const clampToSplices = (
  orientedBounds: Bounds,
  position: Point,
  spliceLines: readonly { x: number }[],
): Point => {
  let { x } = position;
  for (const splice of spliceLines) {
    const left = x + orientedBounds.minX;
    const right = x + orientedBounds.maxX;
    if (left >= splice.x || right <= splice.x) continue;

    // Straddling — move to whichever side is the shorter trip.
    const toLeftSide = splice.x - right;
    const toRightSide = splice.x - left;
    x += Math.abs(toLeftSide) <= Math.abs(toRightSide) ? toLeftSide : toRightSide;
  }
  return { x: x === 0 ? 0 : x, y: position.y };
};

/** Every positional rule that is a constraint rather than a solid body. */
const constrain = (
  orientedBounds: Bounds,
  position: Point,
  document: MarkerDocument,
): Point =>
  clampToSplices(
    orientedBounds,
    clampToFabric(orientedBounds, position, document.fabricWidth),
    document.spliceLines,
  );

/**
 * The worst overlap between any mover part and any obstacle part.
 *
 * Deepest rather than first: with a concave piece straddling two parts of an
 * obstacle, clearing the shallower one first can leave the piece wedged and
 * burn a resolution pass for nothing.
 */
const deepestOverlap = (
  moverParts: readonly Point[][],
  position: Point,
  obstacle: Obstacle,
): Point | null => {
  let deepest: Point | null = null;
  let deepestDepth = 0;

  for (const part of moverParts) {
    const moved = translate(part, position);
    for (const obstaclePart of obstacle.parts) {
      const result = satCollision(moved, obstaclePart);
      if (!result.collides || !result.mtv) continue;
      const depth = Math.hypot(result.mtv.x, result.mtv.y);
      if (depth > deepestDepth) {
        deepestDepth = depth;
        deepest = result.mtv;
      }
    }
  }

  return deepest;
};

/**
 * Where a dragged piece actually lands.
 *
 * Takes the position the pointer asked for and returns the nearest legal one:
 * inside the fabric, and clear of every obstacle by the cutter buffer.
 */
export const resolveDragPosition = (
  document: MarkerDocument,
  piece: PlacedPiece,
  proposed: Point,
): Point => {
  const oriented = orientedGeometry(piece);
  if (oriented.length === 0) return proposed;

  const orientedBounds = boundsOf(oriented);
  const buffer = bufferFor(piece.bufferOverride, document.cutterBuffer);
  const obstacles = obstaclesFor(document, piece.id);

  // Split and orient once: rotation cannot change mid-drag, so only the
  // translation is recomputed per pass.
  const moverParts = convexPartsOf(piece.geometry).map((part) => orientPoints(part, piece));

  let position = constrain(orientedBounds, proposed, document);

  for (let pass = 0; pass < MAX_RESOLUTION_PASSES; pass += 1) {
    const searchBounds = expand(boundsOf(translate(oriented, position)), buffer);

    let pushed = false;
    for (const obstacle of obstacles) {
      if (!overlaps(searchBounds, obstacle.bounds)) continue;

      const hit = deepestOverlap(moverParts, position, obstacle);
      if (!hit) continue;

      const depth = Math.hypot(hit.x, hit.y);
      if (depth === 0) continue;

      // Push clear of the overlap, then the buffer further along the same
      // axis. Offsetting the polygon itself would be exact, but that needs a
      // real inset/outset and this is a drag loop.
      const scale = (depth + buffer) / depth;
      position = { x: position.x + hit.x * scale, y: position.y + hit.y * scale };
      pushed = true;
      break;
    }

    if (!pushed) break;
    position = constrain(orientedBounds, position, document);
  }

  return position;
};

export interface DragToolContext {
  readonly document: MarkerDocument;
  readonly transform: MarkerTransform;
}

export interface DragToolCallbacks {
  /** Read at drag time, so the tool always sees the current document. */
  readonly getContext: () => DragToolContext | null;
  readonly onCommit: (pieceId: string, position: Point) => void;
  /** Additive when the shift key is held, matching the shortcut table. */
  readonly onSelect: (pieceId: string, additive: boolean) => void;
}

export class DragTool {
  constructor(private readonly callbacks: DragToolCallbacks) {}

  /** Make a piece group draggable and route its events through collision. */
  attach(group: Konva.Group, pieceId: string): void {
    group.draggable(true);

    group.on('mousedown touchstart', (event) => {
      this.callbacks.onSelect(pieceId, event.evt.shiftKey === true);
    });

    // A cached group cannot repaint while it moves.
    group.on('dragstart', () => group.clearCache());

    group.on('dragmove', () => {
      const resolved = this.resolve(group, pieceId);
      if (!resolved) return;
      // Snap straight to the legal position — no tween. A drag that eases into
      // place reads as lag on a 200-piece marker.
      group.position(resolved.stage);
    });

    group.on('dragend', () => {
      const resolved = this.resolve(group, pieceId);
      if (resolved) {
        group.position(resolved.stage);
        this.callbacks.onCommit(pieceId, resolved.marker);
      }
      group.cache();
    });
  }

  private resolve(
    group: Konva.Group,
    pieceId: string,
  ): { marker: Point; stage: Point } | null {
    const context = this.callbacks.getContext();
    if (!context) return null;

    const piece = context.document.pieces.find((candidate) => candidate.id === pieceId);
    if (!piece) return null;

    const { transform } = context;
    const proposed = {
      x: transform.toMarkerX(group.x()),
      y: transform.toMarkerY(group.y()),
    };
    const marker = resolveDragPosition(context.document, piece, proposed);
    return { marker, stage: { x: transform.x(marker.x), y: transform.y(marker.y) } };
  }
}
