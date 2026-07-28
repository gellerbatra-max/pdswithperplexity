/**
 * Creating and copying marker documents.
 *
 * The clock and the id generator are injectable, so the same code that runs in
 * the app runs in a test without either.
 */

import { CURRENT_SCHEMA_VERSION, type MarkerDocument, type TrayPiece } from './schema';

export const DEFAULT_FABRIC_WIDTH = 150;
export const DEFAULT_MARKER_NAME = 'Untitled marker';

export interface CreateMarkerOptions {
  readonly name?: string;
  readonly fabricWidth?: number;
  readonly trayPieces?: readonly TrayPiece[];
  readonly orderModel?: string;
  readonly id?: string;
  readonly now?: string;
}

export const createMarker = (options: CreateMarkerOptions = {}): MarkerDocument => {
  const now = options.now ?? new Date().toISOString();
  const name = options.name?.trim();

  return {
    id: options.id ?? crypto.randomUUID(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: name === undefined || name === '' ? DEFAULT_MARKER_NAME : name,
    fabricWidth:
      options.fabricWidth !== undefined && options.fabricWidth > 0
        ? options.fabricWidth
        : DEFAULT_FABRIC_WIDTH,
    endAllowance: 4,
    rotationRule: '90ok',
    cutterBuffer: 0.3,
    pieces: [],
    trayPieces: [...(options.trayPieces ?? [])],
    defectZones: [],
    spliceLines: [],
    order: { model: options.orderModel ?? '', sizes: [] },
    approvalState: 'draft',
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };
};

/**
 * A copy that is a separate document in every way that matters.
 *
 * New id, new timestamps, and a name that says what it is. Sharing an id would
 * make the duplicate overwrite its original on the next auto-save; sharing
 * `createdAt` would misreport when the work began.
 */
export const duplicateMarker = (
  source: MarkerDocument,
  options: { id?: string; now?: string; name?: string } = {},
): MarkerDocument => {
  const now = options.now ?? new Date().toISOString();
  return {
    ...structuredClone(source),
    id: options.id ?? crypto.randomUUID(),
    name: options.name ?? copyName(source.name),
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };
};

/**
 * "Front tee" → "Front tee (copy)" → "Front tee (copy 2)".
 *
 * Duplicating a duplicate should not produce "(copy) (copy)".
 */
export const copyName = (name: string): string => {
  const match = /^(.*) \(copy(?: (\d+))?\)$/.exec(name);
  if (!match) return `${name} (copy)`;
  const base = match[1] ?? name;
  const n = match[2] === undefined ? 2 : Number.parseInt(match[2], 10) + 1;
  return `${base} (copy ${n})`;
};
