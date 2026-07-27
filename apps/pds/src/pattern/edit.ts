import type { Vec2 } from '@/geometry';
import { LINE, resolveArc, splitSegment, tangentOnSegment, type ArcGeometry, type SegmentGeometry } from './curve';
import { createId, type NotchId, type PointId, type SegmentId } from './ids';
import type { Notch, NotchKind } from './annotations';
import type { PatternPiece, PiecePoint, PieceSegment, PointRole } from './piece';
import { segmentLength } from './resolve';

/**
 * Pure geometry edits over a piece.
 *
 * Every function here returns a **new** piece and never touches its input.
 * That is load-bearing rather than stylistic: `resolve.ts` and `nest.ts` cache
 * flattened outlines and graded sizes in a `WeakMap` keyed on the piece object,
 * so a piece edited in place would keep serving its old outline with no error.
 *
 * These are the primitives the commands in `store/geometryCommands.ts` wrap;
 * nothing here knows about stores, undo or React.
 */

/** Per-point translations. Absent ids are left alone. */
export type PointDeltas = ReadonlyMap<PointId, Vec2>;

const translate = (p: Vec2, d: Vec2): Vec2 => ({ x: p.x + d.x, y: p.y + d.y });

/**
 * Moves a segment's cubic handles to match whichever of its endpoints moved.
 *
 * Cubic control handles are stored as absolute positions in piece space, not as
 * offsets from their endpoints. Move an endpoint without moving its handle and
 * the curve does not follow — it pivots around the stale handle and visibly
 * deforms. `control1` belongs to `from` and `control2` to `to`, so each handle
 * takes the delta of the endpoint it governs. When only one end moves, the
 * curve stretches, which is what direct manipulation should feel like.
 */
const moveGeometry = (
  segment: PieceSegment,
  deltas: PointDeltas,
): SegmentGeometry => {
  if (segment.geometry.kind !== 'cubic') return segment.geometry;

  const fromDelta = deltas.get(segment.from);
  const toDelta = deltas.get(segment.to);
  if (!fromDelta && !toDelta) return segment.geometry;

  return {
    kind: 'cubic',
    control1: fromDelta ? translate(segment.geometry.control1, fromDelta) : segment.geometry.control1,
    control2: toDelta ? translate(segment.geometry.control2, toDelta) : segment.geometry.control2,
  };
};

/**
 * Translates the named points, carrying attached curve handles with them.
 *
 * Notches ride on a segment by parameter `t` and internal lines, grain and
 * measurement links all reference points by id, so every one of them follows
 * without being touched here. That is the whole reason the model stores
 * topology rather than coordinates.
 */
export const translatePoints = (piece: PatternPiece, deltas: PointDeltas): PatternPiece => {
  if (deltas.size === 0) return piece;

  const points: PiecePoint[] = piece.points.map((point) => {
    const delta = deltas.get(point.id);
    return delta ? { ...point, position: translate(point.position, delta) } : point;
  });

  const segments: PieceSegment[] = piece.segments.map((segment) => {
    const geometry = moveGeometry(segment, deltas);
    return geometry === segment.geometry ? segment : { ...segment, geometry };
  });

  return { ...piece, points, segments };
};

/** Translates every point of a piece — a whole-piece move. */
export const translatePiece = (piece: PatternPiece, delta: Vec2): PatternPiece =>
  translatePoints(piece, new Map(piece.points.map((point) => [point.id, delta])));

/** Moves one point to an absolute position. */
export const setPointPosition = (
  piece: PatternPiece,
  pointId: PointId,
  position: Vec2,
): PatternPiece => {
  const point = piece.points.find((p) => p.id === pointId);
  if (!point) return piece;
  return translatePoints(
    piece,
    new Map([[pointId, { x: position.x - point.position.x, y: position.y - point.position.y }]]),
  );
};

