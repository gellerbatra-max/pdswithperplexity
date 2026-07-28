import { toMillimetres, type Vec2 } from '@/geometry';
import {
  addNotch,
  createId,
  LINE,
  PATTERN_SCHEMA_VERSION,
  type GradeRule,
  type InternalLine,
  type PatternDocument,
  type PatternPiece,
  type PieceCategory,
  type PiecePoint,
  type PieceSegment,
  type SegmentId,
  type SizeRange,
} from '@/pattern';
import { parseRuleTable } from './ruleTable';
import { FormatParseError } from '../errors';
import {
  conceptForLayer,
  layerForConcept,
  layerMapFor,
  unverifiedBindings,
  type PatternConcept,
} from './layerMapping';
import { blocksConversion, summariseIssues, validateImportedDocument } from './validation';
import { tokenizeDxf, tokenNumber, type DxfToken } from './tokenizer';
import type { ConversionIssue, DxfFlavour, DxfImportOptions } from './types';
import { DXF_FLAVOUR_LABEL } from './types';

/**
 * DXF import — real, for the entity patterns proven by real production files.
 *
 * This reads what `apps/pds/scripts/fixtures/dxf/` contains and nothing it
 * doesn't: BLOCK/POLYLINE/VERTEX/SEQEND/ENDBLK for piece outlines, INSERT for
 * placement, LINE for the straight construction marks pieces carry, TEXT for
 * self-labelled `Key:Value` metadata, and `$INSUNITS` (or a `Units:` text
 * field) for scale. Every other entity kind (ARC, POINT, LWPOLYLINE, CIRCLE,
 * SPLINE, …) is recognised structurally — the walker never desyncs on one —
 * but its *content* is not interpreted. Encountering one produces a warning
 * (or an error under `options.strict`) naming the entity and where it was
 * found, never a silent drop.
 *
 * ## What "supported" means here, and what it deliberately does not
 *
 * Geometry is imported; *meaning* is imported only where the file states it
 * outright. Those are different bars, and the gap between them is the whole
 * design:
 *
 *  - A LINE inside a block becomes an `InternalLine` with role
 *    `'construction'` and `cut: false`. Its coordinates are exact. What it
 *    *is* — grain line, fold, mirror, stripe reference — is not claimed,
 *    because the only evidence available for that is a layer number from an
 *    unverified table. A real file puts one plausible-looking grain LINE on
 *    layer 5 and another on layer 7, and `layerMapping.ts` calls only the
 *    second one grain; nothing to hand distinguishes them, and a piece cut
 *    off-grain is scrap. So both are kept, drawn and never cut, and the
 *    layer report says exactly where each came from.
 *  - A TEXT reading `Piece Name:Front` *is* read as a piece name, because
 *    the file labelled the field itself, in English. That is not inference,
 *    it is reading. Such fields are still reported (`metadata-read-from-text`)
 *    rather than presented as if the format guaranteed them.
 *
 * `layerMapping.ts` lists twelve pattern concepts and none is confirmed
 * against the ASTM D6673 text. Notches, drill holes, curve entities and real
 * internal-line semantics each still need a file that actually contains them.
 * See DEVELOPMENT.md.
 *
 * ## What this does, precisely
 *
 *  1. Tokenise the ASCII group-code stream (`tokenizer.ts`).
 *  2. Read HEADER for `$INSUNITS`; failing that, the file's own `Units:`
 *     text field; failing that, `options.assumeUnit` (default mm) with a
 *     warning.
 *  3. Read BLOCKS: one BLOCK is one candidate piece. A block's first polyline
 *     on the mapped piece-boundary layer becomes the outline; a block with no
 *     polyline on that layer falls back to its only polyline with a warning,
 *     rather than dropping a real piece over an unverified layer number.
 *     LINE and TEXT inside the block are collected too.
 *  4. Read ENTITIES for INSERT placements and for loose TEXT, which is where
 *     style-wide metadata lives. Only a block that is actually inserted
 *     becomes a piece — a BLOCK with no INSERT contributes nothing to the
 *     drawing, which is also how AutoCAD treats it.
 *  5. Resolve each piece's geometry: translate by (insertion − base point),
 *     flip Y (DXF is y-up; this app's piece space is y-down, see
 *     `piece.ts`), convert to millimetres, and collapse the vertex noise
 *     real exports carry — a repeated point mid-polyline (export artefact)
 *     and the closing point that duplicates the first (this app's model
 *     represents "closed" with the `closed` flag, not a repeated point).
 *  6. Every boundary vertex becomes a `corner` point joined by straight
 *     `LINE` segments. This is not a simplification: neither fixture carries
 *     curve entities, only densely-sampled polylines, so a corner-and-lines
 *     reading is the exact content of the file, not a guess at which
 *     vertices were meant to be smooth.
 *  7. Report layer usage (`reportLayerUsage`) — which layers were read, how
 *     each was treated, and which contradict the layer table.
 *  8. Run `validateImportedDocument` and return the document with every
 *     issue collected along the way.
 */

/* --- Units -------------------------------------------------------------- */

/**
 * Millimetres per unit, for the `$INSUNITS` codes apparel files actually use.
 * Not the full AutoCAD table (astronomical units etc. are not a pattern CAD
 * concern) — extend when a real file proves another code is in use.
 */
const INSUNITS_TO_MM: Record<number, number> = {
  1: 25.4, // inches
  2: 304.8, // feet
  4: 1, // millimetres
  5: 10, // centimetres
  6: 1000, // metres
};

/* --- Token cursor --------------------------------------------------------- */

/**
 * A read position over the token stream. Every section/entity reader below
 * takes one of these and advances it; nothing here re-parses from an index
 * threaded through function arguments, which is how a walker like this one
 * quietly desyncs.
 */
class TokenCursor {
  private readonly tokens: readonly DxfToken[];
  private index = 0;

  constructor(tokens: readonly DxfToken[]) {
    this.tokens = tokens;
  }

  peek(): DxfToken | undefined {
    return this.tokens[this.index];
  }

  next(): DxfToken {
    const token = this.tokens[this.index];
    if (!token) throw new Error('unexpected end of file');
    this.index += 1;
    return token;
  }

  done(): boolean {
    return this.index >= this.tokens.length;
  }

  /** True when the next token is the `0`-coded marker for `value`. */
  at(value: string): boolean {
    const token = this.peek();
    return token !== undefined && token.code === 0 && token.value === value;
  }
}

/**
 * Consumes one unknown entity — its `0 <TYPE>` marker and everything up to
 * (not including) the next `0`-coded token — and returns its type name.
 *
 * This is what lets the walker survive an entity kind it has no reader for:
 * every DXF entity, known or not, is delimited the same way, so "skip it" is
 * mechanical and never desyncs the cursor for whatever comes next.
 */
const skipFields = (cursor: TokenCursor): void => {
  while (!cursor.done() && cursor.peek()!.code !== 0) cursor.next();
};

const skipEntity = (cursor: TokenCursor): string => {
  const marker = cursor.next();
  skipFields(cursor);
  // Only a `0`-coded token names an entity. Being handed anything else means
  // a reader above left the cursor mid-entity, and reporting that token's
  // value as an "entity" turns a walker desync into a confusing complaint
  // about an entity kind that does not exist. Name it for what it is.
  if (marker.code !== 0) return `(stray group ${marker.code} at line ${marker.line})`;
  return marker.value;
};

/** Consumes tokens up to (not including) the section's `0 ENDSEC`. */
const skipSection = (cursor: TokenCursor): void => {
  while (!cursor.done() && !cursor.at('ENDSEC')) cursor.next();
};

/* --- HEADER --------------------------------------------------------------- */

/**
 * `9 $NAME` marks a header variable; every following token up to the next
 * `9` or the section end is that variable's value. Most apparel-relevant
 * variables (`$INSUNITS`) are one token; this does not assume that, so a
 * multi-value variable like `$EXTMIN` is captured correctly even though
 * nothing reads it yet.
 */
const readHeader = (cursor: TokenCursor): Map<string, DxfToken[]> => {
  const vars = new Map<string, DxfToken[]>();
  let current: string | null = null;
  while (!cursor.done() && !cursor.at('ENDSEC')) {
    const token = cursor.next();
    if (token.code === 9) {
      current = token.value;
      vars.set(current, []);
    } else if (current) {
      vars.get(current)!.push(token);
    }
  }
  return vars;
};

/**
 * Millimetres per unit for the `Units:` TEXT field, which a real file uses
 * *instead of* `$INSUNITS`. Only the two values actually observed are here;
 * anything else falls through to the assumed unit rather than being guessed.
 */
