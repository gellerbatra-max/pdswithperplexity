import { toMillimetres, type Vec2 } from '@/geometry';
import {
  createId,
  LINE,
  PATTERN_SCHEMA_VERSION,
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
 * placement, and $INSUNITS for scale. Every other entity kind (LINE, ARC,
 * POINT, TEXT, LWPOLYLINE, CIRCLE, SPLINE, …) is recognised structurally —
 * the walker never desyncs on one — but its *content* is not interpreted.
 * Encountering one produces a warning (or an error under `options.strict`)
 * naming the entity and where it was found, never a silent drop.
 *
 * That is a deliberate scope limit, not an oversight: `layerMapping.ts` lists
 * eleven pattern concepts (notches, grain, internal lines, drill holes, …)
 * and only `piece-boundary` has ever been checked against a real file. Adding
 * support for the other ten now would mean guessing at their entity shape
 * from the ASTM text and industry convention alone — exactly the "silently
 * wrong in someone else's CAD" failure this module exists to avoid. Each one
 * gets built when a real file proves what it actually looks like. See
 * DEVELOPMENT.md.
 *
 * ## What this does, precisely
 *
 *  1. Tokenise the ASCII group-code stream (`tokenizer.ts`).
 *  2. Read HEADER for `$INSUNITS`; fall back to `options.assumeUnit` (default
 *     mm) with a warning if it is absent or an unrecognised code.
 *  3. Read BLOCKS: one BLOCK is one candidate piece. A block's first polyline
 *     on the mapped piece-boundary layer becomes the outline; a block with no
 *     polyline on that layer falls back to its only polyline with a warning,
 *     rather than dropping a real piece over an unverified layer number.
 *  4. Read ENTITIES for INSERT placements. Only a block that is actually
 *     inserted becomes a piece — a BLOCK with no INSERT contributes nothing
 *     to the drawing, which is also how AutoCAD treats it.
 *  5. Resolve each piece's vertices: translate by (insertion − base point),
 *     flip Y (DXF is y-up; this app's piece space is y-down, see
 *     `piece.ts`), convert to millimetres, and collapse the vertex noise
 *     real exports carry — a repeated point mid-polyline (export artefact)
 *     and the closing point that duplicates the first (this app's model
 *     represents "closed" with the `closed` flag, not a repeated point).
 *  6. Every vertex becomes a `corner` point joined by straight `LINE`
 *     segments. This is not a simplification: the file itself carries no
 *     curve entities, only densely-sampled polylines, so a corner-and-lines
 *     reading is the exact content of the file, not a guess at which
 *     vertices were meant to be smooth.
 *  7. Run `validateImportedDocument` and return the document with every
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
const skipEntity = (cursor: TokenCursor): string => {
  const marker = cursor.next();
  while (!cursor.done() && cursor.peek()!.code !== 0) cursor.next();
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

const resolveUnitFactor = (
  header: ReadonlyMap<string, readonly DxfToken[]>,
  options: DxfImportOptions,
  issues: ConversionIssue[],
): number => {
  const insunits = header.get('$INSUNITS')?.find((t) => t.code === 70);
  const fallback = (reason: string): number => {
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

interface RawBlock {
  readonly name: string;
  readonly basePoint: Vec2;
  readonly polylines: readonly RawPolyline[];
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
  if (cursor.at('SEQEND')) cursor.next();

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
  while (!cursor.done() && !cursor.at('ENDBLK')) {
    if (cursor.at('POLYLINE')) {
      cursor.next();
      polylines.push(readPolyline(cursor));
    } else {
      const kind = skipEntity(cursor);
      issues.push({
        severity: 'warning',
        code: 'unsupported-entity',
        message: `Block "${name}": entity "${kind}" is not supported yet and was skipped.`,
      });
    }
  }
  if (cursor.at('ENDBLK')) cursor.next();

  return { name, basePoint, polylines };
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

const readEntitiesSection = (cursor: TokenCursor, issues: ConversionIssue[]): RawInsert[] => {
  const inserts: RawInsert[] = [];
  while (!cursor.done() && !cursor.at('ENDSEC')) {
    if (cursor.at('INSERT')) {
      cursor.next();
      inserts.push(readInsert(cursor, issues));
    } else {
      const kind = skipEntity(cursor);
      issues.push({
        severity: 'warning',
        code: 'unsupported-entity',
        message: `ENTITIES: "${kind}" was placed directly (not via a BLOCK/INSERT pair) and is not supported yet; skipped.`,
      });
    }
  }
  return inserts;
};

/* --- Driver ------------------------------------------------------------- */

interface ParsedFile {
  readonly header: Map<string, DxfToken[]>;
  readonly blocks: Map<string, RawBlock>;
  readonly inserts: readonly RawInsert[];
}

const parseSections = (cursor: TokenCursor, issues: ConversionIssue[]): ParsedFile => {
  let header = new Map<string, DxfToken[]>();
  let blocks = new Map<string, RawBlock>();
  let inserts: RawInsert[] = [];

  while (!cursor.done()) {
    const token = cursor.next();
    if (token.code === 0 && token.value === 'EOF') break;
    if (token.code !== 0 || token.value !== 'SECTION') continue; // ignore stray tokens between sections

    const nameToken = cursor.peek();
    const name = nameToken?.code === 2 ? cursor.next().value : '';

    if (name === 'HEADER') header = readHeader(cursor);
    else if (name === 'BLOCKS') blocks = readBlocksSection(cursor, issues);
    else if (name === 'ENTITIES') inserts = readEntitiesSection(cursor, issues);
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

  return { header, blocks, inserts };
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
  readonly name: string;
  /** Millimetres, this app's y-down piece space, already cleaned. */
  readonly points: readonly Vec2[];
}

const resolvePieces = (
  blocks: ReadonlyMap<string, RawBlock>,
  inserts: readonly RawInsert[],
  mmPerUnit: number,
  flavour: DxfFlavour,
  issues: ConversionIssue[],
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

    const world = boundary.vertices.map((v) => ({
      x: v.x - block.basePoint.x + insert.insertionPoint.x,
      y: v.y - block.basePoint.y + insert.insertionPoint.y,
    }));
    // DXF is y-up; this app's piece space is y-down (piece.ts). Negating Y
    // here — once, at the file boundary — is what keeps "up" in the source
    // pattern "up" on screen, rather than importing every piece upside down.
    const mm = world.map((v) => ({ x: v.x * mmPerUnit, y: -v.y * mmPerUnit }));
    const cleaned = cleanRing(mm, issues, block.name);

    if (cleaned.length < 3) {
      issues.push({
        severity: 'error',
        code: 'degenerate-boundary',
        message: `"${block.name}": fewer than 3 distinct points after removing duplicates; cannot form a piece.`,
      });
      continue;
    }

    resolved.push({ name: block.name, points: cleaned });
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

  return {
    id: pieceId,
    name: resolved.name,
    points,
    segments,
    boundary: segments.map((s) => s.id),
    closed: true,
    // No allowance signal exists in this file's data (a plain boundary
    // polyline, no seam-line layer used) — 0 is the honest "net line only"
    // reading, not a placeholder; see the 'no-seam-allowance-source' issue.
    seamAllowance: 0,
    notches: [],
    internalLines: [],
    meta: {
      code: resolved.name,
      // The file carries no fabric, category or quantity signal at all —
      // 'shell' and empty/1 are the least-assuming defaults, flagged below
      // rather than presented as read.
      category: 'shell',
      fabric: '',
      quantity: 1,
      onFold: false,
      mirrored: false,
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
      message: `${unverified.length} of ${layerMapFor(options.flavour).length} layer binding(s) are unverified against ASTM D6673 (only piece-boundary has been checked, against a real file). Review any concept beyond the outline before cutting from this import.`,
    });
  }

  const mmPerUnit = resolveUnitFactor(parsed.header, options, issues);
  const resolvedPieces = resolvePieces(parsed.blocks, parsed.inserts, mmPerUnit, options.flavour, issues);

  const pieces = resolvedPieces.map(buildPiece);
  issues.push({
    severity: 'warning',
    code: 'metadata-not-in-source',
    message: `Fabric, category and quantity have no source in this file; every piece defaulted to 'shell' / '' / ×1. Review before this goes to a cutting room.`,
  });

  const document: PatternDocument = {
    schemaVersion: PATTERN_SCHEMA_VERSION,
    id: createId('doc-dxf'),
    name: 'Imported pattern',
    style: { code: '', name: 'Imported pattern' },
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
      message: `${unverified.length} of ${layers.length} layer binding(s) still need checking against the standard (piece-boundary is confirmed against a real file; the rest are not read yet).`,
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
      { order: 2, label: 'Header', detail: 'Read $INSUNITS; fall back to the assumed unit if absent.' },
      { order: 3, label: 'Blocks', detail: 'Group entities by BLOCK — one block per candidate piece.' },
      { order: 4, label: 'Inserts', detail: 'Resolve INSERT placements against their block definitions.' },
      {
        order: 5,
        label: 'Rebuild topology',
        detail: 'Boundary polyline to points and straight-line segments; collapse vertex noise.',
      },
      { order: 6, label: 'Normalise units', detail: 'Convert all coordinates to millimetres; flip Y to piece space.' },
      { order: 7, label: 'Validate', detail: 'Run import checks and report issues alongside the document.' },
    ],
  };
};
