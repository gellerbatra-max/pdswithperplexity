import type { Vec2 } from '@/geometry';
import {
  LINE,
  PATTERN_SCHEMA_VERSION,
  type GradeRule,
  type InternalLine,
  type MeasurementLink,
  type Notch,
  type PatternDocument,
  type PatternPiece,
  type PieceMeta,
  type PiecePoint,
  type PieceSegment,
  type PointRole,
  type SegmentGeometry,
  type SizeRange,
} from '@/pattern';

/**
 * Seed pattern: SH-2041, a classic long-sleeve shirt in base size M.
 *
 * Plausible pattern-maker dimensions in millimetres — enough real geometry,
 * annotation and grading for every panel to read from the model rather than
 * from fixtures. Not a drafted block; replace it once import lands.
 */

/* --- Size range and grade rules --------------------------------------------- */

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;
const BASE_SIZE_INDEX = 2; // M

export const SIZE_RANGE: SizeRange = {
  baseSizeId: 'size-m',
  sizes: SIZES.map((label, order) => ({ id: `size-${label.toLowerCase()}`, label, order })),
};

/** A rule whose increments step linearly away from the base size. */
const linearRule = (
  id: string,
  code: string,
  label: string,
  dxPerStep: number,
  dyPerStep: number,
): GradeRule => ({
  id,
  code,
  label,
  increments: SIZES.map((sizeLabel, order) => {
    const steps = order - BASE_SIZE_INDEX;
    return {
      sizeId: `size-${sizeLabel.toLowerCase()}`,
      dx: dxPerStep * steps,
      dy: dyPerStep * steps,
    };
  }),
});

const GRADE_RULES: readonly GradeRule[] = [
  linearRule('gr-0', '0', 'No movement', 0, 0),
  linearRule('gr-1', '1', 'Chest width', 10, 0),
  linearRule('gr-2', '2', 'Body length', 0, 15),
  linearRule('gr-3', '3', 'Chest width + length', 10, 15),
  linearRule('gr-4', '4', 'Shoulder width', 5, 0),
  linearRule('gr-5', '5', 'Sleeve length', 0, 12),
  linearRule('gr-6', '6', 'Neck girth', 4, 0),
];

/* --- Piece construction ------------------------------------------------------ */

type PointSpec = readonly [
  x: number,
  y: number,
  role?: PointRole,
  gradeRuleId?: string,
  label?: string,
];

interface PieceSpec {
  readonly id: string;
  readonly name: string;
  readonly origin: Vec2;
  readonly outline: readonly PointSpec[];
  /** Label for the edge leaving each outline point, by index. */
  readonly edges?: readonly (string | undefined)[];
  readonly seamAllowance: number;
  readonly meta: PieceMeta;
  readonly notches?: readonly {
    /** Index into `outline` of the edge this notch sits on. */
    readonly edge: number;
    readonly t: number;
    readonly kind: Notch['kind'];
    readonly label?: string;
  }[];
  readonly grain?: { readonly x: number; readonly y1: number; readonly y2: number };
  /** Named construction points that measurement links anchor to. */
  readonly anchors?: readonly {
    readonly key: string;
    readonly x: number;
    readonly y: number;
    readonly label: string;
  }[];
  readonly internals?: readonly {
    readonly role: InternalLine['role'];
    readonly label: string;
    readonly cut: boolean;
    readonly closed: boolean;
    readonly points: readonly (readonly [number, number])[];
  }[];
}

const distance = (a: Vec2, b: Vec2): number => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Cubic control handles for an outline edge.
 *
 * Smooth (Catmull-Rom style) tangents are used only where the endpoint is a
 * `curve` point. At a `corner` the handle runs along the edge's own chord
 * instead, because a corner is a hard point — smoothing through it lets a
 * distant neighbour drag the curve badly out of shape (a centre-front hem
 * pulling the neckline into a bulge).
 *
 * Handles are chord-length weighted so a long neighbouring edge cannot
 * dominate a short one.
 */