const UNITS_TEXT_TO_MM: Record<string, number> = {
  METRIC: 1,
  IMPERIAL: 25.4,
  // AccuMark's spelling for inches. Corroborated twice over in one style: the
  // DXF's own `Units: ENGLISH` field and the companion .RUL's `UNITS: ENGLISH`
  // header, on a file whose coordinates only make sense as inches.
  ENGLISH: 25.4,
};

/**
 * Resolves the file's unit, in order of how much the file itself commits to:
 * `$INSUNITS` (a real header variable) beats a `Units:` TEXT field (vendor
 * convention, but still the file's own statement) beats `options.assumeUnit`
 * (our guess). A file that states nothing still gets the fallback and the
 * warning that goes with it.
 */
const resolveUnitFactor = (
  header: ReadonlyMap<string, readonly DxfToken[]>,
  styleFields: ReadonlyMap<string, string>,
  options: DxfImportOptions,
  issues: ConversionIssue[],
): number => {
  const insunits = header.get('$INSUNITS')?.find((t) => t.code === 70);
  const fallback = (reason: string): number => {
    const declared = styleFields.get('Units');
    if (declared !== undefined) {
      const factor = UNITS_TEXT_TO_MM[declared.toUpperCase()];
      if (factor !== undefined) {
        issues.push({
          severity: 'info',
          code: 'units-read',
          message: `${reason} Units taken from the file's own "Units:${declared}" text field (${factor}mm per file unit).`,
        });
        return factor;
      }
      issues.push({
        severity: 'warning',
        code: 'unit-assumed',
        message: `${reason} Its "Units:${declared}" text field is not a value this importer recognises.`,
      });
    }
    const assumed = options.assumeUnit ?? 'mm';
    issues.push({
      severity: 'warning',
      code: 'unit-assumed',
      message: `${reason} Falling back to the assumed unit (${assumed}). Pass \`assumeUnit\` to override.`,
    });
    return toMillimetres(1, assumed);
  };

  if (!insunits) return fallback('The file has no $INSUNITS header variable.');

  const code = tokenNumber(insunits);
  const factor = INSUNITS_TO_MM[code];
  if (factor === undefined) {
    return fallback(`$INSUNITS = ${code} is not a recognised apparel-DXF unit code.`);
  }

  issues.push({
    severity: 'info',
    code: 'units-read',
    message: `Units read from $INSUNITS: code ${code} (${factor}mm per file unit).`,
  });
  return factor;
};

/* --- Layer reporting -------------------------------------------------------
 *
 * What separates "we read this file" from "we read the parts of this file we
 * happen to handle" is saying which is which, per layer, out loud. Every
 * (layer, entity kind) pair the file uses lands in exactly one of:
 *
 *   supported    — it became something in the document (outline, construction
 *                  geometry, metadata).
 *   unsupported  — recognised structurally, deliberately not interpreted.
 *   conflicting  — `layerMapping.ts` has a binding for that layer number, but
 *                  the entity kind found on it is not one that binding lists.
 *
 * The third is the interesting one: it is evidence the layer table is wrong,
 * or at least vendor-variable, and it is reported rather than resolved. This
 * importer never edits the table to match a file it happens to have.
 */

/** How a given (layer, entity) pair was treated. */
export type LayerTreatment = 'outline' | 'construction' | 'notch' | 'marker' | 'metadata' | 'skipped';

export const TREATMENT_LABEL: Record<LayerTreatment, string> = {
  outline: 'imported as the piece outline',
  construction: 'imported as construction geometry, with no meaning claimed',
  notch: 'imported as a notch on the boundary',
  marker: 'imported as a construction point marking a turn or curve',
  metadata: 'read as self-labelled metadata',
  skipped: 'not imported',
};

export interface LayerObservation {
  readonly layer: string;
  readonly entity: string;
  readonly count: number;
  readonly treatment: LayerTreatment;
}

/** Stable presentation order: numeric-aware by layer, then entity kind. */
const sortObservations = (
  observations: readonly LayerObservation[],
): readonly LayerObservation[] =>
  [...observations].sort(
    (a, b) =>
      a.layer.localeCompare(b.layer, 'en', { numeric: true }) || a.entity.localeCompare(b.entity),
  );

/** Tallies observations into one row per (layer, entity, treatment). */
const tally = (
  into: Map<string, LayerObservation>,
  layer: string,
  entity: string,
  treatment: LayerTreatment,
): void => {
  const key = `${layer} ${entity} ${treatment}`;
  const existing = into.get(key);
  into.set(key, {
    layer,
    entity,
    treatment,
    count: (existing?.count ?? 0) + 1,
  });
};

/**
 * Turns the observation tally into diagnostics: one `layer-usage` info line
 * summarising every layer, plus a `layer-entity-conflict` warning for each
 * pair that contradicts `layerMapping.ts`.
 */
const reportLayerUsage = (
  observations: readonly LayerObservation[],
  flavour: DxfFlavour,
  issues: ConversionIssue[],
): void => {
  if (observations.length === 0) return;

  const bindings = layerMapFor(flavour);
  const sorted = sortObservations(observations);

  issues.push({
    severity: 'info',
    code: 'layer-usage',
    message: `Layers used by this file: ${sorted
      .map((o) => `${o.entity}×${o.count} on layer "${o.layer}" (${TREATMENT_LABEL[o.treatment]})`)
      .join('; ')}.`,
  });

  // One conflict per (layer, entity) pair, not per treatment row: the same
  // TEXT layer can legitimately produce both a 'metadata' and a 'skipped'
  // row, and reporting the identical conflict twice just adds noise.
  const reported = new Set<string>();
  for (const observation of sorted) {
    const pair = `${observation.layer} ${observation.entity}`;
    if (reported.has(pair)) continue;
    reported.add(pair);

    const binding = bindings.find((b) => String(b.layer) === observation.layer);
    if (!binding) {
      issues.push({
        severity: 'warning',
        code: 'unmapped-layer',
        message: `Layer "${observation.layer}" carries ${observation.entity} entities but has no binding in the layer table at all.`,
      });
      continue;
    }
    if (!binding.entities.includes(observation.entity)) {
      issues.push({
        severity: 'warning',
        code: 'layer-entity-conflict',
        message: `Layer "${observation.layer}" is mapped to "${binding.concept}" (${binding.label}), which expects ${binding.entities.join('/')} — but this file puts ${observation.entity} there. The layer table is unverified and may be wrong for this concept; it was not changed to match this file.`,
      });
    }
  }
};

/* --- BLOCKS ----------------------------------------------------------------
 *
 * A BLOCK is a named, reusable piece of geometry defined in its own local
 * space; ENTITIES places it with INSERT. That two-step indirection is DXF's
 * own structure, not an apparel convention — every block here becomes a
 * *candidate* piece, and only the ones actually inserted survive into the
 * document (§ "Resolve" below).
 */

interface RawPolyline {
  readonly layer: string;
  readonly vertices: readonly Vec2[];
}

/** A two-point LINE. What it *means* depends on its layer — see `LayerReport`. */
interface RawLine {
  readonly layer: string;
  readonly start: Vec2;
  readonly end: Vec2;
}

/** A POINT marker. Its layer is the only thing that says what it marks. */
interface RawPoint {
  readonly layer: string;
  readonly position: Vec2;
}

/** A TEXT entity's literal string (group 1) and where it sits. */
interface RawText {
  readonly layer: string;
  readonly value: string;
  readonly position: Vec2;
}

interface RawBlock {
  readonly name: string;
  readonly basePoint: Vec2;
  readonly polylines: readonly RawPolyline[];
  readonly lines: readonly RawLine[];
  readonly texts: readonly RawText[];
  readonly points: readonly RawPoint[];
}

const readVertex = (cursor: TokenCursor): Vec2 => {
  let x = 0;
  let y = 0;
  while (!cursor.done() && cursor.peek()!.code !== 0) {
    const token = cursor.next();
    if (token.code === 10) x = tokenNumber(token);
    else if (token.code === 20) y = tokenNumber(token);
    // 8 (layer), 30 (z), 70 (vertex flags) — not meaningful for a flat 2D outline.
  }
  return { x, y };
};

/** `10/20` is the start point, `11/21` the end. */
const readLine = (cursor: TokenCursor): RawLine => {
  let layer = '0';
  let start: Vec2 = { x: 0, y: 0 };
  let end: Vec2 = { x: 0, y: 0 };
  while (!cursor.done() && cursor.peek()!.code !== 0) {
    const token = cursor.next();
    if (token.code === 8) layer = token.value;
    else if (token.code === 10) start = { ...start, x: tokenNumber(token) };
    else if (token.code === 20) start = { ...start, y: tokenNumber(token) };
    else if (token.code === 11) end = { ...end, x: tokenNumber(token) };
    else if (token.code === 21) end = { ...end, y: tokenNumber(token) };
    // 30/31 (z) — flat 2D pattern geometry only.
  }
  return { layer, start, end };
};

