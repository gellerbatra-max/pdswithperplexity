/**
 * A miniature of a whole marker, for the home screen cards.
 *
 * Drawn from the document rather than stored, so it can never disagree with
 * the marker it claims to show. Cheap enough to redraw: a card is a few
 * hundred polygons at most, and only the visible cards are ever rendered.
 */

import { bundleSlots } from '@/marker/bundles';
import { orientedGeometry } from '@/marker/pieceGeometry';
import { markerLength } from '@/marker/selectors';
import type { MarkerDocument } from '@/marker/schema';

/** Fabric shown for an empty marker, matching the canvas. */
const MIN_LENGTH_CM = 100;
const PADDING_PX = 6;

export interface ThumbnailTokens {
  readonly fabric: string;
  readonly edge: string;
  /** Eight [fill, line] pairs, in slot order. */
  readonly bundles: readonly (readonly [string, string])[];
}

/** Read the tokens once per render pass rather than once per card. */
export const readThumbnailTokens = (): ThumbnailTokens => {
  const style = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback;

  const bundles: (readonly [string, string])[] = [];
  for (let index = 1; index <= 8; index += 1) {
    bundles.push([
      token(`--bundle-${index}-fill`, '#dbeafe'),
      token(`--bundle-${index}-line`, '#2563eb'),
    ]);
  }

  return {
    fabric: token('--fabric-bg', '#f4f4f5'),
    edge: token('--fabric-edge', '#d4d4d8'),
    bundles,
  };
};

/**
 * Render the marker into `canvas`, fitting the fabric to the available box.
 *
 * The fabric is always drawn, so an empty marker shows an empty roll rather
 * than a blank card that looks like a loading failure.
 */
export const drawMarkerThumbnail = (
  canvas: HTMLCanvasElement,
  marker: MarkerDocument,
  tokens: ThumbnailTokens,
): void => {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 240;
  const height = canvas.clientHeight || 90;

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);

  const context = canvas.getContext('2d');
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const lengthCm = Math.max(markerLength(marker), MIN_LENGTH_CM);
  const widthCm = Math.max(marker.fabricWidth, 1);

  const usableW = width - PADDING_PX * 2;
  const usableH = height - PADDING_PX * 2;
  const scale = Math.min(usableW / lengthCm, usableH / widthCm);

  const fabricW = lengthCm * scale;
  const fabricH = widthCm * scale;
  const originX = (width - fabricW) / 2;
  // Marker Y runs up; this is the stage-space top edge of the fabric.
  const originY = (height - fabricH) / 2;

  context.fillStyle = tokens.fabric;
  context.strokeStyle = tokens.edge;
  context.lineWidth = 1;
  context.fillRect(originX, originY, fabricW, fabricH);
  context.strokeRect(originX + 0.5, originY + 0.5, fabricW - 1, fabricH - 1);

  const slots = bundleSlots(marker);

  for (const piece of marker.pieces) {
    const outline = orientedGeometry(piece);
    if (outline.length < 3) continue;

    const slot = slots.get(piece.bundle) ?? 0;
    const [fill, line] = tokens.bundles[slot % tokens.bundles.length] ?? ['#dbeafe', '#2563eb'];

    context.beginPath();
    outline.forEach((point, index) => {
      const x = originX + (piece.position.x + point.x) * scale;
      const y = originY + fabricH - (piece.position.y + point.y) * scale;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.closePath();

    context.fillStyle = fill;
    context.fill();
    // Hairline only: at this size a heavier stroke swallows small pieces.
    context.strokeStyle = line;
    context.lineWidth = 0.5;
    context.stroke();
  }
};
