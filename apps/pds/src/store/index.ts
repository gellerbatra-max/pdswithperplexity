export type {
  SaveState,
  LayerId,
  LayerVisibility,
  WorkspaceId,
  ToolId,
  ToolStatus,
  ToolDescriptor,
} from './types';
export { WORKSPACE_IDS } from './types';
export { createSeedDocument, createEmptyDocument, SIZE_RANGE } from './seedDocument';
export { useDocumentStore } from './documentStore';
export type { DocumentState } from './documentStore';
export {
  renameDocument,
  addPiece,
  removePiece,
  renamePiece,
  updatePiece,
  updatePieceMeta,
  duplicatePiece,
} from './documentCommands';
export { flushAutosave, hydrateFromAutosave } from './persistence';
export type { SelectionRef, SelectionKind } from './selection';
export {
  pieceRef,
  pointRef,
  segmentRef,
  selectionKey,
  sameRef,
  refExists,
  describeSelection,
} from './selection';
export { usePreviewStore } from './previewStore';
export type { PreviewState } from './previewStore';
export {
  movePoints,
  moveSegment,
  setPointPosition,
  setSegmentKind,
  setSegmentSeamAllowance,
  setSegmentHandle,
  insertPoint,
  deletePoint,
  addNotch,
  removeNotch,
  setPointRole,
  setNotchDistance,
  setNotchKind,
} from './geometryCommands';
export { useSelectionStore } from './selectionStore';
export type { SelectionState } from './selectionStore';
export { LAYERS, DEFAULT_LAYER_VISIBILITY, findLayer } from './layers';
export type { LayerDescriptor } from './layers';
export { useViewportStore } from './viewportStore';
export type { ViewportState } from './viewportStore';
export { useGradeStore } from './gradeStore';
export type { GradeState } from './gradeStore';
export { useHistoryStore } from './historyStore';
export type { HistoryState, DocumentCommand, HistoryEntry } from './historyStore';
export {
  useUiStore,
  CONTEXT_WIDTH_MIN,
  CONTEXT_WIDTH_MAX,
  CONTEXT_WIDTH_DEFAULT,
} from './uiStore';
export type { UiState } from './uiStore';
