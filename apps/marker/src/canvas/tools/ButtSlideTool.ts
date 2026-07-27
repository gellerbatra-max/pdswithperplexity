/**
 * Butt-slide: push a piece until it meets something.
 *
 * The marker maker's closing move — nudge a piece up against its neighbour so
 * no fabric is wasted between them. Doing that by dragging is fiddly at any
 * zoom, so `L` and `U` do it exactly.
 *
 * Pure: document and piece in, resting position out.
 */

import { boundsOf, bufferFor } from '@/canvas/collision/aabb';
import { orientedGeometry } from '@/marker/pieceGeometry';
import type { MarkerDocument, PlacedPiece, Point } from '@/marker/schema';
import { obstaclesFor, resolveDragPosition } from './DragTool';

export type SlideDirection = 'left' | 'up' | 'right' | 'down';

/** 0.1 mm. Finer than any cutter resolves, so the contact reads as exact. */
export const SLIDE_PRECISION_CM = 0.01;

/** Bisection halves the interval each pass; 24 covers metres at 0.1 mm. */
const MAX_BISECTIONS = 24;

/**
 * Step for the sweep that finds the first obstruction.
 *
 * Bisection alone is wrong here: a piece can be clear *beyond* an obstacle as
 * well as before it, so a straight bisect on "is this position clear" happily
 * tunnels through and reports the far side. Sweeping forward finds the first
 * blocked step, and only then is the bracket monotonic enough to bisect.
 *
 * 2.5 mm is finer than any piece or defect zone a marker contains; anything
 * thinner than this could be stepped over.
 */
const SWEEP_STEP_CM = 0.25;

const VECTORS: Record<SlideDirection, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
};

/**
 * The furthest the piece could travel before leaving the fabric.
 *
 * Bisection needs a bounded interval, and the fabric edge is the only bound
 * that always exists — a piece with nothing in its way slides until it hits it.
 */
const travelLimit = (
  document: MarkerDocument,
  piece: PlacedPiece,
  direction: SlideDirection,
): number => {
  const bounds = boundsOf(orientedGeometry(piece));
  switch (direction) {
    case 'left':
      return Math.max(0, piece.position.x + bounds.minX);
    case 'right':
      // No far edge exists — marker length is derived from where pieces sit —
      // so cap the search at one fabric width of travel.
      return document.fabricWidth;
    case 'up':
      return Math.max(0, document.fabricWidth - (piece.position.y + bounds.maxY));
    case 'down':
      return Math.max(0, piece.position.y + bounds.minY);
  }
};

/**
 * Where the piece comes to rest.
 *
 * Sweep forward to bracket the first obstruction, then bisect that bracket to
 * 0.1 mm. The sweep is what stops the piece appearing on the far side of
 * something it should have stopped against — clearance is not monotonic along
 * the path, so bisecting the whole interval would tunnel straight through.
 */
export const buttSlide = (
  document: MarkerDocument,
  piece: PlacedPiece,
  direction: SlideDirection,
): Point => {
  const vector = VECTORS[direction];
  const limit = travelLimit(document, piece, direction);
  if (limit <= SLIDE_PRECISION_CM) return piece.position;

  const at = (distance: number): Point => ({
    x: piece.position.x + vector.x * distance,
    y: piece.position.y + vector.y * distance,
  });

  // resolveDragPosition returns the nearest legal position; if it hands back
  // what it was given, that position was already clear.
  const isClear = (distance: number): boolean => {
    const wanted = at(distance);
    const resolved = resolveDragPosition(document, piece, wanted);
    return (
      Math.abs(resolved.x - wanted.x) <= SLIDE_PRECISION_CM / 2 &&
      Math.abs(resolved.y - wanted.y) <= SLIDE_PRECISION_CM / 2
    );
  };

  let clear = 0;
  let blocked = -1;

  for (let distance = SWEEP_STEP_CM; distance <= limit; distance += SWEEP_STEP_CM) {
    if (isClear(distance)) {
      clear = distance;
      continue;
    }
    blocked = distance;
    break;
  }

  // Swept the whole way without meeting anything: rest against the fabric edge.
  if (blocked < 0) return isClear(limit) ? at(limit) : at(clear);

  for (let pass = 0; pass < MAX_BISECTIONS && blocked - clear > SLIDE_PRECISION_CM; pass += 1) {
    const middle = (clear + blocked) / 2;
    if (isClear(middle)) clear = middle;
    else blocked = middle;
  }

  return at(clear);
};

/** True when this piece has anywhere to go — used to skip pointless work. */
export const canSlide = (
  document: MarkerDocument,
  piece: PlacedPiece,
  direction: SlideDirection,
): boolean => travelLimit(document, piece, direction) > SLIDE_PRECISION_CM;

/** Buffer this piece holds, exported so the UI can explain the resting gap. */
export const slideGap = (document: MarkerDocument, piece: PlacedPiece): number =>
  bufferFor(piece.bufferOverride, document.cutterBuffer);

export const obstacleCount = (document: MarkerDocument, piece: PlacedPiece): number =>
  obstaclesFor(document, piece.id).length;