/** Moves both endpoints of a segment, so the edge translates rigidly. */
export const translateSegment = (
  piece: PatternPiece,
  segmentId: SegmentId,
  delta: Vec2,
): PatternPiece => {
  const segment = piece.segments.find((s) => s.id === segmentId);
  if (!segment) return piece;
  return translatePoints(
    piece,
    new Map([
      [segment.from, delta],
      [segment.to, delta],
    ]),
  );
};

/**
 * Straight-line handles for a cubic: thirds along the chord.
 *
 * A cubic with its handles at these positions traces exactly the straight line
 * between its endpoints, so line → curve is lossless and leaves the outline
 * unchanged until a handle is actually moved.
 */
const chordHandles = (from: Vec2, to: Vec2): SegmentGeometry => ({
  kind: 'cubic',
  control1: { x: from.x + (to.x - from.x) / 3, y: from.y + (to.y - from.y) / 3 },
  control2: { x: to.x - (to.x - from.x) / 3, y: to.y - (to.y - from.y) / 3 },
});

/**
 * Switches a segment between straight, Bézier and circular-arc geometry.
 *
 * Line → curve is shape-preserving. The other conversions are not: curve → line
 * discards the handles, and anything → arc replaces the path with a circular
 * one through the same endpoints. Those losses are real, which is why this sits
 * behind a command — undo restores the original geometry exactly.
 *
 * A new arc is given a radius comfortably larger than half its chord, so it
 * reads as a gentle bow rather than a half-circle and can be flattened from
 * there. Arcs matter because DXF — the format pattern CAD actually exchanges —
 * expresses most curved seams as them.
 */
export const setSegmentKind = (
  piece: PatternPiece,
  segmentId: SegmentId,
  kind: 'line' | 'cubic' | 'arc',
): PatternPiece => {
  const segment = piece.segments.find((s) => s.id === segmentId);
  if (!segment || segment.geometry.kind === kind) return piece;

  const from = piece.points.find((p) => p.id === segment.from);
  const to = piece.points.find((p) => p.id === segment.to);
  if (!from || !to) return piece;

  const chord = Math.hypot(to.position.x - from.position.x, to.position.y - from.position.y);

  const geometry: SegmentGeometry =
    kind === 'line'
      ? LINE
      : kind === 'arc'
        ? { kind: 'arc', radius: Math.max(chord, 1) * 0.75, largeArc: false, clockwise: false }
        : chordHandles(from.position, to.position);

  return {
    ...piece,
    segments: piece.segments.map((s) => (s.id === segmentId ? { ...s, geometry } : s)),
  };
};

/**
 * Sets a per-segment seam allowance, or clears it back to the piece default.
 *
 * `undefined` removes the override rather than storing a zero, because zero is
 * a meaningful allowance (a net-cut edge) and must stay distinguishable from
 * "inherit whatever the piece says".
 */
export const setSegmentSeamAllowance = (
  piece: PatternPiece,
  segmentId: SegmentId,
  allowance: number | undefined,
): PatternPiece => ({
  ...piece,
  segments: piece.segments.map((segment) => {
    if (segment.id !== segmentId) return segment;
    const { seamAllowance: _dropped, ...rest } = segment;
    return allowance === undefined ? rest : { ...rest, seamAllowance: allowance };
  }),
});

/* --- Curve handles ---------------------------------------------------------- */

/** Which end of a cubic a handle governs. `control1` belongs to `from`. */
export type HandleKind = 'control1' | 'control2';

/**
 * Moves one cubic handle to an absolute position.
 *
 * This is the only way to change the *shape* of an edge as opposed to its
 * placement: everything else here moves points and drags the handles along
 * rigidly. A no-op on a straight segment — convert it with `setSegmentKind`
 * first, which is lossless in that direction.
 *
 * **Curve points stay smooth.** If the handle's anchor is a point with role
 * `curve`, the handle on the far side of that anchor is swung to stay opposite,
 * keeping its own length. Without this a shared point becomes a visible kink
 * the moment either side is touched, and an armhole or a cap cannot be shaped
 * without breaking where it meets its neighbour. A `corner` point is left
 * alone: a corner is meant to be a corner.
 */
