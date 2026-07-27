/**
 * The pattern document model.
 *
 * This module owns the schema and pure read helpers only — no React, no state
 * management, no rendering. The live document lives in `@/store`; anything that
 * needs to interpret its shape imports from here.
 */

export type {
  DocumentId,
  PieceId,
  PointId,
  SegmentId,
  GrainLineId,
  NotchId,
  InternalLineId,
  MeasurementId,
  GradeRuleId,
  SizeId,
} from './ids';
export { createId } from './ids';
export { clonePiece } from './duplicate';
export { seamAllowanceRing } from './seamAllowance';
export type {
  PointDeltas,
  HandleKind,
  InsertPointResult,
  RemovePointResult,
  AddNotchResult,
} from './edit';
export {
  translatePoints,
  translatePiece,
  setPointPosition,
  translateSegment,
  setSegmentKind,
  setSegmentSeamAllowance,
  setSegmentHandle,
  insertPointOnSegment,
  removePoint,
  pointRemovalBlocker,
  addNotch,
  removeNotch,
  setPointRole,
  setNotchParameter,
  setNotchKind,
} from './edit';

export type {
  LineGeometry,
  CubicGeometry,
  ArcGeometry,
  SegmentGeometry,
} from './curve';
export {
  LINE,
  FLATTEN_TOLERANCE_MM,
  flattenSegment,
  pointOnSegment,
  tangentOnSegment,
  splitSegment,
  segmentArcLength,
  parameterAtLength,
  nearestOnSegment,
  resolveArc,
} from './curve';
export type { SplitResult, NearestResult } from './curve';

export type {
  PointRole,
  PiecePoint,
  SeamFinish,
  PieceSegment,
  PieceCategory,
  PieceMeta,
  PatternPiece,
} from './piece';

export type {
  GrainLineKind,
  GrainLine,
  NotchKind,
  Notch,
  InternalLineRole,
  InternalLine,
} from './annotations';

export type {
  SizeDefinition,
  SizeRange,
  GradeIncrement,
  GradeRule,
} from './grading';
export { findIncrement } from './grading';

export type { NestedSize, GradeVector } from './nest';
export { gradePiece, nestPiece, gradeVectors, pointDelta } from './nest';

export type {
  MeasurementKind,
  MeasurementRef,
  MeasurementLink,
} from './measurement';
export type { MeasurementResult } from './measure';
export { evaluateMeasurement, evaluateMeasurements } from './measure';

export type { StyleInfo, PatternDocument } from './document';
export { PATTERN_SCHEMA_VERSION } from './document';

export {
  findPoint,
  findSegment,
  findPiece,
  segmentEndpoints,
  pointAlongSegment,
  boundarySegments,
  outlinePoints,
  pointPositions,
  pieceBounds,
  documentBounds,
  segmentLength,
  outlineLength,
  projectOntoBoundary,
  lengthAlongSegment,
} from './resolve';
export type { SegmentProjection } from './resolve';