/** `10/20` is the marker position. POINT has no other geometry. */
const readPoint = (cursor: TokenCursor): RawPoint => {
  let layer = '0';
  let position: Vec2 = { x: 0, y: 0 };
  while (!cursor.done() && cursor.peek()!.code !== 0) {
    const token = cursor.next();
    if (token.code === 8) layer = token.value;
    else if (token.code === 10) position = { ...position, x: tokenNumber(token) };
    else if (token.code === 20) position = { ...position, y: tokenNumber(token) };
  }
  return { layer, position };
};

/** Group `1` carries the literal string; `40` (height) and style are not used. */
const readText = (cursor: TokenCursor): RawText => {
  let layer = '0';
  let value = '';
  let position: Vec2 = { x: 0, y: 0 };
  while (!cursor.done() && cursor.peek()!.code !== 0) {
    const token = cursor.next();
    if (token.code === 8) layer = token.value;
    else if (token.code === 1) value = token.value;
    else if (token.code === 10) position = { ...position, x: tokenNumber(token) };
    else if (token.code === 20) position = { ...position, y: tokenNumber(token) };
  }
  return { layer, value, position };
};

const readPolyline = (cursor: TokenCursor): RawPolyline => {
  let layer = '0';
  while (!cursor.done() && cursor.peek()!.code !== 0) {
    const token = cursor.next();
    if (token.code === 8) layer = token.value;
    // 66 (entities-follow) and 70 (closed flag) — closure is inferred from
    // the vertex data itself (see `cleanRing`), not trusted from the flag:
    // a writer that gets the flag wrong is a real, observed failure mode,
    // and the vertex list cannot lie about whether it repeats its start.
  }

  const vertices: Vec2[] = [];
  while (!cursor.done() && !cursor.at('SEQEND')) {
    if (cursor.at('VERTEX')) {
      cursor.next();
      vertices.push(readVertex(cursor));
    } else {
      // Some other entity nested where a VERTEX was expected — skip it
      // rather than let it desync the polyline read.
      skipEntity(cursor);
    }
  }
  // SEQEND carries its own group codes (a layer, at least, in real files).
  // Consuming only its `0 SEQEND` marker leaves those fields in the stream,
  // where the caller's entity loop reads the first of them as if it were an
  // entity marker — a desync that shows up as a complaint about an entity
  // named "1". Skip the whole thing, marker and fields alike.
  if (cursor.at('SEQEND')) {
    cursor.next();
    skipFields(cursor);
  }

  return { layer, vertices };
};

const readBlock = (cursor: TokenCursor, issues: ConversionIssue[]): RawBlock => {
  let name = '';
  let basePoint: Vec2 = { x: 0, y: 0 };
  while (!cursor.done() && cursor.peek()!.code !== 0) {
    const token = cursor.next();
    if (token.code === 2) name = token.value;
    else if (token.code === 10) basePoint = { ...basePoint, x: tokenNumber(token) };
    else if (token.code === 20) basePoint = { ...basePoint, y: tokenNumber(token) };
    // 8 (layer), 30 (z), 70 (block-type flags), 1/3 (xref paths) — not used.
  }

  const polylines: RawPolyline[] = [];
  const lines: RawLine[] = [];
  const texts: RawText[] = [];
  const points: RawPoint[] = [];
  while (!cursor.done() && !cursor.at('ENDBLK')) {
    if (cursor.at('POLYLINE')) {
      cursor.next();
      polylines.push(readPolyline(cursor));
    } else if (cursor.at('LINE')) {
      cursor.next();
      lines.push(readLine(cursor));
    } else if (cursor.at('TEXT')) {
      cursor.next();
      texts.push(readText(cursor));
    } else if (cursor.at('POINT')) {
      cursor.next();
      points.push(readPoint(cursor));
    } else {
      const kind = skipEntity(cursor);
      issues.push({
        severity: 'warning',
        code: 'unsupported-entity',
        message: `Block "${name}": entity "${kind}" is not supported yet and was skipped.`,
      });
    }
  }
  // ENDBLK carries a layer of its own too — same reasoning as SEQEND above.
  if (cursor.at('ENDBLK')) {
    cursor.next();
    skipFields(cursor);
  }

  return { name, basePoint, polylines, lines, texts, points };
};

const readBlocksSection = (cursor: TokenCursor, issues: ConversionIssue[]): Map<string, RawBlock> => {
  const blocks = new Map<string, RawBlock>();
  while (!cursor.done() && !cursor.at('ENDSEC')) {
    if (cursor.at('BLOCK')) {
      cursor.next();
      const block = readBlock(cursor, issues);
      blocks.set(block.name, block);
    } else {
      cursor.next();
    }
  }
  return blocks;
};

/* --- ENTITIES --------------------------------------------------------------- */

interface RawInsert {
  readonly blockName: string;
  readonly insertionPoint: Vec2;
}

const readInsert = (cursor: TokenCursor, issues: ConversionIssue[]): RawInsert => {
  let blockName = '';
  let point: Vec2 = { x: 0, y: 0 };
  const transform: DxfToken[] = [];
  while (!cursor.done() && cursor.peek()!.code !== 0) {
    const token = cursor.next();
    if (token.code === 2) blockName = token.value;
    else if (token.code === 10) point = { ...point, x: tokenNumber(token) };
    else if (token.code === 20) point = { ...point, y: tokenNumber(token) };
    else if ([41, 42, 43, 44, 50].includes(token.code)) transform.push(token);
    // 8 (layer), 30 (z) — not used.
  }
  if (transform.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'insert-transform-ignored',
      message: `INSERT of "${blockName}" carries a scale or rotation (group code(s) ${transform
        .map((t) => t.code)
        .join(', ')}), which is not applied yet — the block was placed at its insertion point unscaled and unrotated.`,
    });
  }
  return { blockName, insertionPoint: point };
};

interface RawEntities {
  readonly inserts: readonly RawInsert[];
  /** Loose TEXT in ENTITIES — where this file keeps style-wide metadata. */
  readonly texts: readonly RawText[];
}

const readEntitiesSection = (cursor: TokenCursor, issues: ConversionIssue[]): RawEntities => {
  const inserts: RawInsert[] = [];
  const texts: RawText[] = [];
  while (!cursor.done() && !cursor.at('ENDSEC')) {
    if (cursor.at('INSERT')) {
      cursor.next();
      inserts.push(readInsert(cursor, issues));
    } else if (cursor.at('TEXT')) {
      cursor.next();
      texts.push(readText(cursor));
    } else {
      const kind = skipEntity(cursor);
      issues.push({
        severity: 'warning',
        code: 'unsupported-entity',
        message: `ENTITIES: "${kind}" was placed directly (not via a BLOCK/INSERT pair) and is not supported yet; skipped.`,
      });
    }
  }
  return { inserts, texts };
};

/* --- Driver ------------------------------------------------------------- */

interface ParsedFile {
  readonly header: Map<string, DxfToken[]>;
  readonly blocks: Map<string, RawBlock>;
  readonly inserts: readonly RawInsert[];
  readonly styleTexts: readonly RawText[];
}

const parseSections = (cursor: TokenCursor, issues: ConversionIssue[]): ParsedFile => {
  let header = new Map<string, DxfToken[]>();
  let blocks = new Map<string, RawBlock>();
  let inserts: readonly RawInsert[] = [];
  let styleTexts: readonly RawText[] = [];

  while (!cursor.done()) {
    const token = cursor.next();
    if (token.code === 0 && token.value === 'EOF') break;
    if (token.code !== 0 || token.value !== 'SECTION') continue; // ignore stray tokens between sections

    const nameToken = cursor.peek();
    const name = nameToken?.code === 2 ? cursor.next().value : '';

    if (name === 'HEADER') header = readHeader(cursor);
    else if (name === 'BLOCKS') blocks = readBlocksSection(cursor, issues);
    else if (name === 'ENTITIES') ({ inserts, texts: styleTexts } = readEntitiesSection(cursor, issues));
    else {
      skipSection(cursor);
      issues.push({
        severity: 'info',
        code: 'unsupported-section',
        message: `Section "${name || '(unnamed)'}" is not read yet; skipped.`,
      });
    }

    if (cursor.at('ENDSEC')) cursor.next();
  }

  return { header, blocks, inserts, styleTexts };
};