export const setSegmentHandle = (
  piece: PatternPiece,
  segmentId: SegmentId,
  handle: HandleKind,
  position: Vec2,
): PatternPiece => {
  const segment = piece.segments.find((s) => s.id === segmentId);
  if (!segment || segment.geometry.kind !== 'cubic') return piece;

  const anchorId = handle === 'control1' ? segment.from : segment.to;
  const anchor = piece.points.find((p) => p.id === anchorId);

  /** The other boundary segment meeting at the anchor, and which handle it owns. */
  const opposite = ((): { readonly id: SegmentId; readonly handle: HandleKind } | null => {
    if (!anchor || anchor.role !== 'curve') return null;
    for (const id of piece.boundary) {
      if (id === segmentId) continue;
      const other = piece.segments.find((s) => s.id === id);
      if (!other || other.geometry.kind !== 'cubic') continue;
      if (other.from === anchorId) return { id: other.id, handle: 'control1' };
      if (other.to === anchorId) return { id: other.id, handle: 'control2' };
    }
    return null;
  })();

  // Direction from the anchor out to the moved handle; the neighbour mirrors it.
  const away =
    anchor && opposite
      ? { x: position.x - anchor.position.x, y: position.y - anchor.position.y }
      : null;
  const awayLength = away ? Math.hypot(away.x, away.y) : 0;

  return {
    ...piece,
    segments: piece.segments.map((s) => {
      if (s.id === segmentId && s.geometry.kind === 'cubic') {
        return { ...s, geometry: { ...s.geometry, [handle]: position } };
      }
      if (
        opposite &&
        s.id === opposite.id &&
        s.geometry.kind === 'cubic' &&
        anchor &&
        away &&
        awayLength > 1e-9
      ) {
        // Preserve the neighbour's own handle length; only its direction is
        // dictated, so smoothing does not also reshape how deep that curve is.
        const current = s.geometry[opposite.handle];
        const length = Math.hypot(
          current.x - anchor.position.x,
          current.y - anchor.position.y,
        );
        return {
          ...s,
          geometry: {
            ...s.geometry,
            [opposite.handle]: {
              x: anchor.position.x - (away.x / awayLength) * length,
              y: anchor.position.y - (away.y / awayLength) * length,
            },
          },
        };
      }
      return s;
    }),
  };
};

/* --- Topology: inserting and removing outline points ------------------------ */

/** Keeps a split away from the endpoints, where it would make a zero-length edge. */
const T_MARGIN = 1e-3;

export interface InsertPointResult {
  readonly piece: PatternPiece;
  readonly pointId: PointId;
  /** The two segments that replaced the split one, in boundary order. */
  readonly segmentIds: readonly [SegmentId, SegmentId];
  readonly replacedSegmentId: SegmentId;
}

/**
 * Splits a boundary segment at `t`, adding an outline point where it cuts.
 *
 * The split is exact (see `splitSegment`), so the outline is untouched — this
 * adds a handle to grab, nothing more. Both halves inherit the original's seam
 * label, allowance and finish, because they are still the same seam.
 *
 * Notches on the split segment are re-anchored onto whichever half now carries
 * them, with `t` rescaled into that half's parameter range. They are positioned
 * by parameter rather than coordinate precisely so they can survive this.
 *
 * Returns null when the segment is not on the boundary or `t` is degenerate.
 * The caller still has to fix up document-level references (measurements);
 * `replacedSegmentId` and `segmentIds` are returned for exactly that.
 */