const controlsFor = (
  previous: Vec2,
  from: Vec2,
  to: Vec2,
  next: Vec2,
  fromIsCurve: boolean,
  toIsCurve: boolean,
): SegmentGeometry => {
  const dPrev = distance(previous, from);
  const dThis = distance(from, to) || 1;
  const dNext = distance(to, next);

  const w1 = dThis / (dPrev + dThis || 1) / 3;
  const w2 = dThis / (dThis + dNext || 1) / 3;

  return {
    kind: 'cubic',
    control1: fromIsCurve
      ? { x: from.x + (to.x - previous.x) * w1, y: from.y + (to.y - previous.y) * w1 }
      : { x: from.x + (to.x - from.x) / 3, y: from.y + (to.y - from.y) / 3 },
    control2: toIsCurve
      ? { x: to.x - (next.x - from.x) * w2, y: to.y - (next.y - from.y) * w2 }
      : { x: to.x - (to.x - from.x) / 3, y: to.y - (to.y - from.y) / 3 },
  };
};

const buildPiece = (spec: PieceSpec): PatternPiece => {
  const count = spec.outline.length;
  const at = (index: number): Vec2 => {
    const entry = spec.outline[((index % count) + count) % count];
    return {
      x: spec.origin.x + (entry?.[0] ?? 0),
      y: spec.origin.y + (entry?.[1] ?? 0),
    };
  };

  const points: PiecePoint[] = spec.outline.map((entry, index) => {
    const [, , role, gradeRuleId, label] = entry;
    return {
      id: `${spec.id}-p${index + 1}`,
      position: at(index),
      role: role ?? 'corner',
      ...(gradeRuleId ? { gradeRuleId } : {}),
      ...(label ? { label } : {}),
    };
  });

  const segments: PieceSegment[] = spec.outline.map((_, index) => {
    const nextIndex = (index + 1) % count;
    const fromIsCurve = spec.outline[index]?.[2] === 'curve';
    const toIsCurve = spec.outline[nextIndex]?.[2] === 'curve';
    const label = spec.edges?.[index];
    return {
      id: `${spec.id}-s${index + 1}`,
      from: `${spec.id}-p${index + 1}`,
      to: `${spec.id}-p${nextIndex + 1}`,
      geometry:
        fromIsCurve || toIsCurve
          ? controlsFor(
              at(index - 1),
              at(index),
              at(nextIndex),
              at(index + 2),
              fromIsCurve,
              toIsCurve,
            )
          : LINE,
      ...(label ? { label } : {}),
    };
  });

  // Grain and internal-line anchors join the point pool as construction points,
  // so they grade with the outline instead of drifting away from it.
  const extraPoints: PiecePoint[] = [];

  const grainSpec = spec.grain;
  if (grainSpec) {
    extraPoints.push(
      {
        id: `${spec.id}-grain-a`,
        position: { x: spec.origin.x + grainSpec.x, y: spec.origin.y + grainSpec.y1 },
        role: 'construction',
        label: 'Grain start',
      },
      {
        id: `${spec.id}-grain-b`,
        position: { x: spec.origin.x + grainSpec.x, y: spec.origin.y + grainSpec.y2 },
        role: 'construction',
        label: 'Grain end',
      },
    );
  }

  for (const anchor of spec.anchors ?? []) {
    extraPoints.push({
      id: `${spec.id}-a-${anchor.key}`,
      position: { x: spec.origin.x + anchor.x, y: spec.origin.y + anchor.y },
      role: 'construction',
      label: anchor.label,
    });
  }

  const internalLines: InternalLine[] = (spec.internals ?? []).map((internal, i) => {
    const ids = internal.points.map(([x, y], j) => {
      const id = `${spec.id}-i${i + 1}-p${j + 1}`;
      extraPoints.push({
        id,
        position: { x: spec.origin.x + x, y: spec.origin.y + y },
        role: 'construction',
      });
      return id;
    });
    return {
      id: `${spec.id}-i${i + 1}`,
      role: internal.role,
      points: ids,
      closed: internal.closed,
      label: internal.label,
      cut: internal.cut,
    };
  });

  const notches: Notch[] = (spec.notches ?? []).map((notch, index) => ({
    id: `${spec.id}-n${index + 1}`,
    segmentId: `${spec.id}-s${notch.edge + 1}`,
    t: notch.t,
    kind: notch.kind,
    depth: 6,
    width: 2,
    angle: 0,
    ...(notch.label ? { label: notch.label } : {}),
  }));

  return {
    id: spec.id,
    name: spec.name,
    points: [...points, ...extraPoints],
    segments,
    boundary: segments.map((segment) => segment.id),
    closed: true,
    seamAllowance: spec.seamAllowance,
    ...(grainSpec
      ? {
          grainLine: {
            id: `${spec.id}-grain`,
            kind: 'grain' as const,
            from: `${spec.id}-grain-a`,
            to: `${spec.id}-grain-b`,
            arrows: 'both' as const,
          },
        }
      : {}),
    notches,
    internalLines,
    meta: spec.meta,
  };
};