/* --- Self-labelled TEXT metadata -------------------------------------------
 *
 * Some writers carry pattern metadata as plain TEXT entities whose string is
 * literally `Key:Value` — `Piece Name:Front`, `Units:METRIC`. Reading those is
 * *not* the layer-semantics guessing the rest of this module refuses to do:
 * the file names its own fields in English, so there is nothing to infer. It
 * is still vendor convention rather than anything the standard mandates, so
 * every value read this way is reported (`metadata-read-from-text`) rather
 * than presented as if the format guaranteed it, and an unrecognised key is
 * left alone instead of being coerced into a field it might not mean.
 */

/**
 * Field names this importer understands, mapped from the spellings real files
 * actually use to one canonical name each.
 *
 * Two real writers already disagree on both case and wording — one writes
 * `Size Name:S`, the other `SIZE: M`; one `Fabric: A`, and neither uses the
 * other's capitalisation. Matching case-insensitively through this table is
 * what lets a field be *read* rather than reported as unknown, without the
 * importer inventing a meaning for a key it has never seen. A key absent from
 * this table stays unread and is reported with its value intact.
 */
const TEXT_KEY_ALIASES: Record<string, string> = {
  'piece name': 'Piece Name',
  'size name': 'Size',
  size: 'Size',
  quantity: 'Quantity',
  rotation: 'Rotation',
  fabric: 'Fabric',
  category: 'Category',
  annotation: 'Annotation',
  'style name': 'Style Name',
  'creation date': 'Creation Date',
  'creation time': 'Creation Time',
  author: 'Author',
  'sample size': 'Sample Size',
  'grade rule table': 'Grade Rule Table',
  units: 'Units',
  'curve tolerance': 'Curve Tolerance',
  'astm/d13proposal 1 version': 'ASTM/D13Proposal 1 Version',
};

/**
 * Splits `Key:Value` TEXT into a lookup keyed by canonical name. First
 * occurrence wins — these fields are one-per-scope in practice, and silently
 * letting a later duplicate overwrite an earlier one would hide a malformed
 * file. Unrecognised keys come back with their values, so a caller can report
 * what was in the file rather than merely that something was.
 */
const parseKeyValueTexts = (
  texts: readonly RawText[],
): {
  readonly fields: Map<string, string>;
  readonly unknown: ReadonlyMap<string, string>;
} => {
  const fields = new Map<string, string>();
  const unknown = new Map<string, string>();
  for (const text of texts) {
    const separator = text.value.indexOf(':');
    if (separator <= 0) continue; // '# 0', piece labels, empty strings — not fields
    const key = text.value.slice(0, separator).trim();
    const value = text.value.slice(separator + 1).trim();
    const canonical = TEXT_KEY_ALIASES[key.toLowerCase()];
    if (canonical === undefined) {
      if (!unknown.has(key)) unknown.set(key, value);
      continue;
    }
    if (!fields.has(canonical)) fields.set(canonical, value);
  }
  return { fields, unknown };
};

/**
 * Reads `Category:` only when it names a category this model actually has.
 *
 * A real file puts `CATEGORY: FRONT` here — which is the piece's *role*, not
 * the shell/lining/interlining/trim distinction `PieceCategory` means. Mapping
 * one onto the other would put a front panel in the wrong cut bundle, so
 * anything unrecognised is left alone and reported instead.
 */
const PIECE_CATEGORIES: readonly string[] = ['shell', 'lining', 'interlining', 'trim'];

const parseCategory = (raw: string | undefined): PieceCategory | undefined => {
  if (raw === undefined) return undefined;
  const lower = raw.trim().toLowerCase();
  return PIECE_CATEGORIES.includes(lower) ? (lower as PieceCategory) : undefined;
};

/**
 * Reads a cut quantity from a field observed as `Quantity:1,0`.
 *
 * That value is genuinely ambiguous — it reads as either a decimal comma
 * (1.0) or a comma-separated pair (1 and 0) — so this takes the first field
 * only, which is 1 under *both* readings, and reports the rest rather than
 * picking an interpretation. Returns undefined when nothing usable is there,
 * leaving the caller's default in place.
 */
const parseQuantity = (
  raw: string,
): { readonly quantity?: number; readonly ignoredFields?: string } => {
  const parts = raw.split(',').map((p) => p.trim());
  const first = Number(parts[0]);
  if (!Number.isFinite(first) || first <= 0) return {};
  const rest = parts.slice(1).filter((p) => p.length > 0);
  return {
    quantity: Math.round(first),
    ...(rest.length > 0 ? { ignoredFields: rest.join(', ') } : {}),
  };
};

/* --- Resolve blocks + inserts into pieces -------------------------------- */

/** How close two points must be, in millimetres, to treat them as the same vertex. */
const VERTEX_EPSILON_MM = 1e-6;

/**
 * How close, in the file's own units, one polyline's end must be to the next
 * one's start before they count as the same boundary.
 *
 * Deliberately tight. In the real file that motivated this the gap is exactly
 * zero — every run ends on the coordinate the next one starts from, to the
 * digit — so this only has to absorb a writer that rounds, not stitch together
 * runs that merely look close. Anything further apart is left as a separate
 * polyline and reported, because "these two nearly touch" is a guess about
 * intent and joining the wrong pair would invent a seam that isn't there.
 */
const CHAIN_EPSILON = 1e-6;

interface ChainedBoundary {
  readonly vertices: readonly Vec2[];
  /** How many source polylines went into it. 1 means nothing was joined. */
  readonly joined: number;
  /** Boundary-layer polylines left over because the chain broke. */
  readonly unjoined: number;
}

/**
 * Joins boundary-layer polylines that are laid out head-to-tail into one ring.
 *
 * A real AccuMark export writes a piece outline as a *sequence* of polylines —
 * one per run between significant points, plus zero-length markers at the
 * junctions — rather than as a single closed polyline. Taking the first one
 * and calling it the boundary produces a piece with a tenth of its outline,
 * which is worse than failing: it looks like a pattern piece.
 *
 * Only consecutive runs are joined, in file order, and only where the previous
 * end and the next start actually coincide. No searching, no reordering, no
 * reversing: the evidence is that these files already store the runs in order,
 * and a matcher that hunts for a partner would happily assemble a plausible
 * ring out of an internal line and a boundary. The moment the chain breaks,
 * this stops and reports what was left.
 */
const chainBoundary = (runs: readonly RawPolyline[]): ChainedBoundary => {
  const first = runs[0];
  if (!first) return { vertices: [], joined: 0, unjoined: 0 };

  const vertices: Vec2[] = [...first.vertices];
  let joined = 1;

  for (let i = 1; i < runs.length; i += 1) {
    const next = runs[i]!;
    const end = vertices[vertices.length - 1];
    const start = next.vertices[0];
    if (
      !end ||
      !start ||
      Math.abs(end.x - start.x) > CHAIN_EPSILON ||
      Math.abs(end.y - start.y) > CHAIN_EPSILON
    ) {
      return { vertices, joined, unjoined: runs.length - i };
    }
    // Drop the shared junction vertex — the next run repeats it by definition.
    vertices.push(...next.vertices.slice(1));
    joined += 1;
  }

  return { vertices, joined, unjoined: 0 };
};

/**
 * Drops a vertex that repeats the one immediately before it (an export
 * artefact — a zero-length segment, seen in real files) and the closing
 * vertex when it repeats the first (this app represents "closed" with the
 * `closed` flag, not a repeated coordinate — see `geometry/offset.ts`'s
 * `clean`, which the pattern kernel already relies on doing the same thing).
 *
 * Deliberately does *not* touch a repeated point that is not adjacent in the
 * list — a boundary that revisits an earlier point without being consecutive
 * is unusual but is not export noise, and `validateImportedDocument` flags it
 * instead of this function guessing which visit was the mistake.
 */
const cleanRing = (
  points: readonly Vec2[],
  issues: ConversionIssue[],
  pieceName: string,
): Vec2[] => {
  const same = (a: Vec2, b: Vec2): boolean =>
    Math.abs(a.x - b.x) <= VERTEX_EPSILON_MM && Math.abs(a.y - b.y) <= VERTEX_EPSILON_MM;

  const collapsed: Vec2[] = [];
  let droppedConsecutive = 0;
  for (const point of points) {
    const last = collapsed[collapsed.length - 1];
    if (last && same(last, point)) {
      droppedConsecutive += 1;
      continue;
    }
    collapsed.push(point);
  }

  let result = collapsed;
  if (result.length > 1) {
    const first = result[0]!;
    const last = result[result.length - 1]!;
    if (same(first, last)) result = result.slice(0, -1);
  }

  if (droppedConsecutive > 0) {
    issues.push({
      severity: 'info',
      code: 'duplicate-vertex-collapsed',
      message: `"${pieceName}": collapsed ${droppedConsecutive} repeated vertex/vertices in the source polyline.`,
    });
  }

  return result;
};

