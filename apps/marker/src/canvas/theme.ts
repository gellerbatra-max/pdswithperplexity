/**
 * Bridging the design tokens into Konva.
 *
 * Canvas drawing takes literal colour strings — it cannot resolve a CSS custom
 * property. Without this, canvas colours would be hard-coded and drift away
 * from the stylesheet the moment either changes, which is exactly the problem
 * a design system exists to prevent.
 *
 * Read once at canvas construction: the tokens are static for the session, and
 * re-reading per frame would put a layout query in the draw loop.
 */

/** The eight categorical bundle hues, each in its three surface roles. */
export interface BundleColours {
  readonly line: string;
  readonly fill: string;
  readonly chip: string;
}

export interface MarkerPalette {
  readonly bundles: readonly BundleColours[];
  readonly pieceLine: string;
  readonly pieceFill: string;
  readonly pieceLabel: string;
  readonly selectedLine: string;
  readonly selectedWidth: number;
  readonly violationLine: string;
  readonly violationFill: string;
  readonly violationDash: number[];
  readonly fabricBg: string;
  readonly fabricEdge: string;
  readonly fabricGuide: string;
  readonly rulerTick: string;
  readonly labelSize: number;
  readonly labelSizeSmall: number;
  readonly fontUi: string;
}

export const BUNDLE_COLOUR_COUNT = 8;

const px = (raw: string, fallback: number): number => {
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const dashes = (raw: string, fallback: number[]): number[] => {
  const parts = raw
    .split(/\s+/)
    .map((part) => Number.parseFloat(part))
    .filter((value) => Number.isFinite(value));
  return parts.length > 0 ? parts : fallback;
};

/**
 * Snapshot the tokens as Konva-ready values.
 *
 * Every lookup carries a fallback so a missing token degrades to something
 * visible rather than to Konva's default of "no stroke at all", which would
 * look like a rendering bug rather than a missing variable.
 */
export const readPalette = (element: HTMLElement = document.documentElement): MarkerPalette => {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string): string => {
    const value = style.getPropertyValue(name).trim();
    return value === '' ? fallback : value;
  };

  const bundles: BundleColours[] = [];
  for (let index = 1; index <= BUNDLE_COLOUR_COUNT; index += 1) {
    bundles.push({
      line: token(`--bundle-${index}-line`, '#2563eb'),
      fill: token(`--bundle-${index}-fill`, '#dbeafe'),
      chip: token(`--bundle-${index}-chip`, '#6da3d4'),
    });
  }

  return {
    bundles,
    pieceLine: token('--piece-line', '#2563eb'),
    pieceFill: token('--piece-fill', '#dbeafe'),
    pieceLabel: token('--piece-label', '#1e3a8a'),
    selectedLine: token('--selected-line', '#f59e0b'),
    selectedWidth: px(token('--selected-width', '2px'), 2),
    violationLine: token('--violation-line', '#e5484d'),
    violationFill: token('--violation-fill', 'rgba(229, 72, 77, 0.14)'),
    violationDash: dashes(token('--violation-dash', '6px 4px'), [6, 4]),
    fabricBg: token('--fabric-bg', '#f4f4f5'),
    fabricEdge: token('--fabric-edge', '#d4d4d8'),
    fabricGuide: token('--fabric-guide', '#a1a1aa'),
    rulerTick: token('--ruler-tick', '#a1a1aa'),
    labelSize: px(token('--text-xs', '11px'), 11),
    labelSizeSmall: px(token('--text-2xs', '10px'), 10),
    fontUi: token('--font-ui', 'system-ui, sans-serif'),
  };
};