export const insertPointOnSegment = (
  piece: PatternPiece,
  segmentId: SegmentId,
  t: number,
): InsertPointResult | null => {
  const boundaryIndex = piece.boundary.indexOf(segmentId);
  if (boundaryIndex < 0) return null;

  const segment = piece.segments.find((s) => s.id === segmentId);
  if (!segment) return null;

  const from = piece.points.find((p) => p.id === segment.from);
  const to = piece.points.find((p) => p.id === segment.to);
  if (!from || !to) return null;

  const clamped = Math.min(1 - T_MARGIN, Math.max(T_MARGIN, t));
  const split = splitSegment(from.position, to.position, segment.geometry, clamped);

  const pointId = createId(`${piece.id}-p`);
  const leftId = createId(`${piece.id}-s`);
  const rightId = createId(`${piece.id}-s`);

  // A point cutting a curve — cubic or arc — is itself a curve point: both
  // halves stay tangent-continuous through the cut (de Casteljau for a
  // cubic, the same circle for an arc), so the point is genuinely smooth,
  // not a corner. Only a line has no tangent to preserve. This only drives
  // how the renderer marks it, but getting it wrong makes the node read as
  // the wrong kind of control.
  const point: PiecePoint = {
    id: pointId,
    position: split.at,
    role: segment.geometry.kind === 'line' ? 'corner' : 'curve',
  };

  // Shared seam properties carry to both halves; `mateSegmentId` does not. A
  // mate is a 1:1 "sewn to" relationship and splitting one side of it would
  // leave two segments claiming the same partner.
  const shared = {
    ...(segment.label !== undefined ? { label: segment.label } : {}),
    ...(segment.seamAllowance !== undefined ? { seamAllowance: segment.seamAllowance } : {}),
    ...(segment.seamFinish !== undefined ? { seamFinish: segment.seamFinish } : {}),
  };

  const left: PieceSegment = {
    id: leftId,
    from: segment.from,
    to: pointId,
    geometry: split.left,
    ...shared,
  };
  const right: PieceSegment = {
    id: rightId,
    from: pointId,
    to: segment.to,
    geometry: split.right,
    ...shared,
  };

  const notches: Notch[] = piece.notches.map((notch) => {
    if (notch.segmentId !== segmentId) return notch;
    return notch.t <= clamped
      ? { ...notch, segmentId: leftId, t: notch.t / clamped }
      : { ...notch, segmentId: rightId, t: (notch.t - clamped) / (1 - clamped) };
  });

  return {
    piece: {
      ...piece,
      points: [...piece.points, point],
      segments: [...piece.segments.filter((s) => s.id !== segmentId), left, right],
      boundary: [
        ...piece.boundary.slice(0, boundaryIndex),
        leftId,
        rightId,
        ...piece.boundary.slice(boundaryIndex + 1),
      ],
      notches,
    },
    pointId,
    segmentIds: [leftId, rightId],
    replacedSegmentId: segmentId,
  };
};

/**
 * Why a point cannot be removed, or null when it can be.
 *
 * Separated from the removal itself so the inspector can disable the control
 * and say why, rather than offering an action that silently does nothing.
 */
export const pointRemovalBlocker = (piece: PatternPiece, pointId: PointId): string | null => {
  const incoming = piece.boundary
    .map((id) => piece.segments.find((s) => s.id === id))
    .filter((s): s is PieceSegment => s !== undefined)
    .filter((s) => s.to === pointId);
  const outgoing = piece.boundary
    .map((id) => piece.segments.find((s) => s.id === id))
    .filter((s): s is PieceSegment => s !== undefined)
    .filter((s) => s.from === pointId);

  if (incoming.length !== 1 || outgoing.length !== 1) {
    return 'Not a simple outline point';
  }
  if (piece.boundary.length <= 3) {
    return 'A closed piece needs at least three edges';
  }
  if (piece.grainLine && (piece.grainLine.from === pointId || piece.grainLine.to === pointId)) {
    return 'The grain line is anchored here';
  }
  if (piece.internalLines.some((line) => line.points.includes(pointId))) {
    return 'An internal line is anchored here';
  }
  return null;
};

