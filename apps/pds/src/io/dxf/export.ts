import { toMillimetres, type Vec2 } from '@/geometry';
import {
  boundarySegments,
  findPoint,
  flattenSegment,
  FLATTEN_TOLERANCE_MM,
  type PatternDocument,
  type PatternPiece,
} from '@/pattern';
import { FormatParseError } from '../errors';
import { arcToBulge } from './curves';
import { layerForConcept, layerMapFor, type PatternConcept } from './layerMapping';
import { blocksConversion, summariseIssues, validateForExport } from './validation';
import type { ConversionIssue, DxfExportOptions, DxfFlavour } from './types';
import { DXF_FLAVOUR_LABEL } from './types';

/**
 * DXF export — real, for the piece outline and nothing else.
 *
 * The writer is the easier half of this module: we own the topology, so there
 * is nothing to infer. What it is *not* free of is the layer table, and that
 * shapes this first slice completely.
 *
 * ## Why only the boundary
 *
 * `layerMapping.ts` holds twelve bindings and not one is verified against the
 * ASTM D6673 text. Six have real-file evidence; four are actively contradicted
 * by a real file; two are untested. Writing a notch onto layer 4 or a grain
 * line onto layer 7 would be committing to numbers that three vendor exports
 * *disagree* about — and unlike a bad import, a bad export leaves the mistake
 * in someone else's cutting room.
 *
 * So this writes exactly one concept: `piece-boundary`, layer 1. That is the
 * one binding with three independent vendor files agreeing on both the number
 * and the entity kind — the strongest evidence anything here has. Every other
 * concept the model holds (notches, grain, internal lines, construction
 * points, annotation) is deliberately **not written**, and `exportDxf` reports
 * each one it dropped rather than letting a piece arrive silently stripped.
 *
 * Widening this is a data problem, not a code one: verify a binding against
 * the standard, and the concept it names can be added here in a few lines.
 *
 * ## What it emits
 *
 * R12-compatible ASCII DXF — HEADER with `$INSUNITS`, BLOCKS with one BLOCK
 * per piece, ENTITIES with one INSERT per piece. R12 because every apparel
 * file this project has read is R12 or close to it (`AC1009` dominates the
 * 125-file survey), and because it is the dialect with the widest reader
 * support in pattern CAD.
 *
 * Curves are written as they are held. An arc becomes a vertex *bulge*, which
 * is exact — `arcToBulge` is the true inverse of the importer's `bulgeToArc`,
 * so an arc survives import → export → import unchanged. A cubic has no DXF
 * equivalent this profile can rely on, so it is flattened to a chord chain at
 * `FLATTEN_TOLERANCE_MM` and reported as approximated. Nothing is invented in
 * either case.
 *
 * ## Determinism
 *
 * Byte-identical output for the same document, every time: no timestamps, no
 * ids, no map iteration, fixed decimal places. Two exports of one document can
 * be diffed, which is what makes the round-trip tests meaningful.
 */

/** Decimal places for coordinates. Six is ~1 nanometre at millimetre scale. */
const COORD_DECIMALS = 6;

/**
 * Concepts this writer emits. Deliberately one: see the module note. Anything
 * the document holds outside this set is reported as dropped.
 */
const WRITTEN_CONCEPTS: readonly PatternConcept[] = ['piece-boundary'];

const number = (value: number): string => {
  // `toFixed` then strip trailing zeros: stable across platforms, and free of
  // the exponent notation `toString` produces for very small coordinates,
  // which some apparel readers reject.
  const fixed = value.toFixed(COORD_DECIMALS);
  const trimmed = fixed.replace(/\.?0+$/, '');
  // -0 is a real hazard here: it round-trips as a distinct token and makes
  // otherwise-identical exports differ.
  return trimmed === '-0' || trimmed === '' ? '0' : trimmed;
};

/** One group-code/value pair. The writer's only primitive. */
const pair = (code: number, value: string | number): readonly [string, string] => [
  String(code),
  typeof value === 'number' ? number(value) : value,
];

interface WriteContext {
  /** Millimetres per output unit — geometry is held in mm and divided by this. */
  readonly perUnit: number;
  readonly boundaryLayer: string;
  readonly issues: ConversionIssue[];
}

/**
 * A boundary as DXF vertices: position plus the bulge of the segment leaving
 * it, mirroring exactly how the reader hands them over.
 *
 * The Y-flip is the inverse of the importer's: this app's piece space is
 * y-down, DXF is y-up. Bulge sign is *not* flipped, for the same reason the
 * importer does not flip it — `ArcGeometry.clockwise` is read in the frame its
 * endpoints are in, so the reflection and the frame change cancel. The
 * round-trip test is what holds that claim up.
 */
