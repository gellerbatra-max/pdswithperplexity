import type { Bounds, Rect, Vec2 } from './types';

export const EMPTY_BOUNDS: Bounds = {
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
};

export const isEmpty = (b: Bounds): boolean => b.minX > b.maxX || b.minY > b.maxY;

export const includePoint = (b: Bounds, p: Vec2): Bounds => ({
  minX: Math.min(b.minX, p.x),
  minY: Math.min(b.minY, p.y),
  maxX: Math.max(b.maxX, p.x),
  maxY: Math.max(b.maxY, p.y),
});

export const union = (a: Bounds, b: Bounds): Bounds => ({
  minX: Math.min(a.minX, b.minX),
  minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX),
  maxY: Math.max(a.maxY, b.maxY),
});

export const fromPoints = (points: readonly Vec2[]): Bounds =>
  points.reduce(includePoint, EMPTY_BOUNDS);

export const expand = (b: Bounds, margin: number): Bounds => ({
  minX: b.minX - margin,
  minY: b.minY - margin,
  maxX: b.maxX + margin,
  maxY: b.maxY + margin,
});

export const toRect = (b: Bounds): Rect => ({
  x: b.minX,
  y: b.minY,
  width: b.maxX - b.minX,
  height: b.maxY - b.minY,
});

export const center = (b: Bounds): Vec2 => ({
  x: (b.minX + b.maxX) / 2,
  y: (b.minY + b.maxY) / 2,
});
