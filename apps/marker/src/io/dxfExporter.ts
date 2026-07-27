/**
 * AAMA-style DXF export, R12.
 *
 * R12 (AC1009) is what AccuMark and every other cutting-room system will
 * accept without argument. It predates LWPOLYLINE, so outlines go out as
 * POLYLINE / VERTEX / SEQEND — writing an LWPOLYLINE into a file that claims
 * to be R12 is the classic way to produce something that opens in a modern
 * viewer and is rejected by the machine that matters.
 *
 * Structure mirrors what the importer reads, so a marker survives a round
 * trip: one BLOCK per piece definition, one INSERT per placed piece, and the
 * piece metadata on ATTRIBs.
 *
 * Pure: document in, text out.
 */

import { orientedGeometry } from '@/marker/pieceGeometry';
import type { MarkerDocument, PlacedPiece, Point } from '@/marker/schema';

/** DXF is a stream of (group code, value) line pairs. */
const pair = (code: number, value: string | number): string => `${code}\n${value}`;

const lines = (...parts: string[]): string => parts.join('\n');

/** Enough precision for a cutter; more just bloats the file. */
const num = (value: number): string => value.toFixed(4);

export const BOUNDARY_LAYER = '1';
const TEXT_LAYER = '8';

const ATTRIBUTES: readonly { tag: string; of: (piece: PlacedPiece) => string }[] = [
  { tag: 'PIECE NAME', of: (piece) => piece.name },
  { tag: 'SIZE', of: (piece) => piece.size },
  { tag: 'BUNDLE', of: (piece) => piece.bundle },
  { tag: 'FABRIC', of: (piece) => piece.fabricCode },
];

const header = (doc: MarkerDocument, extent: { maxX: number; maxY: number }): string =>
  lines(
    pair(0, 'SECTION'),
    pair(2, 'HEADER'),
    pair(9, '$ACADVER'),
    pair(1, 'AC1009'),
    pair(9, '$INSBASE'),
    pair(10, num(0)),
    pair(20, num(0)),
    pair(30, num(0)),
    pair(9, '$EXTMIN'),
    pair(10, num(0)),
    pair(20, num(0)),
    pair(30, num(0)),
    pair(9, '$EXTMAX'),
    pair(10, num(extent.maxX)),
    pair(20, num(doc.fabricWidth)),
    pair(30, num(0)),
    // 1 drawing unit is 1 cm. $INSUNITS is R13+, so this is a comment for a
    // human; the unit heuristic on import is what actually recovers it.
    pair(9, '$LIMMAX'),
    pair(10, num(extent.maxX)),
    pair(20, num(doc.fabricWidth)),
    pair(0, 'ENDSEC'),
  );

/** R12 requires every referenced layer to exist in the LAYER table. */
const tables = (): string =>
  lines(
    pair(0, 'SECTION'),
    pair(2, 'TABLES'),
    pair(0, 'TABLE'),
    pair(2, 'LAYER'),
    pair(70, 2),
    ...[BOUNDARY_LAYER, TEXT_LAYER].map((layer) =>
      lines(
        pair(0, 'LAYER'),
        pair(2, layer),
        pair(70, 0),
        // 7 is white/black — whatever contrasts with the viewer's background.
        pair(62, 7),
        pair(6, 'CONTINUOUS'),
      ),
    ),
    pair(0, 'ENDTAB'),
    pair(0, 'ENDSEC'),
  );

const polyline = (points: readonly Point[], layer: string): string =>
  lines(
    pair(0, 'POLYLINE'),
    pair(8, layer),
    pair(66, 1),
    pair(10, num(0)),
    pair(20, num(0)),
    pair(30, num(0)),
    // 1 closes the polyline, which a piece outline always is.
    pair(70, 1),
    ...points.map((point) =>
      lines(pair(0, 'VERTEX'), pair(8, layer), pair(10, num(point.x)), pair(20, num(point.y))),
    ),
    pair(0, 'SEQEND'),
    pair(8, layer),
  );

/** An ATTRIB is only strictly valid if its block declares a matching ATTDEF. */
const attdef = (tag: string, index: number): string =>
  lines(
    pair(0, 'ATTDEF'),
    pair(8, TEXT_LAYER),
    pair(10, num(0)),
    pair(20, num(-index - 1)),
    pair(40, num(1)),
    pair(1, ''),
    pair(3, tag),
    pair(2, tag),
    pair(70, 0),
  );

