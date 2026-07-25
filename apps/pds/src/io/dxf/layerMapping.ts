import type { DxfFlavour } from './types';

/**
 * Layer mapping — the heart of apparel DXF.
 *
 * AAMA/ASTM files carry pattern *meaning* in the layer number, not the entity
 * type: a polyline on layer 1 is a piece boundary, the same polyline on layer 11
 * is an internal line. Import and export therefore both reduce to translating
 * between our domain concepts and these numbers, which is why the table lives in
 * one place that both halves import.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IMPORTANT — the numbers below are PROVISIONAL.
 *
 * They reflect widely used industry practice, but they have not been checked
 * against the ASTM D6673 text, and vendors differ in the optional ranges.
 * Before any real implementation lands, every entry must be verified against
 * the standard and against sample files exported by AccuMark, Optitex and
 * Lectra, and `verified` flipped to true entry by entry. Shipping a converter
 * on unverified layer numbers silently corrupts customer patterns.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** A pattern concept that can round-trip through a DXF layer. */
export type PatternConcept =
  | 'piece-boundary'
  | 'turn-point'
  | 'curve-point'
  | 'notch'
  | 'grade-reference'
  | 'mirror-line'
  | 'grain-line'
  | 'drill-hole'
  | 'internal-line'
  | 'annotation'
  | 'stripe-reference'
  | 'sew-line';

export interface LayerBinding {
  readonly concept: PatternConcept;
  /** DXF layer number. Provisional until checked against the standard. */
  readonly layer: number;
  readonly label: string;
  /** Entity kinds legitimately found on this layer. */
  readonly entities: readonly string[];
  /** Set true only once confirmed against ASTM D6673 and real vendor files. */
  readonly verified: boolean;
  /** Flavour-specific note, where the two profiles diverge. */
  readonly note?: string;
}

/**
 * Base table, shared by both flavours. `layerMapFor` applies flavour overrides
 * on top rather than duplicating the whole table.
 */
const BASE_BINDINGS: readonly LayerBinding[] = [
  {
    concept: 'piece-boundary',
    layer: 1,
    label: 'Piece boundary (cut line)',
    entities: ['POLYLINE', 'LWPOLYLINE'],
    verified: false,
  },
  {
    concept: 'turn-point',
    layer: 2,
    label: 'Turn points (corners)',
    entities: ['POINT'],
    verified: false,
  },
  {
    concept: 'curve-point',
    layer: 3,
    label: 'Curve points',
    entities: ['POINT'],
    verified: false,
  },
  {
    concept: 'notch',
    layer: 4,
    label: 'Notches',
    entities: ['POINT', 'POLYLINE'],
    verified: false,
    note: 'Some writers split V-notch and slit notch across two layers.',
  },
  {
    concept: 'grade-reference',
    layer: 5,
    label: 'Grade reference points',
    entities: ['POINT'],
    verified: false,
  },
  {
    concept: 'mirror-line',
    layer: 6,
    label: 'Mirror / fold line',
    entities: ['LINE'],
    verified: false,
  },
  {
    concept: 'grain-line',
    layer: 7,
    label: 'Grain line',
    entities: ['LINE'],
    verified: false,
  },
  {
    concept: 'drill-hole',
    layer: 8,
    label: 'Drill holes',
    entities: ['POINT'],
    verified: false,
  },
  {
    concept: 'internal-line',
    layer: 11,
    label: 'Internal lines',
    entities: ['POLYLINE', 'LWPOLYLINE', 'LINE'],
    verified: false,
  },
  {
    concept: 'annotation',
    layer: 13,
    label: 'Annotation text',
    entities: ['TEXT'],
    verified: false,
  },
  {
    concept: 'stripe-reference',
    layer: 14,
    label: 'Stripe / plaid reference',
    entities: ['LINE', 'POINT'],
    verified: false,
  },
  {
    concept: 'sew-line',
    layer: 15,
    label: 'Sew line (net line)',
    entities: ['POLYLINE', 'LWPOLYLINE'],
    verified: false,
  },
];

/** Per-flavour differences, applied over the base table. */
const FLAVOUR_OVERRIDES: Record<DxfFlavour, readonly Partial<LayerBinding>[]> = {
  aama: [],
  astm: [
    {
      concept: 'annotation',
      note: 'ASTM carries more piece metadata as structured text than AAMA does.',
    },
  ],
};

export const layerMapFor = (flavour: DxfFlavour): readonly LayerBinding[] =>
  BASE_BINDINGS.map((binding) => {
    const override = FLAVOUR_OVERRIDES[flavour].find((o) => o.concept === binding.concept);
    return override ? { ...binding, ...override } : binding;
  });

export const layerForConcept = (
  concept: PatternConcept,
  flavour: DxfFlavour,
): number | undefined => layerMapFor(flavour).find((b) => b.concept === concept)?.layer;

export const conceptForLayer = (
  layer: number,
  flavour: DxfFlavour,
): PatternConcept | undefined => layerMapFor(flavour).find((b) => b.layer === layer)?.concept;

/** True once every binding has been checked against the standard. */
export const isMappingVerified = (flavour: DxfFlavour): boolean =>
  layerMapFor(flavour).every((binding) => binding.verified);

export const unverifiedBindings = (flavour: DxfFlavour): readonly LayerBinding[] =>
  layerMapFor(flavour).filter((binding) => !binding.verified);
