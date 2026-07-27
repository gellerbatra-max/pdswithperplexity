/**
 * The marker document model.
 *
 * All coordinates are in CENTIMETRES. Origin 0,0 is the bottom-left corner of
 * the fabric: width runs right (+X), length runs up (+Y). The canvas converts
 * to pixels; nothing in this module knows about screens.
 */

export const CURRENT_SCHEMA_VERSION = 3;

export interface Point {
  x: number;
  y: number;
}

export interface MarkerDocument {
  id: string;
  schemaVersion: 3;
  name: string;
  fabricWidth: number;
  endAllowance: number;
  rotationRule: RotationRule;
  cutterBuffer: CutterBuffer;
  pieces: PlacedPiece[];
  trayPieces: TrayPiece[];
  defectZones: DefectZone[];
  spliceLines: SpliceLine[];
  order: MarkerOrder;
  approvalState: ApprovalState;
  comparison?: ComparisonLayer;
  createdAt: string;
  updatedAt: string;
  /**
   * When this marker was last opened, as distinct from last written.
   *
   * Auto-save touches `updatedAt` on every edit, so ordering by it answers
   * "most recently changed", not "most recently worked on". Reopening the
   * right marker needs the latter. Added in schemaVersion 3.
   */
  lastOpenedAt: string;
}

export type RotationRule = 'strict' | '90ok' | 'free';

/** Gap held around every piece, in cm. A closed set so the UI can offer it as a picker. */
export type CutterBuffer = 0 | 0.3 | 0.5 | 1;

export type ApprovalState = 'draft' | 'needs_approval' | 'approved';

export interface PlacedPiece {
  id: string;
  /** References the `TrayPiece.id` this was instantiated from. */
  pieceDefId: string;
  name: string;
  size: string;
  bundle: string;
  /** Max 4 characters, default 'A'. */
  fabricCode: string;
  /** Polygon boundary, before `position`/`rotation`/`flipped` are applied. */
  geometry: Point[];
  position: Point;
  /** Degrees, positive = counter-clockwise. */
  rotation: number;
  /** Horizontal flip, applied before rotation. */
  flipped: boolean;
  placed: true;
  cutSequence?: number;
  /** Overrides `MarkerDocument.cutterBuffer` for this piece alone. */
  bufferOverride?: number;
  /** When true the whole bounding box is treated as a solid obstacle. */
  blocked: boolean;
}

export interface TrayPiece {
  id: string;
  name: string;
  size: string;
  bundle: string;
  fabricCode: string;
  /** Polygon at origin, unplaced. */
  geometry: Point[];
  layDirection: LayDirection;
  quantity: number;
  /** How many instances are currently on the marker. */
  placed: number;
}

export type LayDirection = '2way' | '4way' | 'free';

export interface MarkerOrder {
  model: string;
  sizes: SizeEntry[];
}

export interface SizeEntry {
  size: string;
  quantity: number;
  fabricCode: string;
}

export interface DefectZone {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpliceLine {
  id: string;
  /** Position along the marker length, in cm. */
  x: number;
}

export interface ComparisonLayer {
  markerName: string;
  pieces: PlacedPiece[];
  /** 0–1. */
  opacity: number;
  offsetX: number;
  offsetY: number;
  visible: boolean;
}
