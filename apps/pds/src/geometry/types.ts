/** Core geometric primitives. All values are in document units (millimetres). */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Axis-aligned bounding box in min/max form — cheaper to accumulate than a Rect. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export type Unit = 'mm' | 'cm' | 'in';
