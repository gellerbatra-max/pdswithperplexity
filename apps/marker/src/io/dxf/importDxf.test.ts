import { describe, expect, it } from 'vitest';
import { block, dxf, insert, line, pairs, polylineRect, scatteredRect, section } from './fixtures';
import { importDxf } from './importDxf';

/** Bounding-box span of a piece outline. */
const span = (points: readonly { x: number; y: number }[]) => {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
};

describe('rejecting non-DXF input', () => {
  it('warns rather than throwing on empty text', () => {
    const result = importDxf('');
    expect(result.pieces).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/is this a DXF file/i);
  });

  it('warns rather than throwing on unrelated text', () => {
    const result = importDxf('this is a shopping list\nmilk\neggs\n');
    expect(result.pieces).toEqual([]);
  });
});

describe('closed polylines', () => {
  it('reads a single piece', () => {
    const result = importDxf(dxf(section('ENTITIES', polylineRect(0, 0, 60, 90))));
    expect(result.pieces).toHaveLength(1);
    expect(span(result.pieces[0]?.geometry ?? [])).toEqual({ width: 60, height: 90 });
  });

  it('normalises the outline to the origin', () => {
    const result = importDxf(dxf(section('ENTITIES', polylineRect(400, 250, 60, 90))));
    const geometry = result.pieces[0]?.geometry ?? [];
    expect(Math.min(...geometry.map((point) => point.x))).toBeCloseTo(0, 9);
    expect(Math.min(...geometry.map((point) => point.y))).toBeCloseTo(0, 9);
  });

  it('keeps separate layers as separate pieces', () => {
    const result = importDxf(
      dxf(
        section(
          'ENTITIES',
          [polylineRect(0, 0, 60, 90, 'FRONT'), polylineRect(200, 0, 40, 80, 'BACK')].join('\n'),
        ),
      ),
    );
    expect(result.pieces).toHaveLength(2);
    expect(result.pieces.map((piece) => piece.name).sort()).toEqual(['BACK', 'FRONT']);
  });
});

describe('capability 3 — chain stitching open segments', () => {
  it('closes a rectangle scattered across four unordered LINEs', () => {
    const result = importDxf(dxf(section('ENTITIES', scatteredRect(0, 0, 50, 70))));
    expect(result.pieces).toHaveLength(1);
    expect(span(result.pieces[0]?.geometry ?? [])).toEqual({ width: 50, height: 70 });
  });

  it('warns and skips a run that never closes', () => {
    const result = importDxf(
      dxf(section('ENTITIES', [line(0, 0, 10, 0), line(10, 0, 10, 10)].join('\n'))),
    );
    expect(result.pieces).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/no closed outline/i);
  });
});