export interface RemovePointResult {
  readonly piece: PatternPiece;
  /** The segment that replaced the two meeting at the removed point. */
  readonly segmentId: SegmentId;
  readonly replacedSegmentIds: readonly [SegmentId, SegmentId];
}

/**
 * How close two quantities (millimetres, or the perpendicular deviation
 * used to test collinearity) must be to call an inverse exact.
 *
 * Genuine floating-point noise from de Casteljau subdivision or the arc
 * trig in `curve.ts` sits many orders of magnitude below this for any
 * coordinate scale a pattern piece actually uses; a real difference —
 * anything a person or another edit could have intended — sits many orders
 * above it. It is a threshold for "is this the same number", not a modelling
 * tolerance.
 */
const EXACT_TOLERANCE_MM = 1e-6;

/**
 * Removes an outline point, merging the two edges that met there into one.
 *
 * The merge is exact whenever the pair of edges admits an exact merge, and an
 * honest, tangent-preserving approximation otherwise. Four cases, in the
 * order this checks them:
 *
 * - **Line + line** merges to a single `LINE` exactly. There is no curve
 *   fit involved — a straight edge between the surviving endpoints is all a
 *   line ever was — though if the removed point was a real corner rather
 *   than a split undone, the outline itself changes (the corner is cut),
 *   which is the point of removing it.
 * - **Arc + arc on the same circle** — matching centre, radius and
 *   direction — merges to a single arc spanning both sweeps exactly, the
 *   same identity `splitSegment` uses in reverse: two arcs of one circle
 *   are one arc of that circle, full stop, independent of how they came to
 *   be adjacent.
 * - **Cubic + cubic whose shared handles are collinear through the joint**
 *   merges to a single cubic exactly, recovering the pre-split curve. De
 *   Casteljau subdivision leaves the inner handles and the joint collinear,
 *   with the joint dividing them in exactly the split ratio — checking that
 *   collinearity, not just that *some* ratio can be computed from the
 *   distances involved, is what tells an undone split apart from two
 *   cubics that were drawn independently and merely happen to meet. The
 *   latter do not admit an exact merge, and treating their handles as if
 *   they did would silently claim a precision the result does not have.
 * - **Everything else** — mixed kinds, non-cocircular arcs, non-collinear
 *   cubics — merges to an approximate cubic. Its handles are not arbitrary:
 *   each points along the *true* tangent of whichever original edge left
 *   the surviving endpoint (a line's constant direction, an arc's exact
 *   tangent, or a cubic's own handle), so an arc or line on one side of the
 *   merge is never silently treated as if it were the straight chord
 *   between the two surviving points. Only the handle's *reach* — a third
 *   of the merged chord — is a convention, the same one `chordHandles` uses
 *   for a fresh line → curve.
 *
 * Notches are re-anchored using the same share as the geometry above:
 * the exact split ratio when one was found, or arc-length share otherwise.
 * Arc-length share is not just a fallback here — it is *exact* for the line
 * and arc cases too, because parameter is proportional to length on
 * anything but a cubic. Only the cubic case genuinely needs the split ratio
 * instead, which is why both draw from the one `share` value rather than
 * notches quietly using a different, weaker proportion than the geometry
 * they are meant to be riding on.
 *
 * Returns null when `pointRemovalBlocker` would refuse.
 */
