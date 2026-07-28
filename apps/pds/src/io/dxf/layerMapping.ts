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
 * Three real files from three writers have now been read against this table,
 * and the result is neither "it was right" nor "it was wrong" — it is both,
 * per binding, and now recorded per binding:
 *
 *   observed      — a real file uses this layer for this entity kind. Six do:
 *                   piece-boundary, turn-point, curve-point, notch,
 *                   mirror-line, grain-line.
 *   contradicted  — a real file puts something else there. Four do:
 *                   grade-reference, drill-hole, stripe-reference, sew-line
 *                   (and piece-boundary, which is *both* — layer 1 carries the
 *                   boundary and that writer's metadata text).
 *   untested      — no real file has touched it: internal-line, annotation.
 *
 * The strongest single result is layer 5: two unrelated writers put a LINE
 * where this table expects a POINT. One file disagreeing is a vendor quirk;
 * two, independently, is the table being wrong. It has still not been
 * renumbered — that is a change the standard should settle, not a majority
 * vote of whichever files happen to be on hand — but it is no longer a
 * suspicion, and `import.ts` reports it on every import.
 *
 * `npm run report:dxf` prints this table's evidence state per concept.
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
    observedInFixtures: ['5109s-sp27-pattern.dxf', 'tshirt-demo-aama.dxf', '8178v-accumark.dxf'],
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
    // A real AccuMark export puts POINT entities here, exactly as claimed —
    // 131 of them across three pieces. Entity kind and layer both confirmed;
    // that they mean *turn points* specifically is still the table's word.
    observedInFixtures: ['8178v-accumark.dxf'],
  },
  {
    concept: 'curve-point',
    layer: 3,
    label: 'Curve points',
    entities: ['POINT'],
    verified: false,
    observedInFixtures: ['8178v-accumark.dxf'],
  },
  {
    concept: 'notch',
    layer: 4,
    label: 'Notches',
    entities: ['POINT', 'POLYLINE'],
    verified: false,
    // The first binding beyond the outline to be confirmed by real geometry
    // rather than by entity kind alone: layer-4 POINTs in a real file land
    // exactly *on* the outline (0.000mm), which is what a notch is. They come
    // paired with a second POINT a constant 7mm inside — plausibly the notch
    // depth, but the file never says so, so `import.ts` reads the on-seam
    // point as the notch and reports the other rather than inferring a depth.
    observedInFixtures: ['8178v-accumark.dxf'],
    note: 'Some writers split V-notch and slit notch across two layers. One real file pairs each on-seam POINT with a second 7mm inside; the pair\'s meaning is unconfirmed.',
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
    conflictingEvidence: [
      'tshirt-demo-aama.dxf: LINE on layer 5, one per piece',
      '8178v-accumark.dxf: LINE on layer 5, one per piece',
    ],
  },
  {
    concept: 'mirror-line',
    layer: 6,
    label: 'Mirror / fold line',
    entities: ['LINE'],
    verified: false,
    observedInFixtures: ['8178v-accumark.dxf'],
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
    observedInFixtures: ['tshirt-demo-aama.dxf', '8178v-accumark.dxf'],
    note: 'Entity kind matches two real files from different writers; the concept behind it is still unconfirmed.',
  },
  {
    concept: 'drill-hole',
    layer: 8,
    label: 'Drill holes',
    entities: ['POINT'],
    verified: false,
    // A real file uses layer 8 for LINE, POLYLINE and TEXT — everything
    // except the POINT this binding expects.
    conflictingEvidence: ['8178v-accumark.dxf: LINE/POLYLINE/TEXT on layer 8, no POINT'],
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
    conflictingEvidence: ['8178v-accumark.dxf: POLYLINE/TEXT on layer 14, carrying their own "# N" rule numbers'],
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