const boundaryVertices = (
  piece: PatternPiece,
  context: WriteContext,
): readonly { readonly position: Vec2; readonly bulge: number }[] => {
  const out: { position: Vec2; bulge: number }[] = [];
  const toFile = (p: Vec2): Vec2 => ({ x: p.x / context.perUnit, y: -p.y / context.perUnit });

  let flattenedCubics = 0;
  for (const segment of boundarySegments(piece)) {
    const from = findPoint(piece, segment.from);
    const to = findPoint(piece, segment.to);
    if (!from || !to) continue; // validateForExport already errored on this

    if (segment.geometry.kind === 'cubic') {
      // No cubic in this DXF profile. Flatten to the documented tolerance and
      // emit every intermediate point; the closing point belongs to the next
      // segment, so it is dropped here.
      const points = flattenSegment(from.position, to.position, segment.geometry, FLATTEN_TOLERANCE_MM);
      for (const point of points.slice(0, -1)) out.push({ position: toFile(point), bulge: 0 });
      flattenedCubics += 1;
      continue;
    }

    out.push({
      position: toFile(from.position),
      // Exact for an arc, 0 for a line.
      bulge: arcToBulge(from.position, to.position, segment.geometry),
    });
  }

  if (flattenedCubics > 0) {
    context.issues.push({
      severity: 'warning',
      code: 'export-cubic-flattened',
      message: `"${piece.name}": ${flattenedCubics} cubic segment(s) were flattened to straight chords within ${FLATTEN_TOLERANCE_MM}mm. This DXF profile has no cubic the apparel readers agree on; arcs are written exactly, as bulges, but a cubic cannot be.`,
      pieceId: piece.id,
    });
  }

  return out;
};

/** Everything the model holds for this piece that the writer will not emit. */
const reportDroppedConcepts = (piece: PatternPiece, issues: ConversionIssue[]): void => {
  const dropped: string[] = [];
  if (piece.notches.length > 0) dropped.push(`${piece.notches.length} notch(es)`);
  if (piece.internalLines.length > 0) dropped.push(`${piece.internalLines.length} internal line(s)`);
  if (piece.grainLine) dropped.push('a grain line');
  const construction = piece.points.filter((p) => p.role === 'construction').length;
  if (construction > 0) dropped.push(`${construction} construction point(s)`);

  if (dropped.length === 0) return;
  issues.push({
    severity: 'warning',
    code: 'export-concept-not-written',
    message: `"${piece.name}": ${dropped.join(', ')} were not written. This writer emits the piece boundary only — every other layer binding is unverified against ASTM D6673, and two vendor files already contradict the table, so writing to those numbers would put the guess in someone else's cutting room. The exported outline is complete and correct; it is just an outline.`,
    pieceId: piece.id,
  });
};

const writeBlock = (piece: PatternPiece, context: WriteContext): readonly (readonly [string, string])[] => {
  const name = piece.meta.code.trim() === '' ? piece.name : piece.meta.code;
  const rows: (readonly [string, string])[] = [
    pair(0, 'BLOCK'),
    pair(8, '0'),
    pair(2, name),
    pair(70, '0'),
    pair(10, 0),
    pair(20, 0),
    pair(30, 0),
    pair(3, name),
    pair(1, ''),
  ];

  const vertices = boundaryVertices(piece, context);
  rows.push(
    pair(0, 'POLYLINE'),
    pair(8, context.boundaryLayer),
    pair(66, '1'),
    pair(10, 0),
    pair(20, 0),
    pair(30, 0),
    // Bit 0 of group 70: this outline closes on itself. Stated explicitly
    // rather than implied by repeating the first vertex — the importer reads
    // both, and the flag is the form that cannot be mistaken for a stray
    // duplicate point.
    pair(70, piece.closed ? '1' : '0'),
  );
  for (const vertex of vertices) {
    rows.push(pair(0, 'VERTEX'), pair(8, context.boundaryLayer), pair(10, vertex.position.x), pair(20, vertex.position.y), pair(30, 0));
    if (vertex.bulge !== 0) rows.push(pair(42, vertex.bulge));
  }
  rows.push(pair(0, 'SEQEND'), pair(8, context.boundaryLayer));
  rows.push(pair(0, 'ENDBLK'), pair(8, '0'));
  return rows;
};

/**
 * `$INSUNITS` codes, keyed by the unit the caller asked for. The inverse of
 * the importer's `INSUNITS_TO_MM`, restricted to units this app has.
 */
const INSUNITS_CODE: Record<string, number> = { mm: 4, cm: 5, in: 1 };

/**
 * Writes `document` as ASCII DXF.
 *
 * Refuses on any error-severity issue from `validateForExport` — writing a
 * knowingly broken file is the one outcome worse than refusing — and reports
 * every concept it declined to write.
 */