describe('capability 2 — BLOCK and INSERT', () => {
  it('resolves a block through an insert', () => {
    const result = importDxf(
      dxf(
        section('BLOCKS', block('FRONT', polylineRect(0, 0, 60, 90))),
        section('ENTITIES', insert('FRONT', 100, 100)),
      ),
    );
    expect(result.pieces).toHaveLength(1);
    expect(span(result.pieces[0]?.geometry ?? [])).toEqual({ width: 60, height: 90 });
  });

  it('emits an INSERT once, not twice', () => {
    // Regression: the entity reader pushed owner entities at creation and
    // again at flush, so every block resolved twice. Deduplication hid it —
    // the piece count stayed right and only this warning gave it away.
    const result = importDxf(
      dxf(
        section('BLOCKS', block('FRONT', polylineRect(0, 0, 60, 90))),
        section('ENTITIES', insert('FRONT', 0, 0, { attribs: [['PIECE NAME', 'Front']] })),
      ),
    );
    expect(result.warnings.join(' ')).not.toMatch(/closed loops/);
    expect(result.pieces).toHaveLength(1);
  });

  it('reads a bare INSERT that has no SEQEND', () => {
    // An INSERT without attributes is not terminated; the entity after it is
    // a sibling, not a child.
    const bare = pairs(0, 'INSERT', 2, 'FRONT', 10, 0, 20, 0, 41, 1, 42, 1, 50, 0);
    const result = importDxf(
      dxf(
        section('BLOCKS', block('FRONT', polylineRect(0, 0, 60, 90))),
        section('ENTITIES', [bare, polylineRect(500, 0, 40, 40, 'OTHER')].join('\n')),
      ),
    );
    expect(result.pieces).toHaveLength(2);
  });

  it('applies insert rotation', () => {
    const result = importDxf(
      dxf(
        section('BLOCKS', block('FRONT', polylineRect(0, 0, 60, 90))),
        section('ENTITIES', insert('FRONT', 0, 0, { rotation: 90 })),
      ),
    );
    const measured = span(result.pieces[0]?.geometry ?? []);
    expect(measured.width).toBeCloseTo(90, 6);
    expect(measured.height).toBeCloseTo(60, 6);
  });

  it('applies a mirroring negative scale', () => {
    const result = importDxf(
      dxf(
        section('BLOCKS', block('FRONT', polylineRect(0, 0, 60, 90))),
        section('ENTITIES', insert('FRONT', 0, 0, { scaleX: -1 })),
      ),
    );
    // A mirror preserves size; it is the winding that flips.
    expect(span(result.pieces[0]?.geometry ?? []).width).toBeCloseTo(60, 6);
  });

  it('resolves a block nested inside another block', () => {
    const result = importDxf(
      dxf(
        section(
          'BLOCKS',
          [block('INNER', polylineRect(0, 0, 30, 40)), block('OUTER', insert('INNER', 10, 10))].join(
            '\n',
          ),
        ),
        section('ENTITIES', insert('OUTER', 100, 0)),
      ),
    );
    expect(result.pieces).toHaveLength(1);
    expect(span(result.pieces[0]?.geometry ?? [])).toEqual({ width: 30, height: 40 });
  });
});

describe('capability 8 — error resilience', () => {
  it('warns and continues when a block is missing', () => {
    const result = importDxf(
      dxf(
        section('BLOCKS', block('FRONT', polylineRect(0, 0, 60, 90))),
        section('ENTITIES', [insert('GHOST', 0, 0), insert('FRONT', 200, 0)].join('\n')),
      ),
    );
    expect(result.warnings.join(' ')).toMatch(/missing block "GHOST"/);
    // The good piece still arrives.
    expect(result.pieces).toHaveLength(1);
  });

  it('stops a block that inserts itself instead of hanging', () => {
    const result = importDxf(
      dxf(
        section(
          'BLOCKS',
          block('LOOP', [polylineRect(0, 0, 20, 20), insert('LOOP', 5, 5)].join('\n')),
        ),
        section('ENTITIES', insert('LOOP', 0, 0)),
      ),
    );
    expect(result.warnings.join(' ')).toMatch(/inserts itself/);
    expect(result.pieces).toHaveLength(1);
  });
});

describe('capability 7 — ATTRIB metadata', () => {
  it('reads piece name, size and bundle from attributes', () => {
    const result = importDxf(
      dxf(
        section('BLOCKS', block('B1', polylineRect(0, 0, 60, 90))),
        section(
          'ENTITIES',
          insert('B1', 0, 0, {
            attribs: [
              ['PIECE NAME', 'Front Bodice'],
              ['SIZE', '12'],
              ['BUNDLE', 'BN-7'],
            ],
          }),
        ),
      ),
    );
    const piece = result.pieces[0];
    expect(piece?.name).toBe('Front Bodice');
    expect(piece?.size).toBe('12');
    expect(piece?.bundle).toBe('BN-7');
  });

  it('falls back to the block name when there is no attribute', () => {
    const result = importDxf(
      dxf(
        section('BLOCKS', block('SLEEVE', polylineRect(0, 0, 60, 90))),
        section('ENTITIES', insert('SLEEVE', 0, 0)),
      ),
    );
    expect(result.pieces[0]?.name).toBe('SLEEVE');
  });
});

