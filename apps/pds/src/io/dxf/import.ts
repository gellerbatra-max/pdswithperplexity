import { toMillimetres, type Vec2 } from '@/geometry';
import {
  createId,
  LINE,
  PATTERN_SCHEMA_VERSION,
  type InternalLine,
  type PatternDocument,
  type PatternPiece,
  type PiecePoint,
  type PieceSegment,
} from '@/pattern';
import { FormatParseError } from '../errors';
import { layerForConcept, layerMapFor, unverifiedBindings } from './layerMapping';
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
type LayerTreatment = 'outline' | 'construction' | 'metadata' | 'skipped';

const TREATMENT_LABEL: Record<LayerTreatment, string> = {
  outline: 'imported as the piece outline',
  construction: 'imported as construction geometry, with no meaning claimed',
  metadata: 'read as self-labelled metadata',
  skipped: 'not imported',
};

interface LayerObservation {
  readonly layer: string;
  readonly entity: string;
  readonly count: number;
  readonly treatment: LayerTreatment;
}

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
  const sorted = [...observations].sort(
    (a, b) => a.layer.localeCompare(b.layer, 'en', { numeric: true }) || a.entity.localeCompare(b.entity),
  );

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

  return { name, basePoint, polylines, lines, texts };
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

/** Keys this importer understands. Anything else is reported, not guessed at. */
const KNOWN_TEXT_KEYS = new Set([
  'Piece Name',
  'Size Name',
  'Quantity',
  'Rotation',
  'Style Name',
  'Creation Date',
  'Author',
  'Sample Size',
  'Grade Rule Table',
  'Units',
  'ASTM/D13Proposal 1 Version',
]);

/**
 * Splits `Key:Value` TEXT into a lookup. First occurrence of a key wins —
 * these fields are one-per-scope in practice, and silently letting a later
 * duplicate overwrite an earlier one would hide a malformed file.
 */
