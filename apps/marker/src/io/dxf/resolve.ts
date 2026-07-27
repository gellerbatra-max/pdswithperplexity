/**
 * Flattening the DXF entity tree into world-space paths.
 *
 * A factory DXF nests pieces inside blocks, blocks inside blocks, each placed
 * by an INSERT that translates, rotates and sometimes mirrors. This walks that
 * tree and hands back plain paths with the metadata attached.
 *
 * Pure, and deliberately forgiving: a missing block or a circular reference
 * produces a warning and a skipped piece, never a thrown error. Factory files
 * are routinely imperfect and a whole marker must not fail on one bad block.
 */

import type { Point } from '@/marker/schema';
import { expandVertices, type Path, type VertexWithBulge } from './contours';
import { layerOf, numberOf, valueOf, type DxfDocument, type DxfEntity } from './parse';

/** 2×3 affine transform: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export interface Matrix {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

export const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export const compose = (outer: Matrix, inner: Matrix): Matrix => ({
  a: outer.a * inner.a + outer.c * inner.b,
  b: outer.b * inner.a + outer.d * inner.b,
  c: outer.a * inner.c + outer.c * inner.d,
  d: outer.b * inner.c + outer.d * inner.d,
  e: outer.a * inner.e + outer.c * inner.f + outer.e,
  f: outer.b * inner.e + outer.d * inner.f + outer.f,
});

export const apply = (matrix: Matrix, point: Point): Point => ({
  x: matrix.a * point.x + matrix.c * point.y + matrix.e,
  y: matrix.b * point.x + matrix.d * point.y + matrix.f,
});

/** A negative scale on one axis only — the mirror case. */
export const isMirrored = (matrix: Matrix): boolean =>
  matrix.a * matrix.d - matrix.b * matrix.c < 0;

const insertMatrix = (entity: DxfEntity, basePoint: Point): Matrix => {
  const scaleX = numberOf(entity, 41, 1);
  const scaleY = numberOf(entity, 42, 1);
  const rotation = (numberOf(entity, 50, 0) * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  // Scale about the block's base point, then rotate, then translate to the
  // insertion point. Mirroring falls out of a negative scale.
  const translate: Matrix = {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: numberOf(entity, 10, 0),
    f: numberOf(entity, 20, 0),
  };
  const rotate: Matrix = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  const scale: Matrix = {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    e: -basePoint.x * scaleX,
    f: -basePoint.y * scaleY,
  };

  return compose(translate, compose(rotate, scale));
};

const verticesOfLwPolyline = (entity: DxfEntity): VertexWithBulge[] => {
  const vertices: VertexWithBulge[] = [];
  let x: number | null = null;
  let y: number | null = null;
  let bulge = 0;

  const flush = () => {
    if (x === null || y === null) return;
    vertices.push({ x, y, bulge });
    x = null;
    y = null;
    bulge = 0;
  };

  // Codes arrive in vertex order; a 10 opens a vertex and the next 10 closes it.
  for (const pair of entity.pairs) {
    if (pair.code === 10) {
      flush();
      x = Number.parseFloat(pair.value);
    } else if (pair.code === 20) {
      y = Number.parseFloat(pair.value);
    } else if (pair.code === 42) {
      bulge = Number.parseFloat(pair.value);
    }
  }
  flush();

  return vertices.filter((vertex) => Number.isFinite(vertex.x) && Number.isFinite(vertex.y));
};

const verticesOfPolyline = (entity: DxfEntity): VertexWithBulge[] =>
  entity.children
    .filter((child) => child.type === 'VERTEX')
    .map((child) => ({
      x: numberOf(child, 10, Number.NaN),
      y: numberOf(child, 20, Number.NaN),
      bulge: numberOf(child, 42, 0),
    }))
    .filter((vertex) => Number.isFinite(vertex.x) && Number.isFinite(vertex.y));

/** Attribute tags carried by an INSERT, upper-cased for matching. */
export type Attributes = ReadonlyMap<string, string>;

const attributesOf = (entity: DxfEntity): Attributes => {
  const attributes = new Map<string, string>();
  for (const child of entity.children) {
    if (child.type !== 'ATTRIB') continue;
    const tag = valueOf(child, 2);
    const value = valueOf(child, 1);
    if (tag !== undefined && value !== undefined) attributes.set(tag.toUpperCase(), value);
  }
  return attributes;
};

export interface ResolvedPath extends Path {
  readonly layer: string;
  /** Block that produced this path, or '' for a top-level entity. */
  readonly block: string;
  readonly attributes: Attributes;
}

interface ResolveState {
  readonly document: DxfDocument;
  readonly warnings: string[];
  /** Blocks currently being expanded — the cycle guard. */
  readonly openBlocks: Set<string>;
}

const MAX_DEPTH = 32;

const resolveEntities = (
  entities: readonly DxfEntity[],
  matrix: Matrix,
  block: string,
  attributes: Attributes,
  state: ResolveState,
  depth: number,
): ResolvedPath[] => {
  if (depth > MAX_DEPTH) {
    state.warnings.push(`Block nesting deeper than ${MAX_DEPTH} levels; stopped descending`);
    return [];
  }

  const paths: ResolvedPath[] = [];

  for (const entity of entities) {
    if (entity.type === 'LINE') {
      const from = { x: numberOf(entity, 10, Number.NaN), y: numberOf(entity, 20, Number.NaN) };
      const to = { x: numberOf(entity, 11, Number.NaN), y: numberOf(entity, 21, Number.NaN) };
      if (![from.x, from.y, to.x, to.y].every(Number.isFinite)) continue;
      paths.push({
        points: [apply(matrix, from), apply(matrix, to)],
        closed: false,
        layer: layerOf(entity),
        block,
        attributes,
      });
      continue;
    }

    if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
      const vertices =
        entity.type === 'LWPOLYLINE' ? verticesOfLwPolyline(entity) : verticesOfPolyline(entity);
      if (vertices.length < 2) continue;

      const closed = (numberOf(entity, 70, 0) & 1) === 1;
      const expanded = expandVertices(vertices, closed);
      if (expanded.length < 2) continue;

      paths.push({
        points: expanded.map((point) => apply(matrix, point)),
        closed,
        layer: layerOf(entity),
        block,
        attributes,
      });
      continue;
    }

    if (entity.type === 'INSERT') {
      const name = valueOf(entity, 2) ?? '';
      const target = state.document.blocks.get(name);

      if (!target) {
        state.warnings.push(`INSERT references missing block "${name}"; piece skipped`);
        continue;
      }
      if (state.openBlocks.has(name)) {
        state.warnings.push(`Block "${name}" inserts itself; recursion stopped`);
        continue;
      }

      const child = compose(matrix, insertMatrix(entity, target.basePoint));
      const merged = new Map(attributes);
      for (const [tag, value] of attributesOf(entity)) merged.set(tag, value);

      state.openBlocks.add(name);
      paths.push(
        ...resolveEntities(target.entities, child, name, merged, state, depth + 1),
      );
      state.openBlocks.delete(name);
    }
  }

  return paths;
};

export interface ResolveResult {
  readonly paths: ResolvedPath[];
  readonly warnings: string[];
}

/** Flatten a parsed document into world-space paths. */
export const resolvePaths = (document: DxfDocument): ResolveResult => {
  const state: ResolveState = { document, warnings: [], openBlocks: new Set() };
  const paths = resolveEntities(document.entities, IDENTITY, '', new Map(), state, 0);
  return { paths, warnings: state.warnings };
};
