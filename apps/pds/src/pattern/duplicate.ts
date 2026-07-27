import type { Vec2 } from '@/geometry';
import type { SegmentGeometry } from './curve';
import { createId } from './ids';
import type { GrainLine, InternalLine, Notch } from './annotations';
import type { PatternPiece, PieceSegment, PiecePoint } from './piece';

/**
 * Structural copy of a piece: every internal id is reminted and every
 * coordinate is translated by `offset`.
 *
 * This is a pure model operation — it changes no shape. Points keep their
 * relative positions, so the copy is congruent with the original; the offset
 * only decides where it sits. Naming the copy is left to the caller, because
 * what a duplicate should be *called* is a product decision, not a model one.
 */

/**
 * Cubic control handles are absolute positions in piece space, not deltas from
 * their endpoints — translating the points without translating the handles
 * would leave every curve reaching back toward the original's location. The
 * failure is silent and only visible as a deformed outline, so it is handled
 * here rather than at any call site.
 */
const translateGeometry = (geometry: SegmentGeometry, offset: Vec2): SegmentGeometry => {
  if (geometry.kind !== 'cubic') return geometry;
  return {
    kind: 'cubic',
    control1: { x: geometry.control1.x + offset.x, y: geometry.control1.y + offset.y },
    control2: { x: geometry.control2.x + offset.x, y: geometry.control2.y + offset.y },
  };
};

/** A reference that does not resolve means the source piece is corrupt; say so loudly. */
const remap = (map: ReadonlyMap<string, string>, id: string, kind: string): string => {
  const next = map.get(id);
  if (next === undefined) {
    throw new Error(`clonePiece: ${kind} "${id}" is not in the source piece's pool`);
  }
  return next;
};

export const clonePiece = (piece: PatternPiece, offset: Vec2 = { x: 0, y: 0 }): PatternPiece => {
  const pieceId = createId('piece');

  const pointIds = new Map<string, string>();
  const points: PiecePoint[] = piece.points.map((point) => {
    const id = createId(`${pieceId}-p`);
    pointIds.set(point.id, id);
    return {
      id,
      position: { x: point.position.x + offset.x, y: point.position.y + offset.y },
      role: point.role,
      ...(point.label !== undefined ? { label: point.label } : {}),
      // Grade rules live on the document and are shared by many points across
      // many pieces, so the copy points at the same rule rather than forking it.
      ...(point.gradeRuleId !== undefined ? { gradeRuleId: point.gradeRuleId } : {}),
    };
  });

  const segmentIds = new Map<string, string>();
  const segments: PieceSegment[] = piece.segments.map((segment) => {
    const id = createId(`${pieceId}-s`);
    segmentIds.set(segment.id, id);
    return {
      id,
      from: remap(pointIds, segment.from, 'point'),
      to: remap(pointIds, segment.to, 'point'),
      geometry: translateGeometry(segment.geometry, offset),
      ...(segment.label !== undefined ? { label: segment.label } : {}),
      ...(segment.seamAllowance !== undefined ? { seamAllowance: segment.seamAllowance } : {}),
      ...(segment.seamFinish !== undefined ? { seamFinish: segment.seamFinish } : {}),
      // `mateSegmentId` is deliberately dropped. A mate is a 1:1 "sewn to"
      // relationship; copying it would give one seam two claimants and quietly
      // corrupt any future walk/verify. The copy has not been sewn to anything.
    };
  });

  const notches: Notch[] = piece.notches.map((notch) => ({
    id: createId(`${pieceId}-n`),
    segmentId: remap(segmentIds, notch.segmentId, 'segment'),
    t: notch.t,
    kind: notch.kind,
    depth: notch.depth,
    width: notch.width,
    angle: notch.angle,
    ...(notch.label !== undefined ? { label: notch.label } : {}),
    // `pairedWith` is dropped for the same reason as `mateSegmentId`: pairing
    // is 1:1, and the copy is not yet paired with anything.
  }));

  const internalLines: InternalLine[] = piece.internalLines.map((line) => ({
    id: createId(`${pieceId}-i`),
    role: line.role,
    points: line.points.map((id) => remap(pointIds, id, 'point')),
    closed: line.closed,
    cut: line.cut,
    ...(line.label !== undefined ? { label: line.label } : {}),
  }));

  const grainLine: GrainLine | undefined = piece.grainLine
    ? {
        id: createId(`${pieceId}-grain`),
        kind: piece.grainLine.kind,
        from: remap(pointIds, piece.grainLine.from, 'point'),
        to: remap(pointIds, piece.grainLine.to, 'point'),
        arrows: piece.grainLine.arrows,
      }
    : undefined;

  return {
    id: pieceId,
    name: piece.name,
    points,
    segments,
    boundary: piece.boundary.map((id) => remap(segmentIds, id, 'segment')),
    closed: piece.closed,
    seamAllowance: piece.seamAllowance,
    ...(grainLine ? { grainLine } : {}),
    notches,
    internalLines,
    meta: { ...piece.meta },
  };
};
