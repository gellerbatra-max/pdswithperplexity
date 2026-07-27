import type { Vec2 } from '@/geometry';
import {
  addNotch as applyAddNotch,
  setPointRole as applyPointRole,
  setNotchParameter as applyNotchParameter,
  setNotchKind as applyNotchKind,
  parameterAtLength,
  segmentEndpoints,
  insertPointOnSegment as applyInsertPoint,
  removeNotch as applyRemoveNotch,
  removePoint as applyRemovePoint,
  setPointPosition as applyPointPosition,
  setSegmentHandle as applySegmentHandle,
  setSegmentKind as applySegmentKind,
  setSegmentSeamAllowance as applySegmentSeamAllowance,
  translatePoints as applyTranslatePoints,
  findPoint,
  findSegment,
  pointRemovalBlocker,
  type HandleKind,
  type MeasurementLink,
  type NotchId,
  type NotchKind,
  type PointRole,
  type PatternDocument,
  type PatternPiece,
  type PieceId,
  type PointDeltas,
  type PointId,
  type SegmentId,
} from '@/pattern';
import { useDocumentStore } from './documentStore';
import { useHistoryStore } from './historyStore';

/**
 * Geometry edits, as undoable commands.
 *
 * Same contract as `documentCommands.ts`: read the live document, build a
 * command that can reverse exactly what it is about to do, run it through
 * `historyStore`. No geometry mutation should reach the document any other way.
 *
 * Each `undo` restores the piece object captured before the edit rather than
 * applying an inverse transform. For a translation the two are equivalent, but
 * capturing the original is also correct for edits that lose information —
 * flattening a curve to a line throws its handles away, and only the captured
 * piece can bring them back.
 */

const requirePiece = (id: PieceId, action: string): PatternPiece => {
  const piece = useDocumentStore.getState().document.pieces.find((p) => p.id === id);
  if (!piece) throw new Error(`${action}: no piece with id "${id}"`);
  return piece;
};

const replacePiece = (
  document: PatternDocument,
  id: PieceId,
  next: PatternPiece,
): PatternDocument => ({
  ...document,
  pieces: document.pieces.map((p) => (p.id === id ? next : p)),
});

/**
 * Applies `change` to whichever piece carries `id` in the document being
 * operated on, so redo works against the document as it stands rather than the
 * one captured when the command was built.
 */
const editPiece = (
  document: PatternDocument,
  id: PieceId,
  change: (piece: PatternPiece) => PatternPiece,
): PatternDocument => {
  const piece = document.pieces.find((p) => p.id === id);
  return piece ? replacePiece(document, id, change(piece)) : document;
};

const round = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

/**
 * Moves points by an absolute total delta measured from `origin` — the piece as
 * it was when the drag began.
 *
 * The delta is absolute rather than incremental *because* these commands
 * coalesce: a drag fires one command per pointermove, and only the last of a
 * coalesced run is replayed on redo. An incremental delta would replay as a
 * single small step and lose the rest of the drag.
 */
export const movePoints = (
  pieceId: PieceId,
  pointIds: readonly PointId[],
  delta: Vec2,
  origin: PatternPiece,
  options: { readonly label?: string; readonly detail?: string } = {},
): void => {
  if (pointIds.length === 0) return;
  const before = requirePiece(pieceId, 'movePoints');

  const deltas: PointDeltas = new Map(pointIds.map((id) => [id, delta]));
  const moved = applyTranslatePoints(origin, deltas);

  useHistoryStore.getState().execute({
    label: options.label ?? (pointIds.length === 1 ? 'Move point' : 'Move points'),
    detail:
      options.detail ??
      `${before.name} · ${round(delta.x)}, ${round(delta.y)} mm`,
    // One entry per drag, not per pointermove.
    coalesceKey: `move-points:${pieceId}:${pointIds.join(',')}`,
    do: (document) => replacePiece(document, pieceId, moved),
    undo: (document) => replacePiece(document, pieceId, before),
  });
};

/** Numeric point placement, from the inspector. */
export const setPointPosition = (
  pieceId: PieceId,
  pointId: PointId,
  position: Vec2,
): void => {
  const before = requirePiece(pieceId, 'setPointPosition');
  const point = findPoint(before, pointId);
  if (!point) throw new Error(`setPointPosition: no point "${pointId}"`);
  if (point.position.x === position.x && point.position.y === position.y) return;

  useHistoryStore.getState().execute({
    label: 'Move point',
    detail: `${before.name} · ${point.label ?? point.role} → ${round(position.x)}, ${round(position.y)}`,
    // Typing into an X or Y field fires per keystroke; one field, one step.
    coalesceKey: `set-point:${pieceId}:${pointId}`,
    do: (document) => editPiece(document, pieceId, (p) => applyPointPosition(p, pointId, position)),
    undo: (document) => replacePiece(document, pieceId, before),
  });
};

