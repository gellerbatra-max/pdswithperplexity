/**
 * Schema versioning for marker documents.
 *
 * Pure and deterministic: no clock, no randomness. Anything missing gets an
 * obvious sentinel default rather than an invented value, so a caller can tell
 * "the file didn't say" from "the file said zero".
 *
 * Schema v1 was never written down, so this migration is defensive rather than
 * a field-by-field mapping — it reads whatever is present at any version and
 * fills the rest.
 */

import { CURRENT_SCHEMA_VERSION } from './schema';
import type {
  ApprovalState,
  ComparisonLayer,
  CutterBuffer,
  DefectZone,
  LayDirection,
  MarkerDocument,
  MarkerOrder,
  PlacedPiece,
  Point,
  RotationRule,
  SizeEntry,
  SpliceLine,
  TrayPiece,
} from './schema';

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

/** Stand-in for an absent timestamp — recognisable on sight as "never set". */
const EPOCH = '1970-01-01T00:00:00.000Z';

const DEFAULT_FABRIC_CODE = 'A';
const DEFAULT_END_ALLOWANCE = 4;

const ROTATION_RULES: readonly RotationRule[] = ['strict', '90ok', 'free'];
const APPROVAL_STATES: readonly ApprovalState[] = ['draft', 'needs_approval', 'approved'];
const LAY_DIRECTIONS: readonly LayDirection[] = ['2way', '4way', 'free'];
const CUTTER_BUFFERS: readonly CutterBuffer[] = [0, 0.3, 0.5, 1];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback;

const asNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

// The `find` narrows to the union member by identity, so the result is already
// the literal type — no assertion needed.
const asMember = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.find((candidate) => candidate === value) ?? fallback;

const asCutterBuffer = (value: unknown): CutterBuffer =>
  CUTTER_BUFFERS.find((candidate) => candidate === value) ?? 0;

const asPoint = (value: unknown): Point => {
  const record = asRecord(value);
  return { x: asNumber(record.x, 0), y: asNumber(record.y, 0) };
};

const asPolygon = (value: unknown): Point[] => asArray(value).map(asPoint);

const asPlacedPiece = (value: unknown, index: number): PlacedPiece => {
  const record = asRecord(value);
  const piece: PlacedPiece = {
    id: asString(record.id, `piece-${index}`),
    pieceDefId: asString(record.pieceDefId, ''),
    name: asString(record.name, ''),
    size: asString(record.size, ''),
    bundle: asString(record.bundle, ''),
    fabricCode: asString(record.fabricCode, DEFAULT_FABRIC_CODE),
    geometry: asPolygon(record.geometry),
    position: asPoint(record.position),
    rotation: asNumber(record.rotation, 0),
    flipped: asBoolean(record.flipped, false),
    placed: true,
    blocked: asBoolean(record.blocked, false),
  };
  // exactOptionalPropertyTypes: an absent optional must stay absent, not undefined.
  if (typeof record.cutSequence === 'number') piece.cutSequence = record.cutSequence;
  if (typeof record.bufferOverride === 'number') piece.bufferOverride = record.bufferOverride;
  return piece;
};

const asTrayPiece = (value: unknown, index: number): TrayPiece => {
  const record = asRecord(value);
  return {
    id: asString(record.id, `tray-${index}`),
    name: asString(record.name, ''),
    size: asString(record.size, ''),
    bundle: asString(record.bundle, ''),
    fabricCode: asString(record.fabricCode, DEFAULT_FABRIC_CODE),
    geometry: asPolygon(record.geometry),
    layDirection: asMember(record.layDirection, LAY_DIRECTIONS, 'free'),
    quantity: asNumber(record.quantity, 0),
    placed: asNumber(record.placed, 0),
  };
};

const asDefectZone = (value: unknown, index: number): DefectZone => {
  const record = asRecord(value);
  return {
    id: asString(record.id, `defect-${index}`),
    x: asNumber(record.x, 0),
    y: asNumber(record.y, 0),
    width: asNumber(record.width, 0),
    height: asNumber(record.height, 0),
  };
};

const asSpliceLine = (value: unknown, index: number): SpliceLine => {
  const record = asRecord(value);
  return { id: asString(record.id, `splice-${index}`), x: asNumber(record.x, 0) };
};

const asSizeEntry = (value: unknown): SizeEntry => {
  const record = asRecord(value);
  return {
    size: asString(record.size, ''),
    quantity: asNumber(record.quantity, 0),
    fabricCode: asString(record.fabricCode, DEFAULT_FABRIC_CODE),
  };
};

const asOrder = (value: unknown): MarkerOrder => {
  const record = asRecord(value);
  return { model: asString(record.model, ''), sizes: asArray(record.sizes).map(asSizeEntry) };
};

const asComparison = (value: unknown): ComparisonLayer => {
  const record = asRecord(value);
  return {
    markerName: asString(record.markerName, ''),
    pieces: asArray(record.pieces).map(asPlacedPiece),
    opacity: asNumber(record.opacity, 1),
    offsetX: asNumber(record.offsetX, 0),
    offsetY: asNumber(record.offsetY, 0),
    visible: asBoolean(record.visible, true),
  };
};

/**
 * Bring any stored marker document up to the current schema version.
 *
 * Throws when the input is not a document at all, or when it was written by a
 * newer build — downgrading would silently discard fields this version cannot
 * represent.
 */
export const migrate = (raw: unknown): MarkerDocument => {
  if (!isRecord(raw)) {
    throw new MigrationError(`Expected a marker document object, received ${typeof raw}`);
  }

  const version = asNumber(raw.schemaVersion, 1);
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new MigrationError(
      `Document is schemaVersion ${version}, which is newer than this build supports (${CURRENT_SCHEMA_VERSION})`,
    );
  }

  const id = asString(raw.id, '');
  if (id === '') {
    throw new MigrationError('Document is missing an id; it cannot be stored or reopened');
  }

  const document: MarkerDocument = {
    id,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: asString(raw.name, ''),
    fabricWidth: asNumber(raw.fabricWidth, 0),
    endAllowance: asNumber(raw.endAllowance, DEFAULT_END_ALLOWANCE),
    rotationRule: asMember(raw.rotationRule, ROTATION_RULES, 'strict'),
    cutterBuffer: asCutterBuffer(raw.cutterBuffer),
    pieces: asArray(raw.pieces).map(asPlacedPiece),
    trayPieces: asArray(raw.trayPieces).map(asTrayPiece),
    defectZones: asArray(raw.defectZones).map(asDefectZone),
    spliceLines: asArray(raw.spliceLines).map(asSpliceLine),
    order: asOrder(raw.order),
    approvalState: asMember(raw.approvalState, APPROVAL_STATES, 'draft'),
    createdAt: asString(raw.createdAt, EPOCH),
    updatedAt: asString(raw.updatedAt, EPOCH),
  };
  if (raw.comparison !== undefined) document.comparison = asComparison(raw.comparison);
  return document;
};