const attrib = (tag: string, value: string, index: number, at: Point): string =>
  lines(
    pair(0, 'ATTRIB'),
    pair(8, TEXT_LAYER),
    pair(10, num(at.x)),
    pair(20, num(at.y - index - 1)),
    pair(40, num(1)),
    pair(1, value),
    pair(2, tag),
    pair(70, 0),
  );

/**
 * One block per distinct piece definition.
 *
 * Pieces cut from the same definition share a block, so a marker with twenty
 * of the same sleeve carries the outline once.
 */
const blocks = (doc: MarkerDocument): { text: string; blockOf: Map<string, string> } => {
  const blockOf = new Map<string, string>();
  const bodies: string[] = [];
  const used = new Set<string>();

  for (const piece of doc.pieces) {
    // Rotation and flip belong on the INSERT, so the block holds the piece as
    // drawn — that is what makes one block serve every copy.
    const key = piece.pieceDefId === '' ? piece.id : piece.pieceDefId;
    if (blockOf.has(key)) continue;

    let name = (piece.name === '' ? key : piece.name).toUpperCase().replace(/[^A-Z0-9_-]/g, '_');
    while (used.has(name)) name = `${name}_`;
    used.add(name);
    blockOf.set(key, name);

    bodies.push(
      lines(
        pair(0, 'BLOCK'),
        pair(2, name),
        pair(8, BOUNDARY_LAYER),
        pair(70, 2),
        pair(10, num(0)),
        pair(20, num(0)),
        pair(30, num(0)),
        polyline(piece.geometry, BOUNDARY_LAYER),
        ...ATTRIBUTES.map((attribute, index) => attdef(attribute.tag, index)),
        pair(0, 'ENDBLK'),
      ),
    );
  }

  return {
    text: lines(pair(0, 'SECTION'), pair(2, 'BLOCKS'), ...bodies, pair(0, 'ENDSEC')),
    blockOf,
  };
};

const entities = (doc: MarkerDocument, blockOf: ReadonlyMap<string, string>): string => {
  const bodies: string[] = [];

  for (const piece of doc.pieces) {
    const key = piece.pieceDefId === '' ? piece.id : piece.pieceDefId;
    const name = blockOf.get(key);
    if (name === undefined) continue;

    bodies.push(
      lines(
        pair(0, 'INSERT'),
        // 1 says attributes follow, which is what makes the SEQEND required.
        pair(66, 1),
        pair(8, BOUNDARY_LAYER),
        pair(2, name),
        pair(10, num(piece.position.x)),
        pair(20, num(piece.position.y)),
        pair(30, num(0)),
        pair(41, num(piece.flipped ? -1 : 1)),
        pair(42, num(1)),
        pair(43, num(1)),
        pair(50, num(piece.rotation)),
        ...ATTRIBUTES.map((attribute, index) =>
          attrib(attribute.tag, attribute.of(piece), index, piece.position),
        ),
        pair(0, 'SEQEND'),
        pair(8, BOUNDARY_LAYER),
      ),
    );
  }

  return lines(pair(0, 'SECTION'), pair(2, 'ENTITIES'), ...bodies, pair(0, 'ENDSEC'));
};

const extentOf = (doc: MarkerDocument): { maxX: number; maxY: number } => {
  let maxX = 0;
  let maxY = doc.fabricWidth;
  for (const piece of doc.pieces) {
    for (const point of orientedGeometry(piece)) {
      maxX = Math.max(maxX, piece.position.x + point.x);
      maxY = Math.max(maxY, piece.position.y + point.y);
    }
  }
  return { maxX, maxY };
};

export const exportMarkerDxf = (doc: MarkerDocument): string => {
  const { text: blockText, blockOf } = blocks(doc);
  return `${lines(
    header(doc, extentOf(doc)),
    tables(),
    blockText,
    entities(doc, blockOf),
    pair(0, 'EOF'),
  )}\n`;
};

export const DXF_FILE_EXTENSION = '.dxf';
export const DXF_MIME_TYPE = 'application/dxf';
