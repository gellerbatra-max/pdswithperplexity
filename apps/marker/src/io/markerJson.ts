/**
 * The native `.marker.json` format.
 *
 * Reading always goes through `migrate`, so a file written by an older build
 * opens rather than half-loading. Pure: text in, document out.
 */

import { migrate } from '@/marker/migrations';
import type { MarkerDocument } from '@/marker/schema';

export const MARKER_FILE_EXTENSION = '.marker.json';
export const MARKER_MIME_TYPE = 'application/json';

/** Indented: these files get read and diffed by hand often enough to matter. */
export const serializeMarker = (document: MarkerDocument): string =>
  JSON.stringify(document, null, 2);

export class MarkerFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarkerFileError';
  }
}

export const parseMarker = (text: string): MarkerDocument => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new MarkerFileError(
      `Not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}`,
    );
  }
  // migrate() rejects anything that is not a document, and upgrades old ones.
  return migrate(raw);
};

/** A filename safe on every platform, derived from the marker's own name. */
export const markerFileName = (document: MarkerDocument): string => {
  const base = document.name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-');
  return `${base === '' ? 'marker' : base}${MARKER_FILE_EXTENSION}`;
};