describe('capability 4 — duplicate deduplication', () => {
  it('drops an identical outline on a duplicated layer', () => {
    const result = importDxf(
      dxf(
        section(
          'ENTITIES',
          [polylineRect(0, 0, 60, 90, 'PIECE'), polylineRect(0, 0, 60, 90, 'PIECE-COPY')].join('\n'),
        ),
      ),
    );
    expect(result.pieces).toHaveLength(1);
    expect(result.warnings.join(' ')).toMatch(/duplicate dropped/);
  });

  it('keeps outlines that differ', () => {
    const result = importDxf(
      dxf(
        section(
          'ENTITIES',
          [polylineRect(0, 0, 60, 90, 'A'), polylineRect(0, 0, 61, 90, 'B')].join('\n'),
        ),
      ),
    );
    expect(result.pieces).toHaveLength(2);
  });
});

describe('capability 6 — unit heuristic', () => {
  it('reads centimetres when pieces are large', () => {
    const result = importDxf(dxf(section('ENTITIES', polylineRect(0, 0, 60, 90))));
    expect(result.units).toBe('cm');
    expect(span(result.pieces[0]?.geometry ?? []).width).toBeCloseTo(60, 6);
  });

  it('reads inches when every piece is small, and converts', () => {
    const result = importDxf(dxf(section('ENTITIES', polylineRect(0, 0, 8, 12))));
    expect(result.units).toBe('in');
    expect(span(result.pieces[0]?.geometry ?? []).width).toBeCloseTo(8 * 2.54, 6);
    expect(result.warnings.join(' ')).toMatch(/read as inches/i);
  });
});

describe('capability 5 — bulge arcs', () => {
  it('tessellates a bulged edge into a curve', () => {
    // A square whose first edge bows out as a semicircle.
    const bulged = pairs(
      0,
      'LWPOLYLINE',
      8,
      'PIECE',
      90,
      4,
      70,
      1,
      10,
      0,
      20,
      0,
      42,
      1,
      10,
      40,
      20,
      0,
      10,
      40,
      20,
      60,
      10,
      0,
      20,
      60,
    );
    const result = importDxf(dxf(section('ENTITIES', bulged)));
    const geometry = result.pieces[0]?.geometry ?? [];
    // Far more than the four corners a straight square would give.
    expect(geometry.length).toBeGreaterThan(10);
    // The semicircle bulges 20 cm below the baseline, so the piece is taller.
    expect(span(geometry).height).toBeCloseTo(80, 1);
  });
});

describe('capability 9 — convex decomposition', () => {
  it('leaves a convex piece as a single part', () => {
    const result = importDxf(dxf(section('ENTITIES', polylineRect(0, 0, 60, 90))));
    expect(result.pieces[0]?.convexParts).toHaveLength(1);
  });

  it('splits a concave piece into convex parts', () => {
    // An L: concave at the inner corner.
    const shape = pairs(
      0,
      'LWPOLYLINE',
      8,
      'PIECE',
      90,
      6,
      70,
      1,
      10, 0, 20, 0,
      10, 60, 20, 0,
      10, 60, 20, 30,
      10, 30, 20, 30,
      10, 30, 20, 90,
      10, 0, 20, 90,
    );
    const result = importDxf(dxf(section('ENTITIES', shape)));
    const parts = result.pieces[0]?.convexParts ?? [];
    expect(parts.length).toBeGreaterThan(1);
  });
});

describe('grade rules', () => {
  it('parses a .rul table when one is supplied', () => {
    const result = importDxf(
      dxf(section('ENTITIES', polylineRect(0, 0, 60, 90))),
      '; rule table\n1 S -0.5 -0.25\n1 L 0.5 0.25\n2 S -1 0\n',
    );
    expect(result.gradeRules?.rules.size).toBe(2);
    expect(result.gradeRules?.rules.get('1')?.offsets).toHaveLength(2);
  });

  it('is absent when no .rul is supplied', () => {
    const result = importDxf(dxf(section('ENTITIES', polylineRect(0, 0, 60, 90))));
    expect(result.gradeRules).toBeNull();
  });
});