/**
 * Matches `# N` grade-rule texts to boundary points **by coordinate**.
 *
 * A real AccuMark file writes a `# N` TEXT at each graded point, naming a
 * `RULE: DELTA N` in the companion .RUL table. Matching them positionally
 * would be wrong: the file writes 30 such texts against 41 boundary points in
 * one piece, repeating a rule at a point several times over, so the two lists
 * are not parallel and never were.
 *
 * They *are* placed exactly on the vertex they describe — checked across all
 * three pieces of the real file, every text landing on a boundary point to the
 * digit, with no position ever carrying two different rule numbers. So
 * coordinates are the join, repeats are harmless, and a genuine disagreement
 * at one position is reported rather than resolved by whichever came last.
 */
const ruleNumbersForBoundary = (
  texts: readonly RawText[],
  boundaryLayer: string,
  boundary: readonly Vec2[],
  toPieceSpace: (v: Vec2) => Vec2,
  issues: ConversionIssue[],
  pieceName: string,
): (number | undefined)[] => {
  const numbers: (number | undefined)[] = boundary.map(() => undefined);
  let unmatched = 0;
  let conflicts = 0;

  for (const text of texts) {
    if (text.layer !== boundaryLayer) continue;
    const match = /^#\s*(\d+)$/.exec(text.value.trim());
    if (!match) continue;
    const rule = Number(match[1]);

    const at = toPieceSpace(text.position);
    const index = boundary.findIndex(
      (p) => Math.abs(p.x - at.x) <= VERTEX_EPSILON_MM && Math.abs(p.y - at.y) <= VERTEX_EPSILON_MM,
    );
    if (index === -1) {
      unmatched += 1;
      continue;
    }
    const existing = numbers[index];
    if (existing !== undefined && existing !== rule) {
      conflicts += 1;
      continue;
    }
    numbers[index] = rule;
  }

  if (unmatched > 0) {
    issues.push({
      severity: 'warning',
      code: 'grade-rule-text-unmatched',
      message: `"${pieceName}": ${unmatched} "# N" grade-rule text(s) do not sit on any boundary point and were not attached to anything.`,
    });
  }
  if (conflicts > 0) {
    issues.push({
      severity: 'warning',
      code: 'grade-rule-text-conflict',
      message: `"${pieceName}": ${conflicts} boundary point(s) carry more than one different "# N" rule number. None of the conflicting ones were applied — the first number read at each point stands.`,
    });
  }

  return numbers;
};

/** A POINT marker resolved into piece space, with what its layer says it is. */
interface ResolvedMarker {
  readonly concept: PatternConcept;
  readonly position: Vec2;
}

interface ResolvedPiece {
  /** The file's own `Piece Name:` when it states one, else the block name. */
  readonly name: string;
  /** Block name — unique per block, so it survives repeated piece names. */
  readonly code: string;
  /** Millimetres, this app's y-down piece space, already cleaned. */
  readonly points: readonly Vec2[];
  /** Straight LINE entities, same space as `points`. Meaning deliberately unclaimed. */
  readonly constructionLines: readonly (readonly [Vec2, Vec2])[];
  /** POINT markers whose layer maps to a notch / turn point / curve point. */
  readonly markers: readonly ResolvedMarker[];
  /** Grade rule number per boundary point, from the `# N` text beside it. */
  readonly ruleNumbers: readonly (number | undefined)[];
  readonly quantity?: number;
  /** The file's `Size Name:`, when present — recorded, never used to grade. */
  readonly sizeName?: string;
  readonly fabric?: string;
  readonly category?: PieceCategory;
  readonly description?: string;
}

