import type { PatternDocument } from '@/pattern';
import { FormatNotImplementedError } from '../errors';
import { layerMapFor, unverifiedBindings } from './layerMapping';
import type { ConversionIssue, DxfFlavour, DxfImportOptions } from './types';
import { DXF_FLAVOUR_LABEL } from './types';

/**
 * DXF import — NOT IMPLEMENTED.
 *
 * Intended responsibilities, in order:
 *
 *  1. Tokenise the DXF group-code stream (pairs of code + value). Apparel files
 *     are almost always ASCII DXF; binary DXF is out of scope until asked for.
 *  2. Read HEADER for $INSUNITS and $EXTMIN/$EXTMAX, falling back to
 *     `options.assumeUnit` because apparel writers are inconsistent about units.
 *  3. Walk ENTITIES, grouping by BLOCK — one block is one pattern piece in both
 *     profiles.
 *  4. Bucket each entity by layer number through `layerMapping`, discarding
 *     layers with no binding unless `options.strict`.
 *  5. Rebuild pattern topology: boundary polyline to points and segments, turn
 *     and curve points to point roles, notches onto their segment by nearest
 *     parameter, grain from the layer-7 line, internals from layer 11.
 *  6. Convert coordinates into millimetres, our canonical unit.
 *  7. Run `validateImportedDocument` and return the document with its issues.
 *
 * The hard part is step 5: DXF stores a flat bag of geometry with no topology,
 * so segments, point roles and notch attachment all have to be inferred by
 * proximity. That inference is the reason this is not a weekend job, and the
 * reason no partial version should ship — a converter that silently mis-attaches
 * a notch is worse than no converter.
 */
export const importDxf = (
  _payload: string,
  options: DxfImportOptions,
): PatternDocument => {
  throw new FormatNotImplementedError(
    DXF_FLAVOUR_LABEL[options.flavour],
    'import',
    'the group-code parser and topology rebuild are not written yet',
  );
};

export interface ImportPlanStep {
  readonly order: number;
  readonly label: string;
  readonly detail: string;
}

export interface ImportPlan {
  readonly flavour: DxfFlavour;
  readonly label: string;
  readonly steps: readonly ImportPlanStep[];
  readonly layersRead: number;
  readonly layersUnverified: number;
  readonly blockers: readonly ConversionIssue[];
}

/**
 * What a real import *would* do, derived from the layer table rather than from
 * any file. This is what the mock command in the palette reports — it exercises
 * the module's wiring and shows the mapping, without parsing anything.
 */
export const describeImportPlan = (flavour: DxfFlavour): ImportPlan => {
  const layers = layerMapFor(flavour);
  const unverified = unverifiedBindings(flavour);

  const blockers: ConversionIssue[] = [
    {
      severity: 'error',
      code: 'no-parser',
      message: 'The DXF group-code parser is not implemented.',
    },
  ];
  if (unverified.length > 0) {
    blockers.push({
      severity: 'error',
      code: 'unverified-layer-map',
      message: `${unverified.length} layer binding(s) still need checking against the standard.`,
    });
  }

  return {
    flavour,
    label: DXF_FLAVOUR_LABEL[flavour],
    layersRead: layers.length,
    layersUnverified: unverified.length,
    blockers,
    steps: [
      { order: 1, label: 'Tokenise', detail: 'Read the ASCII group-code stream into code/value pairs.' },
      { order: 2, label: 'Header', detail: 'Read $INSUNITS and extents; fall back to the assumed unit.' },
      { order: 3, label: 'Blocks', detail: 'Group entities by BLOCK — one block per pattern piece.' },
      { order: 4, label: 'Layer buckets', detail: `Sort entities across ${layers.length} mapped layers.` },
      { order: 5, label: 'Rebuild topology', detail: 'Infer points, segments, notch attachment and grain.' },
      { order: 6, label: 'Normalise units', detail: 'Convert all coordinates to millimetres.' },
      { order: 7, label: 'Validate', detail: 'Run import checks and report issues alongside the document.' },
    ],
  };
};
