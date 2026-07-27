import type { Vec2 } from '@/geometry';
import { findIncrement, type GradeDiagnostic, type GradeRule, type SizeRange } from './grading';
import type { PieceId, SizeId } from './ids';
import type { PatternDocument } from './document';
import type { PatternPiece, PiecePoint, PieceSegment } from './piece';
import { segmentLength } from './resolve';

/**
 * Grading: point-and-rule propagation over a piece.
 *
 * Every outline, construction and grain point that carries a `gradeRuleId`
 * moves by that rule's increment for the requested size; everything else
 * holds its base position. That is the whole model — it is what apparel
 * grading actually is (a "grade rule table" of per-point X/Y increments is
 * the standard technique real CAD systems use, not a simplification of one),
 * so this file does not pretend to be a constraint solver. What it *was*
 * missing, and now is not:
 *
 * - Cubic handles moved by the *average* of their two endpoints' deltas,
 *   which is not how any other edit in this app moves a handle — everywhere
 *   else, `control1` follows `from` and `control2` follows `to` (see
 *   `pattern/edit.ts`'s `moveGeometry`). Averaging pivots the curve toward
 *   whichever end graded less whenever the two ends carry different rules,
 *   which is the ordinary case, not an edge case. Handles now follow their
 *   own anchor, exactly like every other geometry edit in the kernel.
 * - Arc segments were silently untouched — not wrong, since a fixed radius
 *   while the endpoints move is a legitimate, common grading convention (the
 *   curve keeps its own shape rather than scaling with the body), but
 *   undocumented and unverified. That policy is now explicit below, and
 *   `gradeDiagnostics` reports the one way it can go visibly wrong: a grade
 *   aggressive enough to open the endpoints past twice the radius, which
 *   forces `arcCentre`'s repair clamp and quietly turns a gentle bow into a
 *   forced semicircle.
 *
 * What is still an approximation, stated rather than hidden: nothing here
 * keeps two mating seams the same length across the range, or moves a point
 * along a construction line instead of by a raw X/Y offset. `gradeDiagnostics`
 * flags the first of those when it happens; neither is silently corrected.
 *
 * TODO(grading-solver): a real solver moves points along construction lines
 * and re-fits curves through the nest instead of translating raw X/Y offsets,
 * and reconciles `mateSegmentId` pairs so they grade to equal lengths instead
 * of merely flagging when they don't. Keep the public surface — `gradePiece`,
 * `nestPiece`, `gradeVectors`, `gradeDiagnostics` — so the overlay, drawer,
 * inspector and diagnostics panel keep working while the internals change.
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
    // Arc geometry carries no absolute coordinates — radius, largeArc and
    // clockwise describe the circle, not a position — so there is nothing
    // here to translate. The endpoints move because the *points* moved
    // above; the arc keeps its own radius through that, which is the stated
    // policy this file documents rather than hides.
    if (segment.geometry.kind !== 'cubic') return segment;

    const from = deltas.get(segment.from) ?? ZERO;
    const to = deltas.get(segment.to) ?? ZERO;

    // Each handle follows the endpoint it belongs to, exactly like a manual
    // drag (`pattern/edit.ts`'s `moveGeometry`) — not an average of both
    // endpoints' movement, which used to pivot the curve toward whichever
    // side graded less.
    return {
      ...segment,
      geometry: {
        ...segment.geometry,
        control1: translate(segment.geometry.control1, from.dx, from.dy),
        control2: translate(segment.geometry.control2, to.dx, to.dy),
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

/* --- Diagnostics -------------------------------------------------------- */

/**
 * How far apart, in millimetres, two mating seams may drift across a size
 * before it is worth a flag. Not a tolerance the geometry is checked against
 * elsewhere in this app — grading two independently-ruled pieces essentially
 * never lands two seams on the exact same length, so a zero tolerance would
 * flag every mated pair at every size. This is the threshold past which the
 * mismatch is plausibly a cutting problem rather than rounding.
 */
const MATING_LENGTH_TOLERANCE_MM = 1;

/** How far past `2 × radius` a graded chord may open before it is flagged. */
const ARC_REPAIR_TOLERANCE_MM = 1e-6;

const gradedSizes = (sizeRange: SizeRange): readonly { readonly id: SizeId; readonly label: string }[] =>
  sizeRange.sizes.filter((size) => size.id !== sizeRange.baseSizeId);

/**
 * Arcs whose radius the stated grading policy could not honour.
 *
 * Holding an arc's radius constant while its endpoints grade is a real,
 * deliberate policy (see the module doc above) — it only breaks down when a
 * size grades the chord open past twice the radius, at which point
 * `arcCentre` (in `curve.ts`) has to enlarge the effective radius just to
 * reach both endpoints, silently turning a gentle bow into a forced
 * semicircle. This reports exactly that case, for exactly the sizes it
 * happens at, rather than leaving it for someone to notice on a cut piece.
 */
