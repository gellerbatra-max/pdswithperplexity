/**
 * The DXF import pipeline.
 *
 * parse → flatten INSERTs → stitch contours → deduplicate → convert units →
 * decompose → tray pieces. Every stage is pure, so the whole import runs in a
 * test with no worker and no DOM.
 */

import { decompose } from '@/marker/convex';
import type { Point, TrayPiece } from '@/marker/schema';
import { areaOf, chainPaths, type Path } from './contours';
import { parseDocument } from './parse';
import { resolvePaths, type Attributes, type ResolvedPath } from './resolve';
import { parseRul, type RulTable } from './rul';

export interface ImportedPiece extends TrayPiece {
  /**
   * Convex parts of `geometry`, for the SAT narrow phase. Derived data, so it
   * is carried on the import result rather than stored on the document.
   */
  readonly convexParts: Point[][];
}

export interface DxfImportResult {
  readonly pieces: ImportedPiece[];
  readonly warnings: string[];
  readonly units: 'cm' | 'in';
  readonly gradeRules: RulTable | null;
}

const INCHES_TO_CM = 2.54;

/**
 * A pattern piece measured in inches is a small number; the same piece in
 * centimetres is not. Nothing real is under 25 cm across its longest span, and
 * nothing real is over 25 inches on a single piece either.
 */
const UNIT_THRESHOLD = 25;

/** Rounding used when comparing two outlines. 0.1 mm in cm units. */
const COMPARE_PRECISION = 100;

const NAME_TAGS = ['PIECE NAME', 'PIECE_NAME', 'PIECENAME', 'NAME'];
const SIZE_TAGS = ['SIZE', 'PIECE SIZE'];
const BUNDLE_TAGS = ['BUNDLE', 'BUNDLE CODE', 'BUNDLE_CODE'];

const firstTag = (attributes: Attributes, tags: readonly string[]): string | undefined => {
  for (const tag of tags) {
    const value = attributes.get(tag);
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return undefined;
};

/** Pieces are grouped by whatever identifies them: block first, then layer. */
const groupKeyOf = (path: ResolvedPath): string =>
  path.block !== '' ? `block:${path.block}` : `layer:${path.layer}`;

const extentOf = (points: readonly Point[]): number => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return Math.max(maxX - minX, maxY - minY);
};

/**
 * A rotation-independent fingerprint of an outline.
 *
 * Rounded to 0.1 mm, translated to its own origin, and rotated so the
 * lexicographically smallest vertex comes first — so the same piece exported
 * twice from different starting vertices compares equal.
 */
const fingerprint = (points: readonly Point[]): string => {
  if (points.length === 0) return '';
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
  }

  const normalised = points.map((point) => ({
    x: Math.round((point.x - minX) * COMPARE_PRECISION),
    y: Math.round((point.y - minY) * COMPARE_PRECISION),
  }));

  let start = 0;
  for (let i = 1; i < normalised.length; i += 1) {
    const candidate = normalised[i];
    const best = normalised[start];
    if (!candidate || !best) continue;
    if (candidate.x < best.x || (candidate.x === best.x && candidate.y < best.y)) start = i;
  }

  const rotated: string[] = [];
  for (let i = 0; i < normalised.length; i += 1) {
    const point = normalised[(start + i) % normalised.length];
    if (point) rotated.push(`${point.x},${point.y}`);
  }
  return rotated.join(' ');
};

const scalePoints = (points: readonly Point[], factor: number): Point[] =>
  points.map((point) => ({ x: point.x * factor, y: point.y * factor }));

/** Move an outline so its bounding box starts at the origin, as TrayPiece requires. */
const toOrigin = (points: readonly Point[]): Point[] => {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
  }
  return points.map((point) => ({ x: point.x - minX, y: point.y - minY }));
};