export const removePoint = (
  piece: PatternPiece,
  pointId: PointId,
): RemovePointResult | null => {
  if (pointRemovalBlocker(piece, pointId) !== null) return null;

  const incoming = piece.segments.find(
    (s) => s.to === pointId && piece.boundary.includes(s.id),
  );
  const outgoing = piece.segments.find(
    (s) => s.from === pointId && piece.boundary.includes(s.id),
  );
  if (!incoming || !outgoing) return null;

  const from = piece.points.find((p) => p.id === incoming.from);
  const to = piece.points.find((p) => p.id === outgoing.to);
  const joint = piece.points.find((p) => p.id === pointId);
  if (!from || !to || !joint) return null;

  const bothLines = incoming.geometry.kind === 'line' && outgoing.geometry.kind === 'line';

  const incomingLength = segmentLength(piece, incoming);
  const outgoingLength = segmentLength(piece, outgoing);
  const total = incomingLength + outgoingLength;
  const arcShare = total > 0 ? incomingLength / total : 0.5;

  /*
   * The parameter at which the merged cubic is divided, found only when the
   * two cubics are truly one curve cut in half.
   *
   * When two cubics were produced by splitting one, de Casteljau leaves the
   * inner handles and the joint exactly collinear, with the joint dividing
   * them in exactly the split ratio — so this both verifies the collinearity
   * (rejecting two cubics that only happen to meet) and reads the ratio back
   * from it in the same step.
   */
  const jointRatio = ((): number | null => {
    if (incoming.geometry.kind !== 'cubic' || outgoing.geometry.kind !== 'cubic') return null;
    const d = incoming.geometry.control2;
    const e = outgoing.geometry.control1;
    const span = Math.hypot(e.x - d.x, e.y - d.y);
    if (span < 1e-9) return null;

    const dx = e.x - d.x;
    const dy = e.y - d.y;
    const perpendicular = Math.abs((joint.position.x - d.x) * dy - (joint.position.y - d.y) * dx) / span;
    if (perpendicular > EXACT_TOLERANCE_MM) return null;

    const ratio = Math.hypot(joint.position.x - d.x, joint.position.y - d.y) / span;
    return ratio > 1e-6 && ratio < 1 - 1e-6 ? ratio : null;
  })();

  /**
   * A single arc spanning both sweeps, found only when the two arcs sit on
   * the same circle in the same direction — the condition that makes a
   * one-arc merge exact rather than approximate.
   */
  const arcMerge = ((): ArcGeometry | null => {
    if (incoming.geometry.kind !== 'arc' || outgoing.geometry.kind !== 'arc') return null;
    if (incoming.geometry.clockwise !== outgoing.geometry.clockwise) return null;

    const first = resolveArc(from.position, joint.position, incoming.geometry);
    const second = resolveArc(joint.position, to.position, outgoing.geometry);
    if (!first || !second) return null;

    const sameCentre =
      Math.hypot(first.centre.x - second.centre.x, first.centre.y - second.centre.y) <=
      EXACT_TOLERANCE_MM;
    const sameRadius = Math.abs(first.radius - second.radius) <= EXACT_TOLERANCE_MM;
    if (!sameCentre || !sameRadius) return null;

    const sweep = first.sweep + second.sweep;
    return {
      kind: 'arc',
      radius: first.radius,
      largeArc: Math.abs(sweep) > Math.PI,
      clockwise: incoming.geometry.clockwise,
    };
  })();

  const share = jointRatio ?? arcShare;

  /** Pushes a cubic handle out from its anchor so it spans the merged edge. */
  const rescale = (anchor: Vec2, handle: Vec2, portion: number): Vec2 => {
    const safe = Math.min(0.999, Math.max(0.001, portion));
    return {
      x: anchor.x + (handle.x - anchor.x) / safe,
      y: anchor.y + (handle.y - anchor.y) / safe,
    };
  };

  const chordThird =
    Math.hypot(to.position.x - from.position.x, to.position.y - from.position.y) / 3;

  /**
   * A handle for the approximate branch: `length` out from `anchor` along
   * `tangent`, so the merge continues whatever the original edge was
   * actually doing at this end — a line's own direction, or an arc's exact
   * tangent — rather than assuming it was the straight chord between the two
   * surviving points, which is what treating every non-cubic edge as a line
   * used to do. Falls back to the chord itself only when `tangent` is
   * degenerate (coincident points), the one case with no direction to keep.
   */
  const tangentHandle = (anchor: Vec2, tangent: Vec2, towards: Vec2, length: number): Vec2 => {
    const magnitude = Math.hypot(tangent.x, tangent.y);
    if (magnitude < 1e-9) {
      return {
        x: anchor.x + (towards.x - anchor.x) / 3,
        y: anchor.y + (towards.y - anchor.y) / 3,
      };
    }
    return {
      x: anchor.x + (tangent.x / magnitude) * length,
      y: anchor.y + (tangent.y / magnitude) * length,
    };
  };

  const geometry: SegmentGeometry = bothLines
    ? LINE
    : arcMerge
      ? arcMerge
      : {
          kind: 'cubic',
          control1:
            incoming.geometry.kind === 'cubic'
              ? rescale(from.position, incoming.geometry.control1, share)
              : tangentHandle(
                  from.position,
                  tangentOnSegment(from.position, joint.position, incoming.geometry, 0),
                  to.position,
                  chordThird,
                ),
          control2:
            outgoing.geometry.kind === 'cubic'
              ? rescale(to.position, outgoing.geometry.control2, 1 - share)
              : tangentHandle(
                  to.position,
                  ((v: Vec2): Vec2 => ({ x: -v.x, y: -v.y }))(
                    tangentOnSegment(joint.position, to.position, outgoing.geometry, 1),
                  ),
                  from.position,
                  chordThird,
                ),
        };

  const mergedId = createId(`${piece.id}-s`);
  const merged: PieceSegment = {
    id: mergedId,
    from: incoming.from,
    to: outgoing.to,
    geometry,
    ...(incoming.label !== undefined ? { label: incoming.label } : {}),
    ...(incoming.seamAllowance !== undefined ? { seamAllowance: incoming.seamAllowance } : {}),
    ...(incoming.seamFinish !== undefined ? { seamFinish: incoming.seamFinish } : {}),
  };

  // The same `share` the geometry above was built from — see the docstring
  // for why arc-length share is exact here too, and not just the fallback.
  const notches: Notch[] = piece.notches.map((notch) => {
    if (notch.segmentId === incoming.id) {
      return { ...notch, segmentId: mergedId, t: notch.t * share };
    }
    if (notch.segmentId === outgoing.id) {
      return { ...notch, segmentId: mergedId, t: share + notch.t * (1 - share) };
    }
    return notch;
  });

  return {
    piece: {
      ...piece,
      points: piece.points.filter((p) => p.id !== pointId),
      segments: [
        ...piece.segments.filter((s) => s.id !== incoming.id && s.id !== outgoing.id),
        merged,
      ],
      // Rebuilt by dropping the outgoing edge and swapping the incoming one for
      // the merge, rather than by splicing at an index. A closed boundary can
      // wrap — the two edges are adjacent but the pair can straddle index 0 —
      // and mapping in place needs no special case for that.
      boundary: piece.boundary
        .filter((id) => id !== outgoing.id)
        .map((id) => (id === incoming.id ? mergedId : id)),
      notches,
    },
    segmentId: mergedId,
    replacedSegmentIds: [incoming.id, outgoing.id],
  };
};

