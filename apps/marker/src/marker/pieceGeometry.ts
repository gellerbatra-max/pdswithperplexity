/**
 * The canonical piece transform, in one place.
 *
 * Flip, then rotate counter-clockwise, then translate. Rendering, collision
 * and nesting all read from here — when they disagree, a piece draws somewhere
 * other than where it collides, and the symptom looks like a collision bug.
 *
 * Pure: no React, no Zustand, no side effects.
 */

import type { PlacedPiece, Point } from './schema';

const DEG_TO_RAD = Math.PI / 180;

/** Flip and rotation applied, translation not yet — the piece about its own origin. */
export const orientedGeometry = (piece: PlacedPiece): Point[] => {
  const radians = piece.rotation * DEG_TO_RAD;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return piece.geometry.map((point) => {
    const x = piece.flipped ? -point.x : point.x;
    const y = point.y;
    return { x: x * cos - y * sin, y: x * sin + y * cos };
  });
};

/** The piece where it actually sits in marker space. */
export const placedGeometry = (piece: PlacedPiece): Point[] =>
  translate(orientedGeometry(piece), piece.position);

export const translate = (points: readonly Point[], offset: Point): Point[] =>
  points.map((point) => ({ x: point.x + offset.x, y: point.y + offset.y }));

export interface Extent {
  readonly width: number;
  readonly height: number;
}

const EMPTY_EXTENT: Extent = { width: 0, height: 0 };

export const extentOf = (points: readonly Point[]): Extent => {
  if (points.length === 0) return EMPTY_EXTENT;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { width: maxX - minX, height: maxY - minY };
};