/* --- Piece specifications ---------------------------------------------------- */

const POPLIN = 'Cotton poplin 120gsm';

const shell = (
  code: string,
  quantity: number,
  extra: Partial<PieceMeta> = {},
): PieceMeta => ({
  code,
  category: 'shell',
  fabric: POPLIN,
  quantity,
  onFold: false,
  mirrored: false,
  ...extra,
});

const SPECS: readonly PieceSpec[] = [
  {
    id: 'piece-front-left',
    name: 'Front Left',
    origin: { x: 0, y: 0 },
    seamAllowance: 10,
    meta: shell('SH-FR-L', 1, { mirrored: true }),
    grain: { x: 120, y1: 90, y2: 620 },
    anchors: [
      { key: 'chest-cf', x: 0, y: 210, label: 'Chest level CF' },
      { key: 'chest-side', x: 220, y: 210, label: 'Chest level side' },
      { key: 'waist-cf', x: 0, y: 470, label: 'Waist level CF' },
      { key: 'waist-side', x: 232, y: 470, label: 'Waist level side' },
    ],
    outline: [
      [0, 0, 'corner', 'gr-6', 'CF neck'],
      [78, -6, 'curve', 'gr-6'],
      [150, 18, 'corner', 'gr-4', 'HPS'],
      [196, 96, 'curve', 'gr-4'],
      [220, 210, 'curve', 'gr-1'],
      [232, 470, 'corner', 'gr-1'],
      [236, 700, 'corner', 'gr-3'],
      [0, 706, 'corner', 'gr-2', 'CF hem'],
    ],
    edges: [
      'Neckline',
      'Neckline',
      'Shoulder',
      'Armhole',
      'Armhole',
      'Side seam',
      'Hem',
      'Centre front',
    ],
    notches: [
      { edge: 4, t: 0.5, kind: 'slit', label: 'Side balance' },
      { edge: 3, t: 0.4, kind: 'v', label: 'Front armhole' },
    ],
    internals: [
      {
        role: 'placement',
        label: 'Chest pocket placement',
        cut: false,
        closed: true,
        points: [
          [52, 210],
          [180, 210],
          [180, 360],
          [52, 360],
        ],
      },
    ],
  },
  {
    id: 'piece-front-right',
    name: 'Front Right',
    origin: { x: 300, y: 0 },
    seamAllowance: 10,
    meta: shell('SH-FR-R', 1, { mirrored: true }),
    grain: { x: 120, y1: 90, y2: 620 },
    outline: [
      [236, 0, 'corner', 'gr-6', 'CF neck'],
      [158, -6, 'curve', 'gr-6'],
      [86, 18, 'corner', 'gr-4', 'HPS'],
      [40, 96, 'curve', 'gr-4'],
      [16, 210, 'curve', 'gr-1'],
      [4, 470, 'corner', 'gr-1'],
      [0, 700, 'corner', 'gr-3'],
      [236, 706, 'corner', 'gr-2', 'CF hem'],
    ],
    edges: [
      'Neckline',
      'Neckline',
      'Shoulder',
      'Armhole',
      'Armhole',
      'Side seam',
      'Hem',
      'Centre front',
    ],
    notches: [{ edge: 4, t: 0.5, kind: 'slit', label: 'Side balance' }],
  },
  {
    id: 'piece-back',
    name: 'Back',
    origin: { x: 600, y: 0 },
    seamAllowance: 10,
    meta: shell('SH-BK', 1, { onFold: true }),
    grain: { x: 140, y1: 100, y2: 640 },
    anchors: [
      { key: 'chest-cb', x: 0, y: 236, label: 'Chest level CB' },
      { key: 'chest-side', x: 262, y: 236, label: 'Chest level side' },
      { key: 'waist-cb', x: 0, y: 480, label: 'Waist level CB' },
      { key: 'waist-side', x: 274, y: 480, label: 'Waist level side' },
    ],
    outline: [
      [0, 40, 'corner', 'gr-6', 'CB neck'],
      [96, 26, 'curve', 'gr-6'],
      [186, 34, 'corner', 'gr-4', 'HPS'],
      [238, 118, 'curve', 'gr-4'],
      [262, 236, 'curve', 'gr-1'],
      [274, 480, 'corner', 'gr-1'],
      [278, 712, 'corner', 'gr-3'],
      [0, 718, 'corner', 'gr-2', 'CB hem'],
    ],
    edges: [
      'Neckline',
      'Neckline',
      'Shoulder',
      'Armhole',
      'Armhole',
      'Side seam',
      'Hem',
      'Centre back',
    ],
    notches: [
      { edge: 4, t: 0.5, kind: 'v', label: 'Side balance' },
      { edge: 7, t: 0.5, kind: 'castle', label: 'Centre back' },
    ],
    internals: [
      {
        role: 'fold',
        label: 'Centre back fold',
        cut: false,
        closed: false,
        points: [
          [0, 40],
          [0, 718],
        ],
      },
    ],
  },
  {
    id: 'piece-sleeve',
    name: 'Sleeve',
    origin: { x: 940, y: 0 },
    seamAllowance: 12,
    meta: shell('SH-SLV', 2, { mirrored: true }),
    grain: { x: 124, y1: 80, y2: 540 },
    outline: [
      [124, 0, 'corner', 'gr-4', 'Cap point'],
      [206, 62, 'curve', 'gr-4'],
      [248, 168, 'corner', 'gr-1'],
      [232, 380, 'curve', 'gr-5'],
      [214, 596, 'corner', 'gr-5'],
      [34, 596, 'corner', 'gr-5'],
      [16, 380, 'curve', 'gr-5'],
      [0, 168, 'corner', 'gr-1'],
      [42, 62, 'curve', 'gr-4'],
    ],
    edges: [
      'Back cap',
      'Back cap',
      'Back underarm',
      'Back underarm',
      'Cuff edge',
      'Front underarm',
      'Front underarm',
      'Front cap',
      'Front cap',
    ],
    notches: [
      { edge: 0, t: 0.55, kind: 'v', label: 'Back cap' },
      { edge: 8, t: 0.45, kind: 'slit', label: 'Front cap' },
      { edge: 4, t: 0.5, kind: 'slit', label: 'Cuff opening' },
    ],
  },
  {
    id: 'piece-yoke',
    name: 'Yoke',
    origin: { x: 0, y: 800 },
    seamAllowance: 10,
    meta: shell('SH-YK', 2, { onFold: true }),
    grain: { x: 210, y1: 30, y2: 128 },
    outline: [
      [0, 0, 'corner', 'gr-6'],
      [420, 0, 'corner', 'gr-4'],
      [438, 74, 'curve', 'gr-4'],
      [420, 152, 'corner', 'gr-4'],
      [0, 158, 'corner', 'gr-6'],
    ],
    edges: ['Neckline', 'Armhole', 'Armhole', 'Yoke seam', 'Centre back'],
    notches: [{ edge: 3, t: 0.5, kind: 'castle', label: 'Centre back' }],
  },
  {
    id: 'piece-collar',
    name: 'Collar',
    origin: { x: 500, y: 800 },
    seamAllowance: 8,
    meta: shell('SH-COL', 2, { onFold: true }),
    grain: { x: 180, y1: 20, y2: 82 },
    outline: [
      [0, 0, 'corner', 'gr-6'],
      [360, 0, 'corner', 'gr-6'],
      [386, 42, 'curve', 'gr-6'],
      [360, 96, 'corner', 'gr-6'],
      [0, 100, 'corner', 'gr-6'],
    ],
    edges: ['Collar fall', 'Collar point', 'Collar point', 'Stand seam', 'Centre back'],
    notches: [{ edge: 3, t: 0.5, kind: 'castle', label: 'Centre back' }],
  },
  {
    id: 'piece-collar-stand',
    name: 'Collar Stand',
    origin: { x: 940, y: 800 },
    seamAllowance: 8,
    meta: shell('SH-CST', 2, { onFold: true }),
    grain: { x: 160, y1: 16, y2: 60 },
    outline: [
      [0, 12, 'corner', 'gr-6'],
      [318, 0, 'corner', 'gr-6'],
      [348, 30, 'curve', 'gr-6'],
      [318, 64, 'corner', 'gr-6'],
      [0, 72, 'corner', 'gr-6'],
    ],
    edges: ['Top edge', 'Front edge', 'Front edge', 'Neckline', 'Centre back'],
    notches: [{ edge: 3, t: 0.5, kind: 'castle', label: 'Centre back' }],
  },
  {
    id: 'piece-cuff',
    name: 'Cuff',
    origin: { x: 1340, y: 800 },
    seamAllowance: 8,
    meta: shell('SH-CUF', 4),
    grain: { x: 122, y1: 16, y2: 72 },
    outline: [
      [0, 0, 'corner', 'gr-0'],
      [244, 0, 'corner', 'gr-0'],
      [244, 88, 'corner', 'gr-0'],
      [0, 88, 'corner', 'gr-0'],
    ],
    edges: ['Top edge', 'Side edge', 'Sleeve edge', 'Side edge'],
    internals: [
      {
        role: 'buttonhole',
        label: 'Cuff buttonhole',
        cut: true,
        closed: false,
        points: [
          [28, 44],
          [52, 44],
        ],
      },
    ],
  },
  {
    id: 'piece-pocket',
    name: 'Chest Pocket',
    origin: { x: 1340, y: 940 },
    seamAllowance: 10,
    meta: shell('SH-PKT', 1),
    grain: { x: 64, y1: 20, y2: 130 },
    outline: [
      [0, 0, 'corner', 'gr-0'],
      [128, 0, 'corner', 'gr-0'],
      [128, 118, 'corner', 'gr-0'],
      [64, 152, 'corner', 'gr-0'],
      [0, 118, 'corner', 'gr-0'],
    ],
    edges: ['Pocket mouth', 'Side edge', 'Point', 'Point', 'Side edge'],
    internals: [
      {
        role: 'fold',
        label: 'Pocket hem fold',
        cut: false,
        closed: false,
        points: [
          [0, 26],
          [128, 26],
        ],
      },
    ],
  },
  {
    id: 'piece-collar-interlining',
    name: 'Collar Interlining',
    origin: { x: 500, y: 960 },
    seamAllowance: 0,
    meta: {
      code: 'SH-COL-I',
      category: 'interlining',
      fabric: 'Fusible woven 45gsm',
      quantity: 1,
      onFold: true,
      mirrored: false,
      description: 'Cut net — no allowance.',
    },
    grain: { x: 176, y1: 18, y2: 78 },
    outline: [
      [0, 0, 'corner', 'gr-6'],
      [352, 0, 'corner', 'gr-6'],
      [376, 40, 'curve', 'gr-6'],
      [352, 92, 'corner', 'gr-6'],
      [0, 96, 'corner', 'gr-6'],
    ],
    edges: ['Collar fall', 'Collar point', 'Collar point', 'Stand seam', 'Centre back'],
  },
];

