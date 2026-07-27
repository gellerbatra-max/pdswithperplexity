import type { Vec2 } from '@/geometry';
import { LINE, splitSegment, type SegmentGeometry } from './curve';
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

  // A point cutting a curve is itself a curve point; on a straight edge it is a
  // corner. That only drives how the renderer marks it, but getting it wrong
  // makes the node read as the wrong kind of control.
  const point: PiecePoint = {
    id: pointId,
    position: split.at,
    role: segment.geometry.kind === 'cubic' ? 'curve' : 'corner',
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
 * Removes an outline point, merging the two edges that met there into one.
 *
 * **This changes the outline, and in general it has to.** Two cubics joined end
 * to end are usually not expressible as one cubic. The merged edge keeps the
 * outer handles — the incoming edge's `control1`, the outgoing edge's
 * `control2` — rescaled to span the combined edge, which preserves the tangent
 * direction at each surviving end and recovers the original curve exactly when
 * the merge is undoing a split. Two straight edges merge exactly. Anything else
 * is an approximation whose error grows with how much the two edges disagree,
 * and undo is the only exact way back.
 *
 * Notches are re-anchored onto the merged edge by arc-length proportion, which
 * keeps them near where they were without claiming more precision than the
 * merge itself has.
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
  if (!from || !to) return null;

  const bothStraight =
    incoming.geometry.kind !== 'cubic' && outgoing.geometry.kind !== 'cubic';

  /*
   * The parameter at which the merged edge is divided.
   *
   * When two cubics were produced by splitting one, de Casteljau leaves the
   * inner handles and the joint collinear, with the joint dividing them in
   * exactly the split ratio. Reading that ratio back recovers the original
   * split parameter, which is what makes the rescale below exact for a merge
   * that undoes a split.
   *
   * Arc-length share is the fallback: it is a reasonable estimate for edges
   * that were never halves of one curve, and for the mixed straight/curved case
   * where no such collinearity exists.
   */
  const incomingLength = segmentLength(piece, incoming);
  const outgoingLength = segmentLength(piece, outgoing);
  const total = incomingLength + outgoingLength;
  const arcShare = total > 0 ? incomingLength / total : 0.5;

  const jointRatio = ((): number | null => {
    if (incoming.geometry.kind !== 'cubic' || outgoing.geometry.kind !== 'cubic') return null;
    const d = incoming.geometry.control2;
    const e = outgoing.geometry.control1;
    const joint = piece.points.find((p) => p.id === pointId);
    if (!joint) return null;
    const span = Math.hypot(e.x - d.x, e.y - d.y);
    if (span < 1e-9) return null;
    const ratio = Math.hypot(joint.position.x - d.x, joint.position.y - d.y) / span;
    return ratio > 1e-6 && ratio < 1 - 1e-6 ? ratio : null;
  })();

  const share = jointRatio ?? arcShare;

  /** Pushes a handle out from its anchor so it spans the merged edge. */
  const rescale = (anchor: Vec2, handle: Vec2, portion: number): Vec2 => {
    const safe = Math.min(0.999, Math.max(0.001, portion));
    return {
      x: anchor.x + (handle.x - anchor.x) / safe,
      y: anchor.y + (handle.y - anchor.y) / safe,
    };
  };

  const geometry: SegmentGeometry = bothStraight
    ? LINE
    : {
        kind: 'cubic',
        control1:
          incoming.geometry.kind === 'cubic'
            ? rescale(from.position, incoming.geometry.control1, share)
            : { x: from.position.x + (to.position.x - from.position.x) / 3,
                y: from.position.y + (to.position.y - from.position.y) / 3 },
        control2:
          outgoing.geometry.kind === 'cubic'
            ? rescale(to.position, outgoing.geometry.control2, 1 - share)
            : { x: to.position.x - (to.position.x - from.position.x) / 3,
                y: to.position.y - (to.position.y - from.position.y) / 3 },
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

  // Notches move on *arc-length* share, not the handle ratio above: a notch is
  // positioned by how far along the seam it sits, so the proportion that
  // matters is how much of the seam's length each original edge contributed.
  const notches: Notch[] = piece.notches.map((notch) => {
    if (notch.segmentId === incoming.id) {
      return { ...notch, segmentId: mergedId, t: notch.t * arcShare };
    }
    if (notch.segmentId === outgoing.id) {
      return { ...notch, segmentId: mergedId, t: arcShare + notch.t * (1 - arcShare) };
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