/** Moves a whole segment rigidly, from a drag on the edge. */
export const moveSegment = (
  pieceId: PieceId,
  segmentId: SegmentId,
  delta: Vec2,
  origin: PatternPiece,
): void => {
  const before = requirePiece(pieceId, 'moveSegment');
  const segment = findSegment(before, segmentId);
  if (!segment) throw new Error(`moveSegment: no segment "${segmentId}"`);

  const deltas: PointDeltas = new Map([
    [segment.from, delta],
    [segment.to, delta],
  ]);
  const moved = applyTranslatePoints(origin, deltas);

  useHistoryStore.getState().execute({
    label: 'Move segment',
    detail: `${before.name} · ${segment.label ?? 'edge'} · ${round(delta.x)}, ${round(delta.y)} mm`,
    coalesceKey: `move-segment:${pieceId}:${segmentId}`,
    do: (document) => replacePiece(document, pieceId, moved),
    undo: (document) => replacePiece(document, pieceId, before),
  });
};

/** Switches an edge between straight, Bezier and circular-arc geometry. */
export const setSegmentKind = (
  pieceId: PieceId,
  segmentId: SegmentId,
  kind: 'line' | 'cubic' | 'arc',
): void => {
  const before = requirePiece(pieceId, 'setSegmentKind');
  const segment = findSegment(before, segmentId);
  if (!segment || segment.geometry.kind === kind) return;

  useHistoryStore.getState().execute({
    label: kind === 'line' ? 'Straighten edge' : kind === 'arc' ? 'Arc edge' : 'Curve edge',
    detail: `${before.name} · ${segment.label ?? 'edge'}`,
    do: (document) => editPiece(document, pieceId, (p) => applySegmentKind(p, segmentId, kind)),
    undo: (document) => replacePiece(document, pieceId, before),
  });
};

/** Sets or clears a per-segment seam allowance override. */
export const setSegmentSeamAllowance = (
  pieceId: PieceId,
  segmentId: SegmentId,
  allowance: number | undefined,
): void => {
  const before = requirePiece(pieceId, 'setSegmentSeamAllowance');
  const segment = findSegment(before, segmentId);
  if (!segment) throw new Error(`setSegmentSeamAllowance: no segment "${segmentId}"`);

  useHistoryStore.getState().execute({
    label: allowance === undefined ? 'Clear edge allowance' : 'Change edge allowance',
    detail: `${before.name} · ${segment.label ?? 'edge'}${
      allowance === undefined ? ' → piece default' : ` → ${round(allowance)}mm`
    }`,
    coalesceKey: `segment-allowance:${pieceId}:${segmentId}`,
    do: (document) =>
      editPiece(document, pieceId, (p) => applySegmentSeamAllowance(p, segmentId, allowance)),
    undo: (document) => replacePiece(document, pieceId, before),
  });
};

/* --- Curve handles ---------------------------------------------------------- */

/**
 * Moves one cubic handle. This is the shape-changing edit — everything else
 * moves geometry around without altering the curve between its ends.
 */
export const setSegmentHandle = (
  pieceId: PieceId,
  segmentId: SegmentId,
  handle: HandleKind,
  position: Vec2,
  origin?: PatternPiece,
): void => {
  const before = requirePiece(pieceId, 'setSegmentHandle');
  const segment = findSegment(before, segmentId);
  if (!segment) throw new Error(`setSegmentHandle: no segment "${segmentId}"`);
  if (segment.geometry.kind !== 'cubic') return;

  // A drag passes the piece as it was when the gesture began, so the committed
  // result is derived the same way every preview frame was.
  const base = origin ?? before;

  useHistoryStore.getState().execute({
    label: 'Shape edge',
    detail: `${before.name} · ${segment.label ?? 'edge'}`,
    coalesceKey: `segment-handle:${pieceId}:${segmentId}:${handle}`,
    do: (document) =>
      replacePiece(document, pieceId, applySegmentHandle(base, segmentId, handle, position)),
    undo: (document) => replacePiece(document, pieceId, before),
  });
};

/* --- Topology --------------------------------------------------------------- */

