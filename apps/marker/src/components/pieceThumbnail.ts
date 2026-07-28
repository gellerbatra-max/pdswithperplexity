/**
 * A small canvas showing a piece's actual outline.
 *
 * Used as the drag image when a tray row is dragged onto the marker. The
 * browser's default drag image is a translucent copy of the row, which tells
 * you what you grabbed but nothing about the shape you are about to place —
 * and shape is the whole question when you are choosing where it goes.
 */

import type { Point } from '@/marker/schema';

/** Drawn at device resolution so the ghost is not soft on a retina screen. */
const PADDING_PX = 4;

export interface ThumbnailColours {
  readonly fill: string;
  readonly line: string;
}

/**
 * Fit the outline into a box of `size`, preserving its proportions.
 *
 * Returns null for a degenerate outline rather than an empty canvas, so the
 * caller can fall back to the browser's default drag image.
 */
export const pieceThumbnail = (
  geometry: readonly Point[],
  colours: ThumbnailColours,
  size: number,
): HTMLCanvasElement | null => {
  if (geometry.length < 3) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of geometry) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const width = maxX - minX;
  const height = maxY - minY;
  if (width <= 0 || height <= 0) return null;

  const ratio = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = size * ratio;
  canvas.height = size * ratio;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;

  const context = canvas.getContext('2d');
  if (!context) return null;
  context.scale(ratio, ratio);

  const usable = size - PADDING_PX * 2;
  const scale = Math.min(usable / width, usable / height);
  const offsetX = (size - width * scale) / 2;
  const offsetY = (size - height * scale) / 2;

  context.beginPath();
  geometry.forEach((point, index) => {
    const x = offsetX + (point.x - minX) * scale;
    // Marker Y runs up, canvas Y runs down.
    const y = size - offsetY - (point.y - minY) * scale;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.closePath();

  context.fillStyle = colours.fill;
  context.fill();
  context.strokeStyle = colours.line;
  context.lineWidth = 1.5;
  context.stroke();

  return canvas;
};