/* --- Notches ---------------------------------------------------------------- */

/**
 * Default notch shape, matching what the seed pattern uses.
 *
 * A balance notch is a slit unless a spec says otherwise; depth and width are
 * the conventional 6 mm × 2 mm. These live here rather than being asked for at
 * every call site, because a notch tool that opened a dialogue before it could
 * make a mark would be worse than useless.
 */
const NOTCH_DEFAULTS = { kind: 'slit' as NotchKind, depth: 6, width: 2, angle: 0 };

export interface AddNotchResult {
  readonly piece: PatternPiece;
  readonly notchId: NotchId;
}

/**
 * Places a notch on a boundary segment at parameter `t`.
 *
 * Stored by parameter, not coordinate, so it rides the seam through reshaping,
 * splitting and merging without being recomputed — the property the whole model
 * is arranged around. Returns null when the segment is not on the boundary.
 */
export const addNotch = (
  piece: PatternPiece,
  segmentId: SegmentId,
  t: number,
  kind: NotchKind = NOTCH_DEFAULTS.kind,
): AddNotchResult | null => {
  if (!piece.boundary.includes(segmentId)) return null;

  const notchId = createId(`${piece.id}-n`);
  const notch: Notch = {
    ...NOTCH_DEFAULTS,
    kind,
    id: notchId,
    segmentId,
    t: Math.min(1, Math.max(0, t)),
  };

  return { piece: { ...piece, notches: [...piece.notches, notch] }, notchId };
};