/**
 * Rewrites the segment ids a measurement reads from.
 *
 * Splitting or merging an edge changes which segments exist, and measurement
 * links reference them by id. Left alone, a point-of-measure over a split seam
 * would either read half the seam or stop resolving — both silently wrong on a
 * spec sheet. Because `evaluateMeasurement` sums the lengths of the segments a
 * ref names, swapping one id for the two halves preserves the measured value
 * exactly, and merging back does the same in reverse.
 */
const remapMeasurements = (
  measurements: readonly MeasurementLink[],
  pieceId: PieceId,
  rewrite: (id: SegmentId) => readonly SegmentId[],
): readonly MeasurementLink[] =>
  measurements.map((link) => ({
    ...link,
    refs: link.refs.map((ref) => {
      if (ref.pieceId !== pieceId || !ref.segmentIds) return ref;
      const next: SegmentId[] = [];
      for (const id of ref.segmentIds) {
        for (const replacement of rewrite(id)) {
          // A merge maps both halves onto one id; keep it once.
          if (next[next.length - 1] !== replacement) next.push(replacement);
        }
      }
      return { ...ref, segmentIds: next };
    }),
  }));

/**
 * Drops measurement refs that name a point which no longer exists.
 *
 * A `point-to-point` ref needs exactly two points, so a ref left holding one is
 * dead weight that would quietly contribute nothing. Removing the whole ref
 * makes the loss legible — the measurement reports from whatever refs remain,
 * or reads as unlinked if none do. Undo restores them, since the command
 * captures the document's measurements before the edit.
 */
const dropMeasurementRefsUsing = (
  measurements: readonly MeasurementLink[],
  pieceId: PieceId,
  pointId: PointId,
): readonly MeasurementLink[] =>
  measurements.map((link) => ({
    ...link,
    refs: link.refs.filter(
      (ref) => !(ref.pieceId === pieceId && (ref.pointIds ?? []).includes(pointId)),
    ),
  }));

/**
 * Adds an outline point partway along an edge, splitting it in two.
 *
 * Exact: the outline does not move. Returns the new point's id so the caller
 * can select it, or null when the edge cannot be split.
 */
export const insertPoint = (
  pieceId: PieceId,
  segmentId: SegmentId,
  t: number,
): PointId | null => {
  const before = requirePiece(pieceId, 'insertPoint');
  const beforeMeasurements = useDocumentStore.getState().document.measurements;

  const result = applyInsertPoint(before, segmentId, t);
  if (!result) return null;

  const segment = findSegment(before, segmentId);
  const [leftId, rightId] = result.segmentIds;

  useHistoryStore.getState().execute({
    label: 'Insert point',
    detail: `${before.name} · ${segment?.label ?? 'edge'}`,
    do: (document) => ({
      ...replacePiece(document, pieceId, result.piece),
      measurements: remapMeasurements(document.measurements, pieceId, (id) =>
        id === segmentId ? [leftId, rightId] : [id],
      ),
    }),
    undo: (document) => ({
      ...replacePiece(document, pieceId, before),
      measurements: beforeMeasurements,
    }),
  });

  return result.pointId;
};

/**
 * Removes an outline point, merging the edges that met there.
 *
 * Unlike insert, this *does* change the outline — see `removePoint` in
 * `pattern/edit.ts`. Refuses rather than guessing when the point anchors a
 * grain line or internal line; `pointRemovalBlocker` gives the reason.
 */
export const deletePoint = (pieceId: PieceId, pointId: PointId): boolean => {
  const before = requirePiece(pieceId, 'deletePoint');
  const beforeMeasurements = useDocumentStore.getState().document.measurements;

  const blocker = pointRemovalBlocker(before, pointId);
  if (blocker !== null) return false;

  const result = applyRemovePoint(before, pointId);
  if (!result) return false;

  const point = findPoint(before, pointId);
  const [firstId, secondId] = result.replacedSegmentIds;

  useHistoryStore.getState().execute({
    label: 'Delete point',
    detail: `${before.name} · ${point?.label ?? point?.role ?? 'point'}`,
    do: (document) => ({
      ...replacePiece(document, pieceId, result.piece),
      measurements: dropMeasurementRefsUsing(
        remapMeasurements(document.measurements, pieceId, (id) =>
          id === firstId || id === secondId ? [result.segmentId] : [id],
        ),
        pieceId,
        pointId,
      ),
    }),
    undo: (document) => ({
      ...replacePiece(document, pieceId, before),
      measurements: beforeMeasurements,
    }),
  });

  return true;
};

/* --- Notches ---------------------------------------------------------------- */

/**
 * Places a notch on an edge and returns its id.
 *
 * Notches carry no document-level references, so unlike splitting an edge this
 * needs no measurement fixup — a notch is owned entirely by its piece.
 */
