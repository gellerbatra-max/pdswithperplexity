/**
 * HPGL `.plt` cut data.
 *
 * One plotter unit is 0.025 mm, so 1 cm is 400 plu. That constant is the whole
 * file: get it wrong and the cutter produces a marker to scale, just the wrong
 * scale, which nobody notices until the fabric is cut.
 *
 * Marker space and HPGL agree on orientation — both put the origin bottom-left
 * with Y increasing upward — so coordinates map straight across.
 *
 * Pure: document in, text out.
 */

import { placedGeometry } from '@/marker/pieceGeometry';
import type { MarkerDocument, PlacedPiece } from '@/marker/schema';

/** 1 plu = 0.025 mm = 0.0025 cm, so a centimetre is 400 units. */
export const PLOTTER_UNITS_PER_CM = 400;

export const toPlotterUnits = (cm: number): number => Math.round(cm * PLOTTER_UNITS_PER_CM);

export interface HpglOptions {
  /**
   * Emit pieces in cutSequence order where it is set.
   *
   * A cutter follows the file top to bottom, so the order in the file *is* the
   * knife path. Pieces without a sequence keep their document order behind the
   * ones that have it.
   */
  readonly respectCutSequence?: boolean;
}

const orderPieces = (doc: MarkerDocument, respect: boolean): PlacedPiece[] => {
  if (!respect) return [...doc.pieces];
  return [...doc.pieces].sort((a, b) => {
    const left = a.cutSequence ?? Number.POSITIVE_INFINITY;
    const right = b.cutSequence ?? Number.POSITIVE_INFINITY;
    return left - right;
  });
};

export const exportMarkerHpgl = (doc: MarkerDocument, options: HpglOptions = {}): string => {
  const commands: string[] = [
    // Initialise, then select the knife.
    'IN;',
    'SP1;',
  ];

  for (const piece of orderPieces(doc, options.respectCutSequence ?? true)) {
    const outline = placedGeometry(piece);
    if (outline.length < 3) continue;

    const [first, ...rest] = outline;
    if (!first) continue;

    // Travel to the start with the knife up, then cut the whole outline in one
    // pen-down run and close it by returning to the first point.
    commands.push(`PU${toPlotterUnits(first.x)},${toPlotterUnits(first.y)};`);
    const path = [...rest, first]
      .map((point) => `${toPlotterUnits(point.x)},${toPlotterUnits(point.y)}`)
      .join(',');
    commands.push(`PD${path};`);
  }

  // Knife up and parked, or it drags across the spread on the way home.
  commands.push('PU;', 'SP0;');
  return `${commands.join('\n')}\n`;
};

export const HPGL_FILE_EXTENSION = '.plt';
export const HPGL_MIME_TYPE = 'application/vnd.hp-hpgl';
