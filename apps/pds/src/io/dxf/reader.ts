import type { Vec2 } from '@/geometry';
import type { SegmentGeometry } from '@/pattern';
import { tokenNumber, type DxfToken } from './tokenizer';
import type { ConversionIssue } from './types';

/**
 * The DXF *reader*: group-code stream → raw entity records, faithfully.
 *
 * This module is deliberately dumb. It knows the DXF container format — how a
 * section, a block, an entity and its fields are delimited — and it knows the
 * group codes of the entity kinds this importer reads. It does **not** know
 * what any of it means: no layer semantics, no units, no piece topology, no
 * coordinate flips. Everything it returns is in the file's own space, exactly
 * as written. `import.ts` owns every interpretation.
 *
 * The split follows the failure modes. Reader bugs are desyncs — a cursor
 * left mid-entity, a field taken for a marker — and are caught by "the walker
 * never crashes and never mislabels an entity" tests. Interpretation bugs are
 * wrong meaning — a flipped sweep, a misassigned layer — and are caught by
 * geometry assertions. Keeping the layers apart keeps a fix in one from
 * quietly changing the other.
 *
 * Reading style, shared by every `read*` below: consume fields until the next
 * `0`-coded token, take the codes you know, skip the rest without comment.
 * Unknown *fields* are normal DXF (writers emit handles, colours, linetypes
 * we have no use for); unknown *entities* are reported — by the walker, which
 * is the only place that can see one go past.
 */

/* --- Token cursor --------------------------------------------------------- */

/**
 * A read position over the token stream. Every section/entity reader below
 * takes one of these and advances it; nothing here re-parses from an index
 * threaded through function arguments, which is how a walker like this one
 * quietly desyncs.
 */