export const exportDxf = (document: PatternDocument, options: DxfExportOptions): string => {
  const { text, issues } = exportDxfWithDiagnostics(document, options);
  if (blocksConversion(issues)) {
    throw new FormatParseError(DXF_FLAVOUR_LABEL[options.flavour], summariseIssues(issues, options.flavour));
  }
  return text;
};

/** The writer plus its account of itself — the export-side sibling of `importDxfWithDiagnostics`. */
export const exportDxfWithDiagnostics = (
  document: PatternDocument,
  options: DxfExportOptions,
): { readonly text: string; readonly issues: readonly ConversionIssue[] } => {
  const issues: ConversionIssue[] = [...validateForExport(document, options, WRITTEN_CONCEPTS)];

  const boundaryLayer = String(layerForConcept('piece-boundary', options.flavour) ?? 1);
  const context: WriteContext = {
    perUnit: toMillimetres(1, options.unit),
    boundaryLayer,
    issues,
  };

  if (options.includeSeamAllowance) {
    issues.push({
      severity: 'warning',
      code: 'export-seam-allowance-not-written',
      message: `Seam allowance was requested but is not written: it belongs on the sew-line binding, which a real vendor file contradicts (layer 15 carries TEXT there, not a polyline). Only the net boundary was written.`,
    });
  }
  if (options.includeGradedSizes) {
    issues.push({
      severity: 'warning',
      code: 'export-graded-sizes-not-written',
      message: `Graded sizes were requested but only the base size was written. Emitting a size range means writing grade-reference geometry, whose layer binding is contradicted by two independent vendor files.`,
    });
  }

  const rows: (readonly [string, string])[] = [
    // Plain ASCII, deliberately: R12 has no encoding declaration, so any
    // multi-byte character in a file this writer controls is a guess about
    // how the reader will decode it. Piece names are data and are written as
    // they are; this line is ours.
    pair(999, 'Written by PDS. Piece boundaries only - see export-concept-not-written diagnostics.'),
    pair(0, 'SECTION'),
    pair(2, 'HEADER'),
    pair(9, '$ACADVER'),
    pair(1, 'AC1009'),
    pair(9, '$INSUNITS'),
    pair(70, String(INSUNITS_CODE[options.unit] ?? 4)),
    pair(0, 'ENDSEC'),
    pair(0, 'SECTION'),
    pair(2, 'BLOCKS'),
  ];

  for (const piece of document.pieces) {
    reportDroppedConcepts(piece, issues);
    rows.push(...writeBlock(piece, context));
  }

  rows.push(pair(0, 'ENDSEC'), pair(0, 'SECTION'), pair(2, 'ENTITIES'));
  for (const piece of document.pieces) {
    const name = piece.meta.code.trim() === '' ? piece.name : piece.meta.code;
    rows.push(
      pair(0, 'INSERT'),
      pair(8, boundaryLayer),
      pair(2, name),
      // Geometry is written in absolute piece-space coordinates, so every
      // block is placed at the origin unscaled. Putting the placement in the
      // coordinates rather than in the INSERT keeps the two halves symmetric:
      // the importer's transform handling has nothing to undo.
      pair(10, 0),
      pair(20, 0),
      pair(30, 0),
    );
  }
  rows.push(pair(0, 'ENDSEC'), pair(0, 'EOF'));

  return { text: rows.flat().join('\r\n') + '\r\n', issues };
};

export interface ExportPlan {
  readonly flavour: DxfFlavour;
  readonly label: string;
  readonly blocksToWrite: number;
  readonly layersUsed: number;
  readonly issues: readonly ConversionIssue[];
  readonly wouldSucceed: boolean;
}

/**
 * What an export of this document would involve, including the real validation
 * result — now that the writer exists, `wouldSucceed` reflects it honestly
 * instead of being false by definition.
 */
export const describeExportPlan = (
  document: PatternDocument,
  options: Pick<DxfExportOptions, 'flavour' | 'includeGradedSizes'>,
): ExportPlan => {
  const issues = validateForExport(document, options, WRITTEN_CONCEPTS);
  return {
    flavour: options.flavour,
    label: DXF_FLAVOUR_LABEL[options.flavour],
    blocksToWrite: document.pieces.length,
    // Only the bindings the writer actually uses — claiming twelve would
    // overstate what a written file depends on.
    layersUsed: WRITTEN_CONCEPTS.length,
    issues,
    wouldSucceed: !blocksConversion(issues),
  };
};

/** The concepts this writer emits, for callers that want to say so. */
export const writtenConcepts = (): readonly PatternConcept[] => WRITTEN_CONCEPTS;

/** Every binding the layer table holds, for the same callers. */
export const allConcepts = (flavour: DxfFlavour): readonly PatternConcept[] =>
  layerMapFor(flavour).map((binding) => binding.concept);
