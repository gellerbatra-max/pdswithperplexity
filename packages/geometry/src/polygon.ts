import type { Vec2 } from './types';

/** Perimeter of a polyline; pass `closed` to include the closing segment. */
export const perimeter = (points: readonly Vec2[], closed: boolean): number => {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a && b) total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  if (closed && points.length > 2) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first && last) total += Math.hypot(first.x - last.x, first.y - last.y);
  }
  return total;
};

/** Enclosed area via the shoelace formula. Always positive. */
export const area = (points: readonly Vec2[]): number => {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a && b) sum += (b.x + a.x) * (b.y - a.y);
  }
  return Math.abs(sum / 2);
};