export const addNotch = (
  pieceId: PieceId,
  segmentId: SegmentId,
  t: number,
): NotchId | null => {
  const before = requirePiece(pieceId, 'addNotch');
  const segment = findSegment(before, segmentId);
  const result = applyAddNotch(before, segmentId, t);
  if (!result) return null;

  useHistoryStore.getState().execute({
    label: 'Add notch',
    detail: `${before.name} · ${segment?.label ?? 'edge'}`,
    /*
     * Applies the piece computed above rather than re-running the factory.
     * `addNotch` mints a fresh id on every call, so re-running it on redo would
     * put a *different* id in the document than the one this function handed
     * back — and the caller holding that id, or a later "remove this notch"
     * command, would then be pointing at nothing. `insertPoint` replays the
     * same way, for the same reason.
     */
    do: (document) => replacePiece(document, pieceId, result.piece),
    undo: (document) => replacePiece(document, pieceId, before),
  });

  return result.notchId;
};

export const removeNotch = (pieceId: PieceId, notchId: NotchId): void => {
  const before = requirePiece(pieceId, 'removeNotch');
  const notch = before.notches.find((n) => n.id === notchId);
  if (!notch) return;
  const segment = findSegment(before, notch.segmentId);

  useHistoryStore.getState().execute({
    label: 'Remove notch',
    detail: `${before.name} · ${notch.label ?? segment?.label ?? 'edge'}`,
    do: (document) => editPiece(document, pieceId, (p) => applyRemoveNotch(p, notchId)),
    undo: (document) => replacePiece(document, pieceId, before),
  });
};

/* --- Point role and notch placement ------------------------------------------ */

/**
 * Marks a point as smooth (`curve`) or hard (`corner`).
 *
 * Switching to `curve` also aligns the two handles meeting there, so the point
 * looks the way it now claims to behave — see `setPointRole` in `pattern/edit.ts`.
 * That is a geometry change, which is exactly why it goes on the undo stack.
 */
export const setPointRole = (
  pieceId: PieceId,
  pointId: PointId,
  role: PointRole,
): void => {
  const before = requirePiece(pieceId, 'setPointRole');
  const point = findPoint(before, pointId);
  if (!point || point.role === role) return;

  useHistoryStore.getState().execute({
    label: role === 'curve' ? 'Make point smooth' : 'Make point a corner',
    detail: `${before.name} · ${point.label ?? point.role}`,
    do: (document) => editPiece(document, pieceId, (p) => applyPointRole(p, pointId, role)),
    undo: (document) => replacePiece(document, pieceId, before),
  });
};

/**
 * Moves a notch to a distance in millimetres from the start of its seam.
 *
 * Notches are stored as a curve parameter but specified in millimetres, and on
 * anything but a straight edge the two are not proportional — so the conversion
 * runs through `parameterAtLength` rather than dividing by the length.
 */
export const setNotchDistance = (
  pieceId: PieceId,
  notchId: NotchId,
  millimetres: number,
): void => {
  const before = requirePiece(pieceId, 'setNotchDistance');
  const notch = before.notches.find((n) => n.id === notchId);
  if (!notch) throw new Error(`setNotchDistance: no notch "${notchId}"`);
  const segment = findSegment(before, notch.segmentId);
  if (!segment) return;
  const ends = segmentEndpoints(before, segment);
  if (!ends) return;

  const t = parameterAtLength(ends[0], ends[1], segment.geometry, millimetres);

  useHistoryStore.getState().execute({
    label: 'Move notch',
    detail: `${before.name} · ${segment.label ?? 'edge'} → ${round(millimetres)}mm`,
    coalesceKey: `notch-distance:${pieceId}:${notchId}`,
    do: (document) => editPiece(document, pieceId, (p) => applyNotchParameter(p, notchId, t)),
    undo: (document) => replacePiece(document, pieceId, before),
  });
};

/** Changes a notch's shape — slit, V, castle and so on. */
export const setNotchKind = (
  pieceId: PieceId,
  notchId: NotchId,
  kind: NotchKind,
): void => {
  const before = requirePiece(pieceId, 'setNotchKind');
  const notch = before.notches.find((n) => n.id === notchId);
  if (!notch || notch.kind === kind) return;

  useHistoryStore.getState().execute({
    label: 'Change notch type',
    detail: `${before.name} · ${notch.kind} → ${kind}`,
    do: (document) => editPiece(document, pieceId, (p) => applyNotchKind(p, notchId, kind)),
    undo: (document) => replacePiece(document, pieceId, before),
  });
};