/* --- Measurement links ------------------------------------------------------- */

const MEASUREMENTS: readonly MeasurementLink[] = [
  {
    id: 'pom-01',
    code: 'POM-01',
    label: 'Chest, 1" below armhole',
    kind: 'girth',
    refs: [
      {
        pieceId: 'piece-front-left',
        pointIds: ['piece-front-left-a-chest-cf', 'piece-front-left-a-chest-side'],
        factor: 2,
      },
      {
        pieceId: 'piece-back',
        pointIds: ['piece-back-a-chest-cb', 'piece-back-a-chest-side'],
        factor: 2,
      },
    ],
    spec: 960,
    tolerance: 10,
    includeSeamAllowance: false,
  },
  {
    id: 'pom-02',
    code: 'POM-02',
    label: 'Waist',
    kind: 'girth',
    refs: [
      {
        pieceId: 'piece-front-left',
        pointIds: ['piece-front-left-a-waist-cf', 'piece-front-left-a-waist-side'],
        factor: 2,
      },
      {
        pieceId: 'piece-back',
        pointIds: ['piece-back-a-waist-cb', 'piece-back-a-waist-side'],
        factor: 2,
      },
    ],
    spec: 1010,
    tolerance: 10,
    includeSeamAllowance: false,
  },
  {
    id: 'pom-03',
    code: 'POM-03',
    label: 'Hem sweep',
    kind: 'girth',
    refs: [
      { pieceId: 'piece-front-left', segmentIds: ['piece-front-left-s7'], factor: 2 },
      { pieceId: 'piece-back', segmentIds: ['piece-back-s7'], factor: 2 },
    ],
    spec: 1020,
    tolerance: 12,
    includeSeamAllowance: false,
  },
  {
    id: 'pom-04',
    code: 'POM-04',
    label: 'Back length from HPS',
    kind: 'point-to-point',
    refs: [{ pieceId: 'piece-back', pointIds: ['piece-back-p3', 'piece-back-p8'] }],
    spec: 706,
    tolerance: 6,
    includeSeamAllowance: false,
  },
  {
    id: 'pom-05',
    code: 'POM-05',
    label: 'Across shoulder',
    kind: 'point-to-point',
    refs: [{ pieceId: 'piece-back', pointIds: ['piece-back-p1', 'piece-back-p3'], factor: 2 }],
    spec: 370,
    tolerance: 6,
    includeSeamAllowance: false,
  },
  {
    id: 'pom-06',
    code: 'POM-06',
    label: 'Sleeve length from cap',
    kind: 'point-to-point',
    refs: [{ pieceId: 'piece-sleeve', pointIds: ['piece-sleeve-p1', 'piece-sleeve-p5'] }],
    spec: 600,
    tolerance: 6,
    includeSeamAllowance: false,
  },
  {
    id: 'pom-07',
    code: 'POM-07',
    label: 'Cuff opening',
    kind: 'path-length',
    refs: [{ pieceId: 'piece-cuff', segmentIds: ['piece-cuff-s1'] }],
    spec: 240,
    tolerance: 4,
    includeSeamAllowance: false,
  },
  {
    id: 'pom-08',
    code: 'POM-08',
    label: 'Neck girth at stand',
    kind: 'path-length',
    refs: [{ pieceId: 'piece-collar-stand', segmentIds: ['piece-collar-stand-s4'], factor: 2 }],
    spec: 630,
    tolerance: 4,
    includeSeamAllowance: false,
  },
];