export class TokenCursor {
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


/* --- BLOCKS ----------------------------------------------------------------
 *
 * A BLOCK is a named, reusable piece of geometry defined in its own local
 * space; ENTITIES places it with INSERT. That two-step indirection is DXF's
 * own structure, not an apparel convention — every block here becomes a
 * *candidate* piece, and only the ones actually inserted survive into the
 * document (§ "Resolve" below).
 */

export interface RawPolyline {
  readonly layer: string;
  readonly vertices: readonly RawVertex[];
  /** Position within its block. Boundary chaining is file-order only. */
  readonly order: number;
  /**
   * Which entity kind wrote this run. A format fact, not an interpretation —
   * it exists so the layer report can say `LWPOLYLINE` when that is what the
   * file contains, instead of flattening every run to `POLYLINE`.
   */
  readonly entity: string;
  /**
   * Bit 0 of group 70: the writer says this polyline closes on itself.
   * Recorded, not obeyed — real writers use it three different ways (one
   * repeats the closing vertex too, one sets only the flag, one leaves both
   * off open chain fragments), so what closure *means* is `import.ts`'s
   * decision. What the file literally said is this field's.
   */
  readonly closedFlag: boolean;
}

/**
 * One polyline vertex, and the shape of the segment *leaving* it.
 *
 * DXF puts a segment's curvature on its start vertex (group 42, the bulge), so
 * that is where it lives here too rather than being paired off into edges the
 * file never wrote. `geometry`, when set, is a curve already resolved from a
 * standalone entity (an ARC or SPLINE) and takes precedence over `bulge`.
 */
export interface RawVertex {
  readonly position: Vec2;
  /** `tan(theta/4)`; 0 is a straight segment, which is the overwhelming case. */
  readonly bulge: number;
  readonly geometry?: SegmentGeometry;
}

/** A two-point LINE. What it *means* depends on its layer — see `LayerReport`. */
export interface RawLine {
  readonly layer: string;
  readonly start: Vec2;
  readonly end: Vec2;
}

/** A POINT marker. Its layer is the only thing that says what it marks. */
export interface RawPoint {
  readonly layer: string;
  readonly position: Vec2;
}

/** A TEXT entity's literal string (group 1) and where it sits. */
export interface RawText {
  readonly layer: string;
  readonly value: string;
  readonly position: Vec2;
}

export interface RawBlock {
  readonly name: string;
  readonly basePoint: Vec2;
  readonly polylines: readonly RawPolyline[];
  readonly lines: readonly RawLine[];
  readonly texts: readonly RawText[];
  readonly points: readonly RawPoint[];
  readonly arcs: readonly RawArc[];
  readonly splines: readonly RawSpline[];
}

const readVertex = (cursor: TokenCursor): RawVertex => {
  let x = 0;
  let y = 0;
  let bulge = 0;
  while (!cursor.done() && cursor.peek()!.code !== 0) {
    const token = cursor.next();
    if (token.code === 10) x = tokenNumber(token);
    else if (token.code === 20) y = tokenNumber(token);
    // Group 42 is the bulge *only* on a VERTEX. The same code means view
    // height on a VPORT and width factor on a STYLE — a distinction worth
    // keeping, since scanning a whole file for code 42 finds all three.
    else if (token.code === 42) bulge = tokenNumber(token);
    // 8 (layer), 30 (z), 70 (vertex flags) — not meaningful for a flat 2D outline.
  }
  return { position: { x, y }, bulge };
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

/** Raw ARC entity fields. Converted to endpoint form by `curves.ts`. */
export interface RawArc {
  readonly layer: string;
  readonly order: number;
  readonly centre: Vec2;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

/** Raw SPLINE entity fields, enough to evaluate the curve. */
export interface RawSpline {
  readonly layer: string;
  readonly order: number;
  readonly degree: number;
  readonly closed: boolean;
  readonly controlPoints: readonly Vec2[];
  readonly knots: readonly number[];
  readonly weights: readonly number[];
}

const readArc = (cursor: TokenCursor, order: number): RawArc => {
  let layer = '0';
  let centre: Vec2 = { x: 0, y: 0 };
  let radius = 0;
  let startAngle = 0;
  let endAngle = 0;
  while (!cursor.done() && cursor.peek()!.code !== 0) {
    const token = cursor.next();
    if (token.code === 8) layer = token.value;
    else if (token.code === 10) centre = { ...centre, x: tokenNumber(token) };
    else if (token.code === 20) centre = { ...centre, y: tokenNumber(token) };
    else if (token.code === 40) radius = tokenNumber(token);
    else if (token.code === 50) startAngle = tokenNumber(token);
    else if (token.code === 51) endAngle = tokenNumber(token);
  }
  return { layer, order, centre, radius, startAngle, endAngle };
};

/**
 * SPLINE's control points and knots interleave: group 10/20 repeat per control
 * point, 40 repeats per knot, 41 per weight. They are collected as three
 * independent runs, which is how the format writes them — pairing them up by
 * adjacency is how a reader ends up one knot out.
 */
const readSpline = (cursor: TokenCursor, order: number): RawSpline => {
  let layer = '0';
  let degree = 3;
  let flags = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  const knots: number[] = [];
  const weights: number[] = [];
  while (!cursor.done() && cursor.peek()!.code !== 0) {
    const token = cursor.next();
    if (token.code === 8) layer = token.value;
    else if (token.code === 70) flags = tokenNumber(token);
    else if (token.code === 71) degree = tokenNumber(token);
    else if (token.code === 10) xs.push(tokenNumber(token));
    else if (token.code === 20) ys.push(tokenNumber(token));
    else if (token.code === 40) knots.push(tokenNumber(token));
    else if (token.code === 41) weights.push(tokenNumber(token));
    // 11/21 (fit points), 12/13 (tangents), 42/43/44 (tolerances) — the
    // control points define the curve; fit points are what it was fitted to.
  }
  const controlPoints = xs.map((x, i) => ({ x, y: ys[i] ?? 0 }));
  return { layer, order, degree, closed: (flags & 1) === 1, controlPoints, knots, weights };
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

const readPolyline = (cursor: TokenCursor, order: number): RawPolyline => {
  let layer = '0';
  let closedFlag = false;
  while (!cursor.done() && cursor.peek()!.code !== 0) {
    const token = cursor.next();
    if (token.code === 8) layer = token.value;
    else if (token.code === 70) closedFlag = (tokenNumber(token) & 1) === 1;
    // 66 (entities-follow) — vertices follow as entities either way in every
    // observed file.
  }

  const vertices: RawVertex[] = [];
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

  return { layer, vertices, order, closedFlag, entity: 'POLYLINE' };
};

/**
 * LWPOLYLINE: the lightweight, single-entity form of POLYLINE.
 *
 * Where POLYLINE writes each vertex as its own entity (VERTEX … SEQEND),
 * LWPOLYLINE inlines them as repeating groups on one entity: each `10` opens
 * a new vertex, and the `20` and `42` (bulge) that follow attach to it. That
 * makes the vertex boundary *positional* — a `20` or `42` arriving before any
 * `10` has nothing to attach to, and inventing a vertex for it would be
 * fabricating geometry, so orphaned fields are counted and reported instead.
 *
 * The declared vertex count (`90`) is checked against what was actually
 * parsed. A mismatch does not block the read — the vertices that exist are
 * real either way — but it is exactly the kind of quiet malformation worth a
 * warning, because a writer that miscounts its own vertices may have dropped
 * one.
 *
 * Returns null for an entity with no vertices at all: there is nothing to
 * import, and an empty run spliced into a boundary chain would break the
 * chain for every run after it.
 */
const readLwPolyline = (
  cursor: TokenCursor,
  order: number,
  issues: ConversionIssue[],
  blockName: string,
): RawPolyline | null => {
  let layer = '0';
  let closedFlag = false;
  let declaredCount: number | null = null;
  let orphanedFields = 0;
  const vertices: RawVertex[] = [];
  /** The vertex the next 20/42 attaches to — the one the last `10` opened. */
  let current: { x: number; y: number; bulge: number } | null = null;

  const finish = (): void => {
    if (current) vertices.push({ position: { x: current.x, y: current.y }, bulge: current.bulge });
    current = null;
  };

  while (!cursor.done() && cursor.peek()!.code !== 0) {
    const token = cursor.next();
    if (token.code === 8) layer = token.value;
    else if (token.code === 90) declaredCount = tokenNumber(token);
    else if (token.code === 70) closedFlag = (tokenNumber(token) & 1) === 1;
    else if (token.code === 10) {
      finish();
      current = { x: tokenNumber(token), y: 0, bulge: 0 };
    } else if (token.code === 20) {
      if (current) current.y = tokenNumber(token);
      else orphanedFields += 1;
    } else if (token.code === 42) {
      if (current) current.bulge = tokenNumber(token);
      else orphanedFields += 1;
    }
    // 40/41 (start/end width), 38 (elevation), 39 (thickness) — no use here.
  }
  finish();

  if (orphanedFields > 0) {
    issues.push({
      severity: 'warning',
      code: 'lwpolyline-orphaned-fields',
      message: `Block "${blockName}": an LWPOLYLINE carries ${orphanedFields} vertex field(s) (20/42) before any vertex was opened with a 10 — they attach to nothing and were dropped rather than turned into invented vertices.`,
    });
  }
  if (declaredCount !== null && declaredCount !== vertices.length) {
    issues.push({
      severity: 'warning',
      code: 'lwpolyline-vertex-count-mismatch',
      message: `Block "${blockName}": an LWPOLYLINE declares ${declaredCount} vertices (group 90) but carries ${vertices.length}. The ${vertices.length} that exist were read; a writer that miscounts its own vertices may have dropped one.`,
    });
  }
  if (vertices.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'lwpolyline-empty',
      message: `Block "${blockName}": an LWPOLYLINE with no vertices at all was skipped — nothing to read, and an empty run would break the boundary chain behind it.`,
    });
    return null;
  }

  return { layer, vertices, order, closedFlag, entity: 'LWPOLYLINE' };
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
  const arcs: RawArc[] = [];
  const splines: RawSpline[] = [];
  // Boundary chaining joins runs in the order the file wrote them, and a block
  // may interleave polylines with arcs and splines. Collecting each kind into
  // its own array loses that order, so it is stamped on the way past.
  let order = 0;
  while (!cursor.done() && !cursor.at('ENDBLK')) {
    if (cursor.at('POLYLINE')) {
      cursor.next();
      polylines.push(readPolyline(cursor, order));
      order += 1;
    } else if (cursor.at('LINE')) {
      cursor.next();
      lines.push(readLine(cursor));
    } else if (cursor.at('TEXT')) {
      cursor.next();
      texts.push(readText(cursor));
    } else if (cursor.at('POINT')) {
      cursor.next();
      points.push(readPoint(cursor));
    } else if (cursor.at('ARC')) {
      cursor.next();
      arcs.push(readArc(cursor, order));
      order += 1;
    } else if (cursor.at('SPLINE')) {
      cursor.next();
      splines.push(readSpline(cursor, order));
      order += 1;
    } else if (cursor.at('LWPOLYLINE')) {
      cursor.next();
      const lwPolyline = readLwPolyline(cursor, order, issues, name);
      if (lwPolyline) polylines.push(lwPolyline);
      order += 1;
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

  return { name, basePoint, polylines, lines, texts, points, arcs, splines };
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

export interface RawInsert {
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
    // An error, not a warning, and deliberately so: a piece placed unscaled
    // or unrotated when its INSERT says otherwise is not a degraded import,
    // it is a different garment that looks plausible on screen. Refusing is
    // the only honest option until transforms are actually applied. No
    // vendor pattern export on hand carries one (125 files surveyed — the
    // only INSERT transforms found anywhere were in another tool's synthetic
    // fixtures), so nothing real is being turned away.
    issues.push({
      severity: 'error',
      code: 'insert-transform-unsupported',
      message: `INSERT of "${blockName}" carries a scale or rotation (group code(s) ${transform
        .map((t) => t.code)
        .join(', ')}). Applying it is not implemented, and importing the block unscaled and unrotated would produce wrong geometry that looks right — so this file is refused rather than imported wrong.`,
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

export interface ParsedFile {
  readonly header: Map<string, DxfToken[]>;
  readonly blocks: Map<string, RawBlock>;
  readonly inserts: readonly RawInsert[];
  readonly styleTexts: readonly RawText[];
}

export const parseSections = (cursor: TokenCursor, issues: ConversionIssue[]): ParsedFile => {
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