/** Removes a notch. A no-op when the id is unknown, so undo stays symmetric. */
export const removeNotch = (piece: PatternPiece, notchId: NotchId): PatternPiece => ({
  ...piece,
  notches: piece.notches.filter((notch) => notch.id !== notchId),
});

/* --- Point role -------------------------------------------------------------- */

/**
 * Changes what kind of point this is, and makes the geometry agree.
 *
 * The role is not decoration: `setSegmentHandle` reads it to decide whether the
 * two handles meeting here stay opposite. Switching to `curve` therefore has to
 * *make* them opposite, or the point would claim to be smooth while visibly
 * kinked. The incoming handle's direction is kept and the outgoing one is swung
 * to match, each keeping its own length — the same rule dragging a handle uses,
 * so the two paths cannot disagree.
 *
 * Switching to `corner` changes no geometry at all. A corner is free to have
 * any handles, including collinear ones, so there is nothing to enforce.
 */
export const setPointRole = (
  piece: PatternPiece,
  pointId: PointId,
  role: PointRole,
): PatternPiece => {
  const point = piece.points.find((p) => p.id === pointId);
  if (!point || point.role === role) return piece;

  const withRole: PatternPiece = {
    ...piece,
    points: piece.points.map((p) => (p.id === pointId ? { ...p, role } : p)),
  };
  if (role !== 'curve') return withRole;

  const incoming = withRole.segments.find(
    (s) => s.to === pointId && withRole.boundary.includes(s.id),
  );
  const outgoing = withRole.segments.find(
    (s) => s.from === pointId && withRole.boundary.includes(s.id),
  );
  if (!incoming || !outgoing) return withRole;
  if (incoming.geometry.kind !== 'cubic' || outgoing.geometry.kind !== 'cubic') return withRole;

  const anchor = point.position;
  const away = {
    x: incoming.geometry.control2.x - anchor.x,
    y: incoming.geometry.control2.y - anchor.y,
  };
  const awayLength = Math.hypot(away.x, away.y);
  if (awayLength < 1e-9) return withRole;

  const outLength = Math.hypot(
    outgoing.geometry.control1.x - anchor.x,
    outgoing.geometry.control1.y - anchor.y,
  );

  return {
    ...withRole,
    segments: withRole.segments.map((s) =>
      s.id === outgoing.id && s.geometry.kind === 'cubic'
        ? {
            ...s,
            geometry: {
              ...s.geometry,
              control1: {
                x: anchor.x - (away.x / awayLength) * outLength,
                y: anchor.y - (away.y / awayLength) * outLength,
              },
            },
          }
        : s,
    ),
  };
};

/* --- Notch position ---------------------------------------------------------- */

/** Moves a notch along its own segment. `t` is clamped to the segment. */
export const setNotchParameter = (
  piece: PatternPiece,
  notchId: NotchId,
  t: number,
): PatternPiece => ({
  ...piece,
  notches: piece.notches.map((notch) =>
    notch.id === notchId ? { ...notch, t: Math.min(1, Math.max(0, t)) } : notch,
  ),
});

/** Changes a notch's shape without moving it. */
export const setNotchKind = (
  piece: PatternPiece,
  notchId: NotchId,
  kind: NotchKind,
): PatternPiece => ({
  ...piece,
  notches: piece.notches.map((notch) => (notch.id === notchId ? { ...notch, kind } : notch)),
});