/* --- Document ---------------------------------------------------------------- */

const timestamp = (): string => new Date().toISOString();

export const createEmptyDocument = (): PatternDocument => ({
  schemaVersion: PATTERN_SCHEMA_VERSION,
  id: `doc-${Date.now().toString(36)}`,
  name: 'Untitled pattern',
  style: { code: '—', name: 'Untitled' },
  unit: 'mm',
  sizeRange: SIZE_RANGE,
  pieces: [],
  measurements: [],
  gradeRules: GRADE_RULES,
  createdAt: timestamp(),
  updatedAt: timestamp(),
});

export const createSeedDocument = (): PatternDocument => ({
  schemaVersion: PATTERN_SCHEMA_VERSION,
  id: 'doc-sh-2041',
  name: 'SH-2041 Classic Shirt',
  style: {
    code: 'SH-2041',
    name: 'Classic Shirt',
    season: 'AW26',
    category: 'Shirts',
    description: 'Long-sleeve shirt, convertible collar, back yoke, barrel cuff.',
  },
  unit: 'mm',
  sizeRange: SIZE_RANGE,
  pieces: SPECS.map(buildPiece),
  measurements: MEASUREMENTS,
  gradeRules: GRADE_RULES,
  createdAt: timestamp(),
  updatedAt: timestamp(),
});
