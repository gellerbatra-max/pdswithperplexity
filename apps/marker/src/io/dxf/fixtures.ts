/**
 * Builders for synthetic DXF text.
 *
 * Hand-writing group-code pairs inline makes a test unreadable and hides what
 * it is actually asserting, so the shape of a DXF file lives here instead.
 * Test-only, but not a .test.ts file — vitest would try to run it.
 */

export const pairs = (...values: (string | number)[]): string => {
  const lines: string[] = [];
  for (let i = 0; i + 1 < values.length; i += 2) {
    lines.push(String(values[i]), String(values[i + 1]));
  }
  return lines.join('\n');
};

export const section = (name: string, body: string): string =>
  pairs(0, 'SECTION', 2, name) + (body === '' ? '' : `\n${body}`) + '\n' + pairs(0, 'ENDSEC');

export const dxf = (...sections: string[]): string =>
  [...sections, pairs(0, 'EOF')].join('\n');

/** A closed LWPOLYLINE rectangle on a layer. */
export const polylineRect = (
  x: number,
  y: number,
  width: number,
  height: number,
  layer = 'PIECE',
): string =>
  pairs(
    0,
    'LWPOLYLINE',
    8,
    layer,
    90,
    4,
    70,
    1,
    10,
    x,
    20,
    y,
    10,
    x + width,
    20,
    y,
    10,
    x + width,
    20,
    y + height,
    10,
    x,
    20,
    y + height,
  );

/** One LINE segment on a layer. */
export const line = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  layer = 'PIECE',
): string => pairs(0, 'LINE', 8, layer, 10, x1, 20, y1, 11, x2, 21, y2);

/** Four LINEs that together enclose a rectangle, deliberately out of order. */
export const scatteredRect = (
  x: number,
  y: number,
  width: number,
  height: number,
  layer = 'PIECE',
): string =>
  [
    line(x + width, y, x + width, y + height, layer),
    line(x, y + height, x, y, layer),
    line(x, y, x + width, y, layer),
    line(x + width, y + height, x, y + height, layer),
  ].join('\n');

export const block = (name: string, body: string): string =>
  pairs(0, 'BLOCK', 2, name, 10, 0, 20, 0) + `\n${body}\n` + pairs(0, 'ENDBLK');

export const insert = (
  name: string,
  x: number,
  y: number,
  options: { rotation?: number; scaleX?: number; scaleY?: number; attribs?: [string, string][] } = {},
): string => {
  const head = pairs(
    0,
    'INSERT',
    2,
    name,
    10,
    x,
    20,
    y,
    41,
    options.scaleX ?? 1,
    42,
    options.scaleY ?? 1,
    50,
    options.rotation ?? 0,
  );
  const attribs = (options.attribs ?? [])
    .map(([tag, value]) => pairs(0, 'ATTRIB', 2, tag, 1, value))
    .join('\n');
  return [head, attribs, pairs(0, 'SEQEND')].filter((part) => part !== '').join('\n');
};