const resolvePieces = (
  blocks: ReadonlyMap<string, RawBlock>,
  inserts: readonly RawInsert[],
  mmPerUnit: number,
  flavour: DxfFlavour,
  issues: ConversionIssue[],
  observations: Map<string, LayerObservation>,
): ResolvedPiece[] => {
  const boundaryLayer = String(layerForConcept('piece-boundary', flavour) ?? 1);
  const resolved: ResolvedPiece[] = [];

  for (const insert of inserts) {
    const block = blocks.get(insert.blockName);
    if (!block) {
      issues.push({
        severity: 'error',
        code: 'unresolved-insert',
        message: `INSERT references block "${insert.blockName}", which has no BLOCK definition.`,
      });
      continue;
    }

    /** Block-local DXF coordinates → placed, millimetre, y-down piece space. */
    const toPieceSpace = (v: Vec2): Vec2 => ({
      x: (v.x - block.basePoint.x + insert.insertionPoint.x) * mmPerUnit,
      // DXF is y-up; this app's piece space is y-down (piece.ts). Negating Y
      // here — once, at the file boundary — is what keeps "up" in the source
      // pattern "up" on screen, rather than importing every piece upside down.
      y: -(v.y - block.basePoint.y + insert.insertionPoint.y) * mmPerUnit,
    });

    let boundaryRuns = block.polylines.filter((p) => p.layer === boundaryLayer);
    let boundaryLayerUsed = boundaryLayer;
    if (boundaryRuns.length === 0 && block.polylines.length > 0) {
      const fallback = block.polylines[0]!;
      boundaryRuns = [fallback];
      boundaryLayerUsed = fallback.layer;
      issues.push({
        severity: 'warning',
        code: 'boundary-layer-mismatch',
        message: `"${block.name}": no polyline on the mapped piece-boundary layer ("${boundaryLayer}", unverified — see layerMapping.ts); used its only polyline instead, on layer "${fallback.layer}".`,
      });
    }
    if (boundaryRuns.length === 0) {
      issues.push({
        severity: 'error',
        code: 'no-boundary-polyline',
        message: `"${block.name}": no polyline geometry at all; nothing to import.`,
      });
      continue;
    }

    const chain = chainBoundary(boundaryRuns);
    if (chain.joined > 1) {
      issues.push({
        severity: 'info',
        code: 'boundary-runs-joined',
        message: `"${block.name}": the outline was written as ${chain.joined} separate polylines on layer "${boundaryLayerUsed}", laid head-to-tail; they were joined into one boundary.`,
      });
    }
    if (chain.unjoined > 0) {
      issues.push({
        severity: 'warning',
        code: 'extra-polylines-ignored',
        message: `"${block.name}": ${chain.unjoined} polyline(s) on the boundary layer do not continue from the end of the previous one and were left out. They may be a second loop, an internal line on the wrong layer, or a gap in the source outline — none of which this importer will guess between.`,
      });
    }
    const otherPolylines = block.polylines.length - boundaryRuns.length;
    if (otherPolylines > 0) {
      issues.push({
        severity: 'warning',
        code: 'extra-polylines-ignored',
        message: `"${block.name}": ${otherPolylines} polyline(s) on other layers were not imported. Internal lines, sew lines and annotation paths are not read yet.`,
      });
    }

    const cleaned = cleanRing(chain.vertices.map(toPieceSpace), issues, block.name);

    if (cleaned.length < 3) {
      issues.push({
        severity: 'error',
        code: 'degenerate-boundary',
        message: `"${block.name}": fewer than 3 distinct points after removing duplicates; cannot form a piece.`,
      });
      continue;
    }
    for (let i = 0; i < chain.joined; i += 1) tally(observations, boundaryLayerUsed, 'POLYLINE', 'outline');

    // LINE entities: kept as geometry, with no claim about what they mean.
    // The layer numbers say "grain line" and "grade reference" in the table,
    // but that table is unverified and this file puts a LINE on both — so
    // they land as construction lines (drawn, never cut) and the layer
    // report says exactly where they came from. Guessing "grain" here and
    // being wrong means a garment cut off-grain.
    const constructionLines = block.lines.map(
      (line) => [toPieceSpace(line.start), toPieceSpace(line.end)] as const,
    );
    for (const line of block.lines) tally(observations, line.layer, 'LINE', 'construction');

    const { fields, unknown } = parseKeyValueTexts(block.texts);
    for (const text of block.texts) {
      const isField = text.value.indexOf(':') > 0;
      tally(observations, text.layer, 'TEXT', isField ? 'metadata' : 'skipped');
    }
    if (unknown.size > 0) {
      issues.push({
        severity: 'info',
        code: 'unknown-metadata-field',
        message: `"${block.name}": text field(s) ${[...unknown]
          .map(([k, v]) => `"${k}: ${v}"`)
          .join(', ')} are not fields this importer reads; left in the file untouched.`,
      });
    }

    const quantityField = fields.get('Quantity');
    const parsedQuantity = quantityField === undefined ? {} : parseQuantity(quantityField);
    if (parsedQuantity.ignoredFields !== undefined) {
      issues.push({
        severity: 'warning',
        code: 'quantity-field-ambiguous',
        message: `"${block.name}": read cut quantity ${parsedQuantity.quantity} from "Quantity:${quantityField}". The remaining field(s) (${parsedQuantity.ignoredFields}) are not interpreted — that value reads as either a decimal comma or a pair, and only the first number means the same thing under both.`,
      });
    }

    const rotation = fields.get('Rotation');
    if (rotation !== undefined && Number(rotation) !== 0) {
      issues.push({
        severity: 'warning',
        code: 'rotation-not-applied',
        message: `"${block.name}": carries "Rotation:${rotation}" as text, but its INSERT states no rotation. The piece was placed exactly as its coordinates give it; nothing was rotated.`,
      });
    }

    // POINT markers. Only the three layers a real file has actually shown in
    // use are read, and only into what that layer's binding already claims —
    // a notch on the notch layer, a marker point on the turn/curve layers.
    // Every other POINT layer keeps the old behaviour: warned and skipped.
    const markers: ResolvedMarker[] = [];
    const unreadPointLayers = new Map<string, number>();
    for (const point of block.points) {
      const concept = conceptForLayer(Number(point.layer), flavour);
      if (concept === 'notch' || concept === 'turn-point' || concept === 'curve-point') {
        markers.push({ concept, position: toPieceSpace(point.position) });
        tally(observations, point.layer, 'POINT', concept === 'notch' ? 'notch' : 'marker');
      } else {
        unreadPointLayers.set(point.layer, (unreadPointLayers.get(point.layer) ?? 0) + 1);
        tally(observations, point.layer, 'POINT', 'skipped');
      }
    }
    for (const [layer, count] of unreadPointLayers) {
      issues.push({
        severity: 'warning',
        code: 'unsupported-entity',
        message: `"${block.name}": ${count} POINT entit${count === 1 ? 'y' : 'ies'} on layer "${layer}" — that layer has no binding this importer reads points for; skipped.`,
      });
    }

    const ruleNumbers = ruleNumbersForBoundary(
      block.texts,
      boundaryLayerUsed,
      cleaned,
      toPieceSpace,
      issues,
      block.name,
    );

    const rawCategory = fields.get('Category');
    const category = parseCategory(rawCategory);
    if (rawCategory !== undefined && category === undefined) {
      issues.push({
        severity: 'info',
        code: 'category-not-a-known-category',
        message: `"${block.name}": "Category: ${rawCategory}" names the piece's role, not one of this model's cut categories (${PIECE_CATEGORIES.join('/')}); kept as the piece description and category left at 'shell'.`,
      });
    }
    // Free text the model has exactly one slot for. Everything the file says
    // about the piece that is not a modelled field lands here rather than
    // being dropped, in a stable order.
    const sizeName = fields.get('Size');
    const descriptionParts: string[] = [];
    const annotation = fields.get('Annotation');
    if (annotation !== undefined) descriptionParts.push(annotation);
    if (rawCategory !== undefined && category === undefined) {
      descriptionParts.push(`Category: ${rawCategory}`);
    }
    if (sizeName !== undefined) descriptionParts.push(`Size Name: ${sizeName}`);

    resolved.push({
      name: fields.get('Piece Name') ?? block.name,
      code: block.name,
      points: cleaned,
      constructionLines,
      markers,
      ruleNumbers,
      ...(parsedQuantity.quantity !== undefined ? { quantity: parsedQuantity.quantity } : {}),
      ...(sizeName !== undefined ? { sizeName } : {}),
      ...(fields.has('Fabric') ? { fabric: fields.get('Fabric')! } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(descriptionParts.length > 0 ? { description: descriptionParts.join(' · ') } : {}),
    });
  }

  const inserted = new Set(inserts.map((i) => i.blockName));
  for (const name of blocks.keys()) {
    if (!inserted.has(name)) {
      issues.push({
        severity: 'info',
        code: 'block-not-placed',
        message: `Block "${name}" is defined but never placed with INSERT; not imported.`,
      });
    }
  }

  return resolved;
};

/* --- Build the pattern document ------------------------------------------ */

/**
 * How far, in millimetres, a notch POINT may sit from the boundary and still
 * be treated as a notch *on* it.
 *
 * A notch marks a spot on the seam, so its coordinate should land on the
 * outline. Real files put it within rounding distance; a point further off
 * than this is something else — an internal mark, a mis-layered drill — and
 * snapping it to the nearest seam would silently move it. Half a millimetre
 * is tight enough that nothing lands here by accident and loose enough to
 * absorb a writer that rounds to four decimal inches.
 */
const NOTCH_SNAP_MM = 0.5;

/**
 * The depth `addNotch` gives a notch when nothing specifies one. Mirrored here
 * only so a diagnostic can say the number out loud; `pattern/edit.ts` remains
 * the one place that decides it.
 */
const NOTCH_DEPTH_DEFAULT_MM = 6;

/**
 * Anchors notch markers to the boundary segment they sit on.
 *
 * The model stores a notch as (segment, t) rather than a coordinate — that is
 * the property that lets it ride reshaping and grading — so an imported point
 * has to be projected onto its segment. Every boundary segment here is a
 * straight line, so this is a closest-point-on-segment search and the `t` it
 * yields is exact rather than approximated.
 *
 * Kind, depth, width and angle are *not* in the file. They come from the
 * app's own documented `addNotch` defaults (a conventional 6 × 2 mm slit), so
 * the one place that decides what an unspecified notch looks like stays the
 * one place — this importer does not invent a second convention.
 */
const attachNotches = (
  piece: PatternPiece,
  markers: readonly ResolvedMarker[],
  issues: ConversionIssue[],
): PatternPiece => {
  const byId = new Map(piece.points.map((p) => [p.id, p.position]));
  let result = piece;
  const offBoundary: number[] = [];

  // The file repeats a notch point verbatim in places, the same way it repeats
  // a `# N` rule text. Two notches at one coordinate is noise, not two marks.
  const distinct: ResolvedMarker[] = [];
  for (const marker of markers) {
    if (marker.concept !== 'notch') continue;
    const seen = distinct.some(
      (m) =>
        Math.abs(m.position.x - marker.position.x) <= VERTEX_EPSILON_MM &&
        Math.abs(m.position.y - marker.position.y) <= VERTEX_EPSILON_MM,
    );
    if (!seen) distinct.push(marker);
  }

  for (const marker of distinct) {

    let best: { segmentId: SegmentId; t: number; distance: number } | null = null;
    for (const segmentId of piece.boundary) {
      const segment = piece.segments.find((s) => s.id === segmentId);
      if (!segment) continue;
      const a = byId.get(segment.from);
      const b = byId.get(segment.to);
      if (!a || !b) continue;

      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      // A zero-length segment has no direction to project onto; its distance
      // is just the distance to the point, at t = 0.
      const t =
        lengthSquared === 0
          ? 0
          : Math.min(1, Math.max(0, ((marker.position.x - a.x) * dx + (marker.position.y - a.y) * dy) / lengthSquared));
      const closest = { x: a.x + dx * t, y: a.y + dy * t };
      const distance = Math.hypot(marker.position.x - closest.x, marker.position.y - closest.y);
      if (!best || distance < best.distance) best = { segmentId, t, distance };
    }

    if (!best || best.distance > NOTCH_SNAP_MM) {
      offBoundary.push(best?.distance ?? Number.POSITIVE_INFINITY);
      continue;
    }
    const added = addNotch(result, best.segmentId, best.t);
    if (added) result = added.piece;
  }

  if (offBoundary.length > 0) {
    const min = Math.min(...offBoundary);
    const max = Math.max(...offBoundary);
    const spread = min.toFixed(2) === max.toFixed(2) ? `${min.toFixed(2)}mm` : `${min.toFixed(2)}–${max.toFixed(2)}mm`;
    issues.push({
      severity: 'warning',
      code: 'notch-marker-off-boundary',
      pieceId: piece.id,
      message:
        `"${piece.name}": ${offBoundary.length} notch-layer point(s) sit ${spread} inside the outline rather than on it, and were not turned into notches. ` +
        `In the file this was built against they pair one-to-one with the on-seam points at a constant offset, which is what a notch *depth* marker looks like — but the file never says so, and reading a depth off a distance would be a guess. ` +
        `The notches themselves were placed from the on-seam points, at this app's default ${NOTCH_DEPTH_DEFAULT_MM}mm depth.`,
    });
  }

  return result;
};

const buildPiece = (resolved: ResolvedPiece, issues: ConversionIssue[]): PatternPiece => {
  const pieceId = createId('dxf-piece');
  const points: PiecePoint[] = resolved.points.map((position) => ({
    id: createId(`${pieceId}-p`),
    position,
    role: 'corner',
  }));
  const segments: PieceSegment[] = points.map((point, i) => ({
    id: createId(`${pieceId}-s`),
    from: point.id,
    to: points[(i + 1) % points.length]!.id,
    geometry: LINE,
  }));

  // A LINE becomes two `construction` points and a drawn-not-cut internal
  // line. `construction` keeps them off the outline, so `boundary` above is
  // unaffected by their presence, and `cut: false` means no cutter will ever
  // follow one on the strength of a layer number we have not verified.
  const internalLines: InternalLine[] = resolved.constructionLines.map(([start, end]) => {
    const from: PiecePoint = { id: createId(`${pieceId}-p`), position: start, role: 'construction' };
    const to: PiecePoint = { id: createId(`${pieceId}-p`), position: end, role: 'construction' };
    points.push(from, to);
    return {
      id: createId(`${pieceId}-il`),
      role: 'construction',
      points: [from.id, to.id],
      closed: false,
      cut: false,
    };
  });

  // Turn/curve POINT markers become `construction` points: their position is
  // exactly what the file states, and `construction` keeps them off the
  // outline, which is already complete. Labelled so the role the layer claims
  // survives into the document rather than being flattened to "a point".
  for (const marker of resolved.markers) {
    if (marker.concept === 'notch') continue;
    points.push({
      id: createId(`${pieceId}-p`),
      position: marker.position,
      role: 'construction',
      label: marker.concept === 'turn-point' ? 'Turn point' : 'Curve point',
    });
  }

  const piece: PatternPiece = {
    id: pieceId,
    name: resolved.name,
    points,
    segments,
    boundary: segments.map((s) => s.id),
    closed: true,
    // No allowance signal exists in any fixture's data (a boundary polyline,
    // no seam-line layer read) — 0 is the honest "net line only" reading, not
    // a placeholder; see the 'no-seam-allowance-source' issue.
    seamAllowance: 0,
    notches: [],
    internalLines,
    meta: {
      code: resolved.code,
      // Defaults where the file says nothing, and are flagged as defaults
      // rather than presented as read. A file that *does* state a value —
      // quantity, fabric, a real cut category — gets its own.
      category: resolved.category ?? 'shell',
      fabric: resolved.fabric ?? '',
      quantity: resolved.quantity ?? 1,
      onFold: false,
      mirrored: false,
      ...(resolved.description !== undefined ? { description: resolved.description } : {}),
    },
  };

  return attachNotches(piece, resolved.markers, issues);
};

/**
 * Attaches a companion rule table's grading to already-built geometry.
 *
 * Kept as a separate pass, after the pieces exist, for a reason: grading here
 * is *association*, not construction. Each boundary point already carries the
 * rule number the DXF wrote beside it; this resolves those numbers against the
 * table and sets `gradeRuleId`. No coordinate moves. If the table is missing,
 * unreadable, or names rules the geometry never references, the geometry is
 * returned exactly as it came in and the mismatch is reported.
 */
const applyRuleTable = (
  pieces: readonly PatternPiece[],
  resolved: readonly ResolvedPiece[],
  payload: string | undefined,
  issues: ConversionIssue[],
): {
  readonly pieces: readonly PatternPiece[];
  readonly rules: readonly GradeRule[];
  readonly sizeRange: SizeRange | null;
} => {
  const referenced = new Set<number>();
  for (const piece of resolved) {
    for (const number of piece.ruleNumbers) if (number !== undefined) referenced.add(number);
  }

  if (payload === undefined) {
    if (referenced.size > 0) {
      issues.push({
        severity: 'warning',
        code: 'grade-rules-not-resolved',
        message: `${referenced.size} grade rule number(s) are marked on the geometry, but no companion .RUL rule table was supplied, so none could be resolved. The numbers alone say which points grade together, not by how much — import the style's .RUL alongside the DXF to get the actual grading.`,
      });
    }
    return { pieces, rules: [], sizeRange: null };
  }

  const table = parseRuleTable(payload);
  issues.push(...table.issues);
  if (table.rules.length === 0) return { pieces, rules: [], sizeRange: null };

  const missing = [...referenced].filter((n) => !table.byNumber.has(n)).sort((a, b) => a - b);
  if (missing.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'grade-rule-missing-from-table',
      message: `The geometry references rule(s) ${missing.join(', ')}, which the companion rule table does not define. Points carrying them were left ungraded rather than attached to a neighbouring rule.`,
    });
  }

  // `resolved[i]` built `pieces[i]`, and its boundary points are the first
  // `resolved[i].points.length` entries of that piece — construction points
  // are appended after. That ordering is `buildPiece`'s, right above.
  const graded = pieces.map((piece, i) => {
    const numbers = resolved[i]?.ruleNumbers ?? [];
    if (numbers.every((n) => n === undefined)) return piece;
    return {
      ...piece,
      points: piece.points.map((point, j) => {
        const rule = numbers[j] === undefined ? undefined : table.byNumber.get(numbers[j]!);
        return rule ? { ...point, gradeRuleId: rule.id } : point;
      }),
    };
  });

  const attached = graded.reduce(
    (sum, piece) => sum + piece.points.filter((p) => p.gradeRuleId !== undefined).length,
    0,
  );
  issues.push({
    severity: 'info',
    code: 'grade-rules-attached',
    message: `${attached} point(s) across ${graded.length} piece(s) were linked to grade rules from the companion table.`,
  });

  return { pieces: graded, rules: table.rules, sizeRange: table.sizeRange };
};

