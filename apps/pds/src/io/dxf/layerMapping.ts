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
 * IMPORTANT — the numbers below are PROVISIONAL. They reflect widely used
 * industry practice but have not been checked against the ASTM D6673 text, and
 * vendors differ in the optional ranges. Shipping a converter on unverified
 * layer numbers silently corrupts customer patterns.
 *
 * Two real files have now been read against this table, and they disagree
 * with it in three places (`conflictingEvidence` below): layers 5 and 15 hold
 * entity kinds this table does not list, and layer 1 holds TEXT as well as
 * the boundary polyline it does list. That is worth more than it looks —
 * "unverified" was a suspicion before, and is now a measurement. Nothing has
 * been renumbered in response: one writer's habits are not the standard, and
 * a table edited to match whichever file arrived most recently is worse than
 * one that is honestly wrong in a documented way.
 *
 * TODO(dxf): verify every binding against ASTM D6673 and against files exported
 * by AccuMark, Optitex and Lectra, flipping `verified` one at a time. This is
 * the first task of any real DXF work and it blocks both directions.
 * See DEVELOPMENT.md.
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
  /** Set true only once confirmed against ASTM D6673 *and* real vendor files. */
  readonly verified: boolean;
  /** Flavour-specific note, where the two profiles diverge. */
  readonly note?: string;
  /**
   * Fixtures (under `scripts/fixtures/dxf/`) that this binding's layer number
   * and entity kind have actually been observed in. Weaker evidence than
   * `verified` — it says "a real file agrees with this number," not "the
   * published standard confirms it" — but it is real, and worth keeping
   * separate from a guess rather than folding into `verified` and overstating
   * it. Empty or absent means no real file has exercised this concept yet.
   */
  readonly observedInFixtures?: readonly string[];
  /**
   * Fixtures where a real file uses this layer number for an entity kind this
   * binding does *not* list — evidence the binding is wrong, or at least
   * varies by vendor. Recorded rather than acted on: one file disagreeing is
   * not grounds for rewriting a table the standard is supposed to settle, and
   * silently "fixing" the number to match whichever file arrived last is how
   * a converter ends up right for one customer and wrong for the rest.
   * `importDxf` reports each of these as a `layer-entity-conflict`.
   */
  readonly conflictingEvidence?: readonly string[];
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
    // Still `verified: false` — that flag is reserved for "checked against
    // the ASTM D6673 text," which this has not been. What *has* happened:
    // every piece in two real production exports, from different writers,
    // uses layer "1" with POLYLINE entities for its boundary, exactly as this
    // binding already claimed. That is the strongest evidence any binding
    // here has, and it is still not the standard.
    verified: false,
    observedInFixtures: ['5109s-sp27-pattern.dxf', 'tshirt-demo-aama.dxf'],
    // …and yet the same file also puts its metadata TEXT on layer 1, which
    // this binding does not allow for. Layer 1 is evidently "the piece's own
    // layer" in that writer's output, not "the boundary polyline's layer".
    conflictingEvidence: ['tshirt-demo-aama.dxf: TEXT on layer 1'],
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
    // A real ASTM-D6673-declaring file puts exactly one full-width LINE per
    // piece here — not POINTs. Either this concept/number pairing is wrong or
    // that writer uses layer 5 for something else entirely. Unresolved, and
    // the reason `import.ts` will not read a grain line off a layer number:
    // layer 7 (which the table calls grain) carries a similar LINE in the
    // same file, and nothing available distinguishes the two.
    conflictingEvidence: ['tshirt-demo-aama.dxf: LINE on layer 5, one per piece'],
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
    // The entity *kind* agrees with a real file — one LINE per piece, inset
    // within the outline, which is what a grain line looks like. That is not
    // enough to import it *as* a grain line: the same file puts an equally
    // grain-shaped LINE on layer 5, and picking the wrong one means a
    // garment cut off-grain. `import.ts` keeps both as unclaimed
    // construction geometry until something settles which is which.
    observedInFixtures: ['tshirt-demo-aama.dxf'],
    note: 'Entity kind matches a real file; the concept behind it is still unconfirmed.',
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
    // A real file puts a single piece-label TEXT here, no polyline at all.
    // If layer 15 is that writer's annotation layer, then this binding and
    // the `annotation` one below (layer 13) cannot both be right.
    conflictingEvidence: ['tshirt-demo-aama.dxf: TEXT on layer 15, one per piece'],
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