const arcRadiusDiagnostics = (
  piece: PatternPiece,
  rules: readonly GradeRule[],
  sizeRange: SizeRange,
): readonly GradeDiagnostic[] => {
  const out: GradeDiagnostic[] = [];
  const arcSegments = piece.segments.filter((s) => s.geometry.kind === 'arc');
  if (arcSegments.length === 0) return out;

  for (const size of gradedSizes(sizeRange)) {
    const graded = gradePiece(piece, rules, size.id);
    for (const segment of arcSegments) {
      if (segment.geometry.kind !== 'arc') continue;
      const gradedSegment = graded.segments.find((s) => s.id === segment.id);
      const from = graded.points.find((p) => p.id === segment.from);
      const to = graded.points.find((p) => p.id === segment.to);
      if (!gradedSegment || gradedSegment.geometry.kind !== 'arc' || !from || !to) continue;

      const chord = Math.hypot(to.position.x - from.position.x, to.position.y - from.position.y);
      const radius = Math.abs(gradedSegment.geometry.radius);
      if (chord / 2 <= radius + ARC_REPAIR_TOLERANCE_MM) continue;

      out.push({
        id: `grade-arc-repair:${piece.id}:${segment.id}:${size.id}`,
        severity: 'warning',
        code: 'grade-arc-repair',
        label: 'Arc radius could not hold',
        detail: `${piece.name} · ${segment.label ?? 'edge'} grades to a ${chord.toFixed(1)}mm chord at ${size.label}, wider than twice its ${radius.toFixed(1)}mm radius — it draws as the shortest arc that still reaches both ends, not the shape drawn at base size.`,
        pieceId: piece.id,
        segmentId: segment.id,
        sizeId: size.id,
      });
    }
  }

  return out;
};

/** A segment plus the piece it lives on, for a mate lookup across the document. */
const findSegmentInDocument = (
  document: PatternDocument,
  segmentId: string,
): { readonly piece: PatternPiece; readonly segment: PieceSegment } | null => {
  for (const piece of document.pieces) {
    const segment = piece.segments.find((s) => s.id === segmentId);
    if (segment) return { piece, segment };
  }
  return null;
};

/**
 * Mated seams whose graded lengths pull apart.
 *
 * Nothing in `buildGraded` keeps a `mateSegmentId` pair the same length
 * across a size — each side grades from its own piece's own rules, with no
 * knowledge the other exists. That is a real, stated limitation (see the
 * module doc), and this is what makes it visible instead of leaving a
 * grader to discover it by walking the seam on a cut sample.
 */
const matingSeamDiagnostics = (document: PatternDocument, pieceId?: PieceId): readonly GradeDiagnostic[] => {
  const out: GradeDiagnostic[] = [];
  const pieces = pieceId ? document.pieces.filter((p) => p.id === pieceId) : document.pieces;

  for (const piece of pieces) {
    for (const segment of piece.segments) {
      if (!segment.mateSegmentId) continue;
      const mate = findSegmentInDocument(document, segment.mateSegmentId);
      if (!mate) continue;

      for (const size of gradedSizes(document.sizeRange)) {
        const gradedPiece = gradePiece(piece, document.gradeRules, size.id);
        const gradedMatePiece = gradePiece(mate.piece, document.gradeRules, size.id);
        const gradedSegment = gradedPiece.segments.find((s) => s.id === segment.id);
        const gradedMateSegment = gradedMatePiece.segments.find((s) => s.id === mate.segment.id);
        if (!gradedSegment || !gradedMateSegment) continue;

        const length = segmentLength(gradedPiece, gradedSegment);
        const mateLength = segmentLength(gradedMatePiece, gradedMateSegment);
        const diff = Math.abs(length - mateLength);
        if (diff <= MATING_LENGTH_TOLERANCE_MM) continue;

        out.push({
          id: `grade-mate-mismatch:${piece.id}:${segment.id}:${size.id}`,
          severity: 'error',
          code: 'grade-mate-mismatch',
          label: 'Mated seams diverge',
          detail: `${piece.name} · ${segment.label ?? 'edge'} grades to ${length.toFixed(1)}mm at ${size.label}, against ${mateLength.toFixed(1)}mm on ${mate.piece.name} · ${mate.segment.label ?? 'edge'} — a ${diff.toFixed(1)}mm mismatch neither piece's rules account for.`,
          pieceId: piece.id,
          segmentId: segment.id,
          sizeId: size.id,
        });
      }
    }
  }

  return out;
};

/**
 * Every real, computed grading finding for a document — or one piece of it.
 *
 * Two checks today: an arc whose radius the stated hold-constant policy could
 * not honour, and a pair of mated seams that grade to different lengths. Both
 * are exact — no heuristic scoring, no invented severity beyond "past this
 * millimetre threshold" — because a false anomaly is worse than a missed one
 * on a panel a grader is meant to trust.
 */
export const gradeDiagnostics = (
  document: PatternDocument,
  pieceId?: PieceId,
): readonly GradeDiagnostic[] => {
  const pieces = pieceId ? document.pieces.filter((p) => p.id === pieceId) : document.pieces;
  const arcFindings = pieces.flatMap((piece) =>
    arcRadiusDiagnostics(piece, document.gradeRules, document.sizeRange),
  );
  const matingFindings = matingSeamDiagnostics(document, pieceId);
  return [...arcFindings, ...matingFindings];
};
