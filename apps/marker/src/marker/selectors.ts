/**
 * Pure read helpers over a MarkerDocument.
 *
 * Zero React, zero Zustand, zero side effects — input in, number out. Every
 * function here is unit-tested without a DOM.
 */

import { extentOf, orientedGeometry } from './pieceGeometry';
import type { MarkerDocument, Point } from './schema';

/** Enclosed area via the shoelace formula. Always positive. */
const polygonArea = (points: readonly Point[]): number => {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if (a && b) sum += (b.x + a.x) * (b.y - a.y);
  }
  return Math.abs(sum / 2);
};

/**
 * How far the marker extends along the fabric, in cm.
 *
 * Measured as `position.x + oriented bounding-box width`, which assumes piece
 * geometry is normalised to the origin — the guarantee TrayPiece already makes.
 */
export const markerLength = (doc: MarkerDocument): number =>
  doc.pieces.reduce(
    (longest, piece) =>
      Math.max(longest, piece.position.x + extentOf(orientedGeometry(piece)).width),
    0,
  );

/** Fabric consumed so far, in cm². */
export const markerArea = (doc: MarkerDocument): number => doc.fabricWidth * markerLength(doc);

/**
 * Total polygon area of every placed piece, in cm².
 *
 * Uses the untransformed geometry: rotation and reflection both preserve area,
 * so orienting first would cost time and change nothing.
 */
export const placedPieceArea = (doc: MarkerDocument): number =>
  doc.pieces.reduce((total, piece) => total + polygonArea(piece.geometry), 0);

/** Share of the marker rectangle covered by pieces, as a percentage. */
export const utilization = (doc: MarkerDocument): number => {
  const area = markerArea(doc);
  if (area <= 0) return 0;
  return (placedPieceArea(doc) / area) * 100;
};

/**
 * Complete bundles on the marker.
 *
 * A bundle counts only when every tray piece belonging to it has all of its
 * quantity placed — a bundle missing one sleeve is not a garment.
 */
export const garmentCount = (doc: MarkerDocument): number => {
  const completeByBundle = new Map<string, boolean>();
  for (const tray of doc.trayPieces) {
    const satisfied = tray.placed >= tray.quantity;
    completeByBundle.set(tray.bundle, (completeByBundle.get(tray.bundle) ?? true) && satisfied);
  }
  let complete = 0;
  for (const isComplete of completeByBundle.values()) {
    if (isComplete) complete += 1;
  }
  return complete;
};

/**
 * Fabric used per garment, in metres.
 *
 * Lengths are held in cm, so the /100 converts to the m/garment figure the
 * bottom ribbon reports and factories quote.
 */
export const consumption = (doc: MarkerDocument): number => {
  const garments = garmentCount(doc);
  if (garments <= 0) return 0;
  return (markerLength(doc) + doc.endAllowance) / 100 / garments;
};

export type MarkerStatus = 'MADE' | 'PARTIAL' | 'UNMADE';

/**
 * UNMADE is checked first so an empty document reads as UNMADE rather than
 * satisfying "every tray piece is placed" vacuously.
 */
export const markerStatus = (doc: MarkerDocument): MarkerStatus => {
  if (doc.pieces.length === 0) return 'UNMADE';
  const allPlaced = doc.trayPieces.every((tray) => tray.placed >= tray.quantity);
  return allPlaced ? 'MADE' : 'PARTIAL';
};