const nowIso = (): string => new Date().toISOString();

/** A layer observation plus what the (unverified) table says about that layer. */
export interface LayerUsageRow extends LayerObservation {
  /** Concept the table maps this layer to; null when the layer is unmapped. */
  readonly concept: PatternConcept | null;
  /**
   * Whether the table lists this entity kind for this layer; null when the
   * layer has no binding at all. `false` is the structured form of the
   * `layer-entity-conflict` warning — same rule, same evidence.
   */
  readonly tableAgrees: boolean | null;
}

/** Everything one import produced: the document, and the account of itself. */
export interface DxfImportResult {
  readonly document: PatternDocument;
  readonly issues: readonly ConversionIssue[];
  /**
   * Every (layer, entity kind) pair the file used and how each was treated —
   * the structured form of the `layer-usage` diagnostic, in the same stable
   * order. This is what an import UI should render its support summary from;
   * parsing the diagnostic's message string back apart would be the fragile
   * version of the same information.
   */
  readonly layers: readonly LayerUsageRow[];
}

/**
 * Full import with diagnostics — the richer sibling of `importDxf`.
 *
 * `FormatAdapter.deserialize` (the interface the format registry calls
 * through) can only return a bare `PatternDocument`, so `importDxf` below
 * exists for that contract; this is for anyone who wants the issues too —
 * today, `check-dxf-import.ts` and the import review dialog.
 */