const parseKeyValueTexts = (
  texts: readonly RawText[],
): { readonly fields: Map<string, string>; readonly unknownKeys: readonly string[] } => {
  const fields = new Map<string, string>();
  const unknownKeys: string[] = [];
  for (const text of texts) {
    const separator = text.value.indexOf(':');
    if (separator <= 0) continue; // '# 0', piece labels, empty strings — not fields
    const key = text.value.slice(0, separator).trim();
    const value = text.value.slice(separator + 1).trim();
    if (!KNOWN_TEXT_KEYS.has(key)) {
      if (!unknownKeys.includes(key)) unknownKeys.push(key);
      continue;
    }
    if (!fields.has(key)) fields.set(key, value);
  }
  return { fields, unknownKeys };
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

interface ResolvedPiece {
  /** The file's own `Piece Name:` when it states one, else the block name. */
  readonly name: string;
  /** Block name — unique per block, so it survives repeated piece names. */
  readonly code: string;
  /** Millimetres, this app's y-down piece space, already cleaned. */
  readonly points: readonly Vec2[];
  /** Straight LINE entities, same space as `points`. Meaning deliberately unclaimed. */
  readonly constructionLines: readonly (readonly [Vec2, Vec2])[];
  readonly quantity?: number;
  /** The file's `Size Name:`, when present — recorded, never used to grade. */
  readonly sizeName?: string;
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

    let boundary = block.polylines.find((p) => p.layer === boundaryLayer);
    if (!boundary && block.polylines.length > 0) {
      boundary = block.polylines[0];
      issues.push({
        severity: 'warning',
        code: 'boundary-layer-mismatch',
        message: `"${block.name}": no polyline on the mapped piece-boundary layer ("${boundaryLayer}", unverified — see layerMapping.ts); used its only polyline instead, on layer "${boundary!.layer}".`,
      });
    }
    if (block.polylines.length > 1) {
      issues.push({
        severity: 'warning',
        code: 'extra-polylines-ignored',
        message: `"${block.name}": ${block.polylines.length} polylines found; only the boundary was imported. Internal lines are not read yet.`,
      });
    }
    if (!boundary) {
      issues.push({
        severity: 'error',
        code: 'no-boundary-polyline',
        message: `"${block.name}": no polyline geometry at all; nothing to import.`,
      });
      continue;
    }

    const cleaned = cleanRing(boundary.vertices.map(toPieceSpace), issues, block.name);

    if (cleaned.length < 3) {
      issues.push({
        severity: 'error',
        code: 'degenerate-boundary',
        message: `"${block.name}": fewer than 3 distinct points after removing duplicates; cannot form a piece.`,
      });
      continue;
    }
    tally(observations, boundary.layer, 'POLYLINE', 'outline');

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

    const { fields, unknownKeys } = parseKeyValueTexts(block.texts);
    for (const text of block.texts) {
      const isField = text.value.indexOf(':') > 0;
      tally(observations, text.layer, 'TEXT', isField ? 'metadata' : 'skipped');
    }
    if (unknownKeys.length > 0) {
      issues.push({
        severity: 'info',
        code: 'unknown-metadata-field',
        message: `"${block.name}": text field(s) ${unknownKeys
          .map((k) => `"${k}"`)
          .join(', ')} are not fields this importer reads; left alone.`,
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

    resolved.push({
      name: fields.get('Piece Name') ?? block.name,
      code: block.name,
      points: cleaned,
      constructionLines,
      ...(parsedQuantity.quantity !== undefined ? { quantity: parsedQuantity.quantity } : {}),
      ...(fields.has('Size Name') ? { sizeName: fields.get('Size Name')! } : {}),
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

const buildPiece = (resolved: ResolvedPiece): PatternPiece => {
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

  return {
    id: pieceId,
    name: resolved.name,
    points,
    segments,
    boundary: segments.map((s) => s.id),
    closed: true,
    // No allowance signal exists in either fixture's data (a plain boundary
    // polyline, no seam-line layer used) — 0 is the honest "net line only"
    // reading, not a placeholder; see the 'no-seam-allowance-source' issue.
    seamAllowance: 0,
    notches: [],
    internalLines,
    meta: {
      code: resolved.code,
      // Category and fabric have no source in either file; 'shell' and ''
      // are the least-assuming defaults and are flagged, not presented as
      // read. Quantity is different — a file that states `Quantity:` gets
      // its own value, and only a file that doesn't falls back to 1.
      category: 'shell',
      fabric: '',
      quantity: resolved.quantity ?? 1,
      onFold: false,
      mirrored: false,
      ...(resolved.sizeName !== undefined ? { description: `Size Name: ${resolved.sizeName}` } : {}),
    },
  };
};

const nowIso = (): string => new Date().toISOString();

/**
 * Full import with diagnostics — the richer sibling of `importDxf`.
 *
 * `FormatAdapter.deserialize` (the interface the format registry calls
 * through) can only return a bare `PatternDocument`, so `importDxf` below
 * exists for that contract; this is for anyone who wants the issues too —
 * today, `check-dxf-import.ts` and, later, an import dialog.
 */
export const importDxfWithDiagnostics = (
  payload: string,
  options: DxfImportOptions,
): { readonly document: PatternDocument; readonly issues: readonly ConversionIssue[] } => {
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
  if (unverified.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'unverified-layer-map',
      message: `${unverified.length} of ${layerMapFor(options.flavour).length} layer binding(s) are unverified against ASTM D6673. Only piece-boundary has real-file evidence behind it (two files, both agreeing), and real files actively contradict the table on three other layers. Review any concept beyond the outline before cutting from this import.`,
    });
  }

  const observations = new Map<string, LayerObservation>();

  // Style-wide metadata lives as loose TEXT in ENTITIES in at least one real
  // writer's output. Read before units, because `Units:` is one of the fields.
  const { fields: styleFields, unknownKeys: unknownStyleKeys } = parseKeyValueTexts(parsed.styleTexts);
  for (const text of parsed.styleTexts) {
    tally(observations, text.layer, 'TEXT', text.value.indexOf(':') > 0 ? 'metadata' : 'skipped');
  }
  if (unknownStyleKeys.length > 0) {
    issues.push({
      severity: 'info',
      code: 'unknown-metadata-field',
      message: `Style-level text field(s) ${unknownStyleKeys
        .map((k) => `"${k}"`)
        .join(', ')} are not fields this importer reads; left alone.`,
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

  const pieces = resolvedPieces.map(buildPiece);

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

  // Only claim the metadata gap when there actually is one. A file that
  // states its own quantity should not be told it defaulted to ×1.
  const quantityRead = resolvedPieces.some((p) => p.quantity !== undefined);
  issues.push({
    severity: 'warning',
    code: 'metadata-not-in-source',
    message: quantityRead
      ? `Fabric and category have no source in this file; every piece defaulted to 'shell' / ''. Cut quantity was read from the file. Review before this goes to a cutting room.`
      : `Fabric, category and quantity have no source in this file; every piece defaulted to 'shell' / '' / ×1. Review before this goes to a cutting room.`,
  });

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

  const styleName = styleFields.get('Style Name');
  const document: PatternDocument = {
    schemaVersion: PATTERN_SCHEMA_VERSION,
    id: createId('doc-dxf'),
    name: styleName ?? 'Imported pattern',
    style: { code: styleName ?? '', name: styleName ?? 'Imported pattern' },
    unit: 'mm',
    sizeRange: { baseSizeId: 'size-base', sizes: [{ id: 'size-base', label: 'Base', order: 0 }] },
    pieces,
    measurements: [],
    gradeRules: [],
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

  return { document, issues: finalIssues };
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
