import type { Vec2 } from '@/geometry';
import { findIncrement, type GradeRule, type SizeRange } from './grading';
import type { SizeId } from './ids';
import type { PatternPiece, PiecePoint, PieceSegment } from './piece';

/**
 * Mock grading: apply each point's grade rule as a plain translation.
 *
 * This is deliberately not correct grading. A real grader moves points along
 * construction lines, keeps curves smooth through the nest, and preserves seam
 * lengths between mating pieces — none of that happens here. What this gives is
 * a nest with the right *shape of data* so the interaction model, the overlay
 * and the inspector can be built and exercised before the solver exists.
 *
 * TODO(grading-math): replace `buildGraded` with a real solver — move points
 * along their construction lines, re-fit curves through the nest rather than
 * translating control handles, and keep mating seam lengths equal across sizes.
 * The public surface (gradePiece / nestPiece / gradeVectors) should not change.
 * See DEVELOPMENT.md.
 */

const translate = (v: Vec2, dx: number, dy: number): Vec2 => ({ x: v.x + dx, y: v.y + dy });

interface Delta {
  readonly dx: number;
  readonly dy: number;
}

const ZERO: Delta = { dx: 0, dy: 0 };

/** Displacement for one point at one size. Ungraded points do not move. */
export const pointDelta = (
  point: PiecePoint,
  rules: readonly GradeRule[],
  sizeId: SizeId,
): Delta => {
  if (!point.gradeRuleId) return ZERO;
  const rule = rules.find((r) => r.id === point.gradeRuleId);
  if (!rule) return ZERO;
  const increment = findIncrement(rule, sizeId);
  return increment ? { dx: increment.dx, dy: increment.dy } : ZERO;
};

const buildGraded = (
  piece: PatternPiece,
  rules: readonly GradeRule[],
  sizeId: SizeId,
): PatternPiece => {
  const deltas = new Map<string, Delta>();
  const points: PiecePoint[] = piece.points.map((point) => {
    const delta = pointDelta(point, rules, sizeId);
    deltas.set(point.id, delta);
    return { ...point, position: translate(point.position, delta.dx, delta.dy) };
  });

  const segments: PieceSegment[] = piece.segments.map((segment) => {
    if (segment.geometry.kind !== 'cubic') return segment;

    // Control handles are absolute, so they have to move with their endpoints.
    // Averaging the two endpoint deltas keeps the curve attached at both ends;
    // a real solver would re-fit the curve instead.
    const from = deltas.get(segment.from) ?? ZERO;
    const to = deltas.get(segment.to) ?? ZERO;
    const dx = (from.dx + to.dx) / 2;
    const dy = (from.dy + to.dy) / 2;

    return {
      ...segment,
      geometry: {
        ...segment.geometry,
        control1: translate(segment.geometry.control1, dx, dy),
        control2: translate(segment.geometry.control2, dx, dy),
      },
    };
  });

  return { ...piece, points, segments };
};

/*
 * Nesting is recomputed whenever the camera moves, so it is cached. Pieces and
 * rule arrays are immutable, which makes them valid cache keys: any edit
 * produces new objects and misses.
 */
const cache = new WeakMap<
  PatternPiece,
  WeakMap<readonly GradeRule[], Map<SizeId, PatternPiece>>
>();

export const gradePiece = (
  piece: PatternPiece,
  rules: readonly GradeRule[],
  sizeId: SizeId,
): PatternPiece => {
  let byRules = cache.get(piece);
  if (!byRules) {
    byRules = new WeakMap();
    cache.set(piece, byRules);
  }

  let bySize = byRules.get(rules);
  if (!bySize) {
    bySize = new Map();
    byRules.set(rules, bySize);
  }

  const cached = bySize.get(sizeId);
  if (cached) return cached;

  const graded = buildGraded(piece, rules, sizeId);
  bySize.set(sizeId, graded);
  return graded;
};

export interface NestedSize {
  readonly sizeId: SizeId;
  readonly label: string;
  readonly isBase: boolean;
  readonly piece: PatternPiece;
}

/** The full nest for one piece, in size order. */
export const nestPiece = (
  piece: PatternPiece,
  rules: readonly GradeRule[],
  sizeRange: SizeRange,
): readonly NestedSize[] =>
  [...sizeRange.sizes]
    .sort((a, b) => a.order - b.order)
    .map((size) => ({
      sizeId: size.id,
      label: size.label,
      isBase: size.id === sizeRange.baseSizeId,
      piece: gradePiece(piece, rules, size.id),
    }));

export interface GradeVector {
  readonly pointId: string;
  readonly from: Vec2;
  readonly to: Vec2;
}

/**
 * Movement of each graded point across the whole range, smallest size to
 * largest — the arrow a grader reads to see which way a point travels.
 */
export const gradeVectors = (
  piece: PatternPiece,
  rules: readonly GradeRule[],
  sizeRange: SizeRange,
): readonly GradeVector[] => {
  const ordered = [...sizeRange.sizes].sort((a, b) => a.order - b.order);
  const smallest = ordered[0];
  const largest = ordered[ordered.length - 1];
  if (!smallest || !largest || smallest.id === largest.id) return [];

  const out: GradeVector[] = [];
  for (const point of piece.points) {
    if (!point.gradeRuleId || point.role === 'construction') continue;
    const a = pointDelta(point, rules, smallest.id);
    const b = pointDelta(point, rules, largest.id);
    if (a.dx === b.dx && a.dy === b.dy) continue;
    out.push({
      pointId: point.id,
      from: translate(point.position, a.dx, a.dy),
      to: translate(point.position, b.dx, b.dy),
    });
  }
  return out;
};