export const importDxfWithDiagnostics = (
  payload: string,
  options: DxfImportOptions,
): DxfImportResult => {
  const issues: ConversionIssue[] = [];

  let parsed: ParsedFile;
  try {
    const tokens = tokenizeDxf(payload);
    parsed = parseSections(new TokenCursor(tokens), issues);
  } catch (error) {
    throw new FormatParseError(
      DXF_FLAVOUR_LABEL[options.flavour],
      error instanceof Error ? error.message : String(error),
    );
  }

  const unverified = unverifiedBindings(options.flavour);
  const allBindings = layerMapFor(options.flavour);
  const bindingCount = allBindings.length;
  const observedCount = allBindings.filter((b) => (b.observedInFixtures?.length ?? 0) > 0).length;
  const contradictedCount = allBindings.filter((b) => (b.conflictingEvidence?.length ?? 0) > 0).length;
  const untestedCount = allBindings.filter(
    (b) => (b.observedInFixtures?.length ?? 0) === 0 && (b.conflictingEvidence?.length ?? 0) === 0,
  ).length;
  if (unverified.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'unverified-layer-map',
      message: `${unverified.length} of ${bindingCount} layer binding(s) are unverified against ASTM D6673: ${observedCount} have real-file evidence behind them, ${contradictedCount} are actively contradicted by a real file, and ${untestedCount} have never been exercised. Review any concept beyond the outline before cutting from this import.`,
    });
  }

  const observations = new Map<string, LayerObservation>();

  // Style-wide metadata lives as loose TEXT in ENTITIES in at least one real
  // writer's output. Read before units, because `Units:` is one of the fields.
  const { fields: styleFields, unknown: unknownStyleFields } = parseKeyValueTexts(parsed.styleTexts);
  for (const text of parsed.styleTexts) {
    tally(observations, text.layer, 'TEXT', text.value.indexOf(':') > 0 ? 'metadata' : 'skipped');
  }
  if (unknownStyleFields.size > 0) {
    issues.push({
      severity: 'info',
      code: 'unknown-metadata-field',
      message: `Style-level text field(s) ${[...unknownStyleFields]
        .map(([k, v]) => `"${k}: ${v}"`)
        .join(', ')} are not fields this importer reads; left in the file untouched.`,
    });
  }

  const mmPerUnit = resolveUnitFactor(parsed.header, styleFields, options, issues);
  const resolvedPieces = resolvePieces(
    parsed.blocks,
    parsed.inserts,
    mmPerUnit,
    options.flavour,
    issues,
    observations,
  );

  const pieces = resolvedPieces.map((piece) => buildPiece(piece, issues));

  reportLayerUsage([...observations.values()], options.flavour, issues);

  const readFields = [...styleFields.keys()];
  if (readFields.length > 0) {
    issues.push({
      severity: 'info',
      code: 'metadata-read-from-text',
      message: `Style metadata read from the file's own text fields: ${readFields
        .map((k) => `${k}="${styleFields.get(k)}"`)
        .join(', ')}. These are a writer convention rather than anything the format guarantees.`,
    });
  }

  // Only claim the gaps that are actually gaps. Three real writers default
  // different fields, so this is assembled from what was read rather than
  // asserted — telling someone their fabric defaulted when the file states it
  // is the kind of wrong that stops the warning being read at all.
  const defaulted = [
    resolvedPieces.some((p) => p.category !== undefined) ? null : 'category',
    resolvedPieces.some((p) => p.fabric !== undefined) ? null : 'fabric',
    resolvedPieces.some((p) => p.quantity !== undefined) ? null : 'cut quantity',
  ].filter((f): f is string => f !== null);
  if (defaulted.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'metadata-not-in-source',
      message: `${defaulted.join(', ')} ${defaulted.length === 1 ? 'has' : 'have'} no source in this file; every piece took this app's default. Review before this goes to a cutting room.`,
    });
  }

  // A marker/graded file repeats the same piece once per size. Importing them
  // as flat, separate pieces is what the file literally contains; building a
  // graded size range out of them would be inference, and grading is not this
  // module's to invent. Say so instead.
  const bySizeName = new Map<string, Set<string>>();
  for (const piece of resolvedPieces) {
    if (piece.sizeName === undefined) continue;
    const sizes = bySizeName.get(piece.name) ?? new Set<string>();
    sizes.add(piece.sizeName);
    bySizeName.set(piece.name, sizes);
  }
  const repeated = [...bySizeName.entries()].filter(([, sizes]) => sizes.size > 1);
  if (repeated.length > 0) {
    const sizeNames = [...new Set(resolvedPieces.map((p) => p.sizeName).filter(Boolean))];
    issues.push({
      severity: 'warning',
      code: 'sizes-imported-flat',
      message: `This file carries ${repeated.length} piece name(s) once per size (sizes seen: ${sizeNames.join(', ')}). Each placement was imported as its own separate piece, which is what the file contains; they were *not* assembled into a graded size range, because inferring grading from repeated outlines is not something this importer does. Piece names therefore repeat — see each piece's code for the block it came from.`,
    });
  }

  // Companion rule table, when the caller supplied one. Everything above runs
  // identically whether or not it is present — grading is attached to finished
  // geometry, never used to reshape it.
  const grading = applyRuleTable(pieces, resolvedPieces, options.ruleTable, issues);

  const styleName = styleFields.get('Style Name');
  const document: PatternDocument = {
    schemaVersion: PATTERN_SCHEMA_VERSION,
    id: createId('doc-dxf'),
    name: styleName ?? 'Imported pattern',
    style: { code: styleName ?? '', name: styleName ?? 'Imported pattern' },
    unit: 'mm',
    sizeRange: grading.sizeRange ?? {
      baseSizeId: 'size-base',
      sizes: [{ id: 'size-base', label: 'Base', order: 0 }],
    },
    pieces: grading.pieces,
    measurements: [],
    gradeRules: grading.rules,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  issues.push(...validateImportedDocument(document));

  // Applied last, over every issue collected above (parse-time and
  // validateImportedDocument alike) — done as a final map rather than a
  // mutate-as-we-go pass, so it cannot depend on where in the pipeline an
  // issue happened to be pushed. Strict mode means "nothing was silently
  // worked around," which only holds if it sees everything.
  const finalIssues = options.strict
    ? issues.map((issue) => (issue.severity === 'warning' ? { ...issue, severity: 'error' as const } : issue))
    : issues;

  const bindings = layerMapFor(options.flavour);
  const layers = sortObservations([...observations.values()]).map((o): LayerUsageRow => {
    const binding = bindings.find((b) => String(b.layer) === o.layer);
    return {
      ...o,
      concept: binding?.concept ?? null,
      tableAgrees: binding ? binding.entities.includes(o.entity) : null,
    };
  });

  return { document, issues: finalIssues, layers };
};

/**
 * DXF import, matching `FormatAdapter.deserialize`. Throws `FormatParseError`
 * when any collected issue is error-severity — a document that dropped a
 * piece or failed to resolve a block is not returned half-working, per this
 * module's own rule that a converter must not invent or hide geometry.
 * Non-blocking issues (unit assumptions, defaulted metadata, unsupported
 * entities skipped) are real but do not stop the import; call
 * `importDxfWithDiagnostics` to see them.
 */
export const importDxf = (payload: string, options: DxfImportOptions): PatternDocument => {
  const { document, issues } = importDxfWithDiagnostics(payload, options);
  if (blocksConversion(issues)) {
    throw new FormatParseError(DXF_FLAVOUR_LABEL[options.flavour], summariseIssues(issues, options.flavour));
  }
  return document;
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
 * What the real importer above actually does, restated for the command
 * palette / plan UI without parsing anything. Unlike before the parser
 * existed, "no parser" is no longer a blocker — the remaining blocker is the
 * layer table, which is a data problem (needs the ASTM text or more real
 * files), not a code problem.
 */
export const describeImportPlan = (flavour: DxfFlavour): ImportPlan => {
  const layers = layerMapFor(flavour);
  const unverified = unverifiedBindings(flavour);

  const blockers: ConversionIssue[] = [];
  if (unverified.length > 0) {
    blockers.push({
      severity: 'warning',
      code: 'unverified-layer-map',
      message: `${unverified.length} of ${layers.length} layer binding(s) still need checking against the standard. Two real files agree with piece-boundary; three other layers are actively contradicted by a real file, and the rest are simply untested.`,
    });
  }
  const conflicting = layers.filter((b) => (b.conflictingEvidence?.length ?? 0) > 0);
  if (conflicting.length > 0) {
    blockers.push({
      severity: 'warning',
      code: 'layer-table-contradicted',
      message: `${conflicting.length} binding(s) — ${conflicting
        .map((b) => b.concept)
        .join(', ')} — hold entity kinds a real file does not put there. The table was left as it is; see conflictingEvidence in layerMapping.ts.`,
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
      {
        order: 2,
        label: 'Header',
        detail: 'Read $INSUNITS, else the file\'s own "Units:" field, else the assumed unit.',
      },
      { order: 3, label: 'Blocks', detail: 'Group entities by BLOCK — one block per candidate piece.' },
      { order: 4, label: 'Inserts', detail: 'Resolve INSERT placements against their block definitions.' },
      {
        order: 5,
        label: 'Rebuild topology',
        detail: 'Boundary polyline to points and straight-line segments; collapse vertex noise.',
      },
      {
        order: 6,
        label: 'Read metadata',
        detail: 'Take self-labelled "Key:Value" text fields; leave unknown keys alone.',
      },
      { order: 7, label: 'Normalise units', detail: 'Convert all coordinates to millimetres; flip Y to piece space.' },
      {
        order: 8,
        label: 'Report layers',
        detail: 'Say which layers were read, how each was treated, and which contradict the table.',
      },
      { order: 9, label: 'Validate', detail: 'Run import checks and report issues alongside the document.' },
    ],
  };
};
