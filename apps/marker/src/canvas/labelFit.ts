/**
 * Deciding how much of a piece label will actually fit on the piece.
 *
 * A 22 x 10 cm cuff and a 50 x 68 cm back cannot carry the same label. Sizing
 * a label by zoom alone puts "Cuff right" straight across its neighbours, so
 * the label has to be measured against the piece it belongs to.
 *
 * Pure: measurements in, a decision out. The measuring itself needs a canvas
 * and stays in PieceLayer.
 */

/** Gap kept between the text and the piece outline, in px. */
export const LABEL_PADDING_PX = 3;

/** Below this the text is decoration, not information. */
export const MIN_LABEL_FONT_PX = 8;

/** What a piece is willing to show. */
export type LabelTier = 'full' | 'name' | 'truncated' | 'none';

export interface LabelSpace {
  /** Piece bounding box in px. */
  readonly width: number;
  readonly height: number;
}

/** Room for text once the padding is taken off both sides. */
export const usableSpace = (space: LabelSpace): LabelSpace => ({
  width: space.width - LABEL_PADDING_PX * 2,
  height: space.height - LABEL_PADDING_PX * 2,
});

/**
 * Largest font from `preferred` down that renders `naturalWidth` inside
 * `maxWidth`, or null if even the smallest will not fit.
 *
 * Text width scales linearly with font size, so one measurement at a known
 * size gives the whole curve — no need to measure repeatedly.
 */
export const fitFontSize = (
  naturalWidth: number,
  naturalFontSize: number,
  maxWidth: number,
  minFontSize = MIN_LABEL_FONT_PX,
): number | null => {
  if (naturalWidth <= 0 || naturalFontSize <= 0 || maxWidth <= 0) return null;
  if (naturalWidth <= maxWidth) return naturalFontSize;

  const scaled = Math.floor((maxWidth / naturalWidth) * naturalFontSize);
  return scaled >= minFontSize ? scaled : null;
};

/**
 * Which tier a piece can carry.
 *
 * Two lines need the height for both plus the padding; one line needs the
 * height for itself. A name that will not fit even shrunk is truncated, and a
 * piece with room for neither shows nothing — the grain line and the bundle
 * colour still identify it, and an unreadable smear over three neighbours
 * identifies nothing.
 */
export const chooseTier = (input: {
  readonly space: LabelSpace;
  readonly nameFits: boolean;
  readonly sizeFits: boolean;
  readonly hasSize: boolean;
  readonly nameFontSize: number;
  readonly sizeFontSize: number;
  readonly truncatable: boolean;
}): LabelTier => {
  const usable = usableSpace(input.space);
  if (usable.width <= 0 || usable.height < MIN_LABEL_FONT_PX) return 'none';

  const roomForTwo = usable.height >= input.nameFontSize + input.sizeFontSize;
  if (input.nameFits && input.hasSize && input.sizeFits && roomForTwo) return 'full';
  if (input.nameFits) return 'name';
  return input.truncatable ? 'truncated' : 'none';
};