export const importDxf = (dxfText: string, rulText?: string): DxfImportResult => {
  const warnings: string[] = [];

  const document = parseDocument(dxfText);
  if (document.entities.length === 0 && document.blocks.size === 0) {
    warnings.push('No entities or blocks found — is this a DXF file?');
    return { pieces: [], warnings, units: 'cm', gradeRules: null };
  }

  const resolved = resolvePaths(document);
  warnings.push(...resolved.warnings);

  // Group first, then stitch: a chain must never join two different pieces.
  const grouped = new Map<string, ResolvedPath[]>();
  for (const path of resolved.paths) {
    const key = groupKeyOf(path);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(path);
    else grouped.set(key, [path]);
  }

  interface Candidate {
    outline: Point[];
    attributes: Attributes;
    key: string;
    layer: string;
    block: string;
  }

  const candidates: Candidate[] = [];

  for (const [key, paths] of grouped) {
    const stitched: Path[] = chainPaths(paths);
    const closed = stitched.filter((path) => path.closed && path.points.length >= 3);

    if (closed.length === 0) {
      warnings.push(`${key}: no closed outline after stitching; skipped`);
      continue;
    }

    // The largest closed loop is the boundary; smaller ones are notches,
    // drill holes and internal marks, which this step does not carry.
    let boundary = closed[0];
    if (!boundary) continue;
    for (const path of closed) {
      if (areaOf(path.points) > areaOf(boundary.points)) boundary = path;
    }
    if (closed.length > 1) {
      warnings.push(
        `${key}: kept the largest of ${closed.length} closed loops; internal marks dropped`,
      );
    }

    const first = paths[0];
    candidates.push({
      outline: boundary.points,
      attributes: first?.attributes ?? new Map(),
      key,
      layer: first?.layer ?? '0',
      block: first?.block ?? '',
    });
  }

  // Capability 4: drop identical outlines, which duplicated layers produce.
  const seen = new Map<string, string>();
  const unique: Candidate[] = [];
  for (const candidate of candidates) {
    const print = fingerprint(candidate.outline);
    const existing = seen.get(print);
    if (existing !== undefined) {
      warnings.push(`${candidate.key}: identical outline to ${existing}; duplicate dropped`);
      continue;
    }
    seen.set(print, candidate.key);
    unique.push(candidate);
  }

  // Capability 6: one unit decision for the whole file, from its largest piece.
  const largest = unique.reduce((max, candidate) => Math.max(max, extentOf(candidate.outline)), 0);
  const units: 'cm' | 'in' = largest > 0 && largest < UNIT_THRESHOLD ? 'in' : 'cm';
  const factor = units === 'in' ? INCHES_TO_CM : 1;
  if (units === 'in') {
    warnings.push(
      `Largest piece spans ${largest.toFixed(1)} units; read as inches and converted to cm`,
    );
  }

  const pieces: ImportedPiece[] = unique.map((candidate, index) => {
    const geometry = toOrigin(scalePoints(candidate.outline, factor));

    // Capability 9: split concave outlines so SAT stays sound.
    const decomposition = decompose(geometry);
    if (!decomposition.ok) {
      warnings.push(
        `${candidate.key}: outline could not be split into convex parts; collision will be conservative`,
      );
    }

    const name =
      firstTag(candidate.attributes, NAME_TAGS) ??
      (candidate.block !== '' ? candidate.block : candidate.layer);

    return {
      id: `dxf-${index}-${candidate.key}`,
      name,
      size: firstTag(candidate.attributes, SIZE_TAGS) ?? '',
      bundle: firstTag(candidate.attributes, BUNDLE_TAGS) ?? '',
      fabricCode: 'A',
      geometry,
      layDirection: '2way',
      quantity: 1,
      placed: 0,
      convexParts: decomposition.parts,
    };
  });

  if (pieces.length === 0) warnings.push('No pieces could be built from this file');

  let gradeRules: RulTable | null = null;
  if (rulText !== undefined && rulText.trim() !== '') {
    gradeRules = parseRul(rulText);
    warnings.push(...gradeRules.warnings);
  }

  return { pieces, warnings, units, gradeRules };
};
