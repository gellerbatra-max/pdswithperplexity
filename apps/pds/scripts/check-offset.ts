import { offsetRing } from '../src/geometry/offset.ts';

/**
 * Self-check for the polygon offset.
 *
 * Run it with:
 *
 *   npm run check:offset
 *
 * There is no test runner in this project, and this file is not an argument for
 * adding one. It exists because `geometry/offset.ts` is the one module here
 * whose output is hard to eyeball: a wrong offset still looks like a plausible
 * outline on screen, and it would be wrong in a customer's cut file rather than
 * on a display. Every case below has an answer derivable by hand.
 *
 * It lives outside `src/` so `tsc -b` does not pull it into the app build; Node
 * strips the types itself, so it needs no dependency at all.
 */

interface V {
  readonly x: number;
  readonly y: number;
}

const area = (r: readonly V[]): number => {
  let s = 0;
  for (let i = 0; i < r.length; i += 1) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s / 2);
};

const perimeter = (r: readonly V[]): number => {
  let s = 0;
  for (let i = 0; i < r.length; i += 1) {
    const a = r[i]!;
    const b = r[(i + 1) % r.length]!;
    s += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return s;
};

const distanceToEdge = (p: V, u: V, v: V): number => {
  const dx = v.x - u.x;
  const dy = v.y - u.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return Math.hypot(p.x - u.x, p.y - u.y);
  let t = ((p.x - u.x) * dx + (p.y - u.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (u.x + dx * t), p.y - (u.y + dy * t));
};

const distanceToRing = (p: V, r: readonly V[]): number => {
  let best = Infinity;
  for (let i = 0; i < r.length; i += 1) {
    const d = distanceToEdge(p, r[i]!, r[(i + 1) % r.length]!);
    if (d < best) best = d;
  }
  return best;
};

/**
 * Closest approach between two ring *boundaries*, sampling along edges.
 *
 * Vertices alone are the wrong test: a mitred corner on a right angle sits
 * distance*sqrt(2) out, so a vertex-only check measures the mitre rather than
 * the clearance the cutter actually gets.
 */
const clearance = (a: readonly V[], b: readonly V[], samples = 64): number => {
  let best = Infinity;
  for (let i = 0; i < a.length; i += 1) {
    const u = a[i]!;
    const v = a[(i + 1) % a.length]!;
    for (let s = 0; s <= samples; s += 1) {
      const t = s / samples;
      const d = distanceToRing({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t }, b);
      if (d < best) best = d;
    }
  }
  return best;
};

const selfIntersects = (r: readonly V[]): boolean => {
  const side = (p: V, q: V, o: V): number =>
    (q.x - p.x) * (o.y - p.y) - (q.y - p.y) * (o.x - p.x);
  const crosses = (a1: V, a2: V, b1: V, b2: V): boolean => {
    const d1 = side(a1, a2, b1);
    const d2 = side(a1, a2, b2);
    const d3 = side(b1, b2, a1);
    const d4 = side(b1, b2, a2);
    return (
      ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
      ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9))
    );
  };
  for (let i = 0; i < r.length; i += 1) {
    for (let j = i + 2; j < r.length; j += 1) {
      if (i === 0 && j === r.length - 1) continue;
      if (crosses(r[i]!, r[(i + 1) % r.length]!, r[j]!, r[(j + 1) % r.length]!)) return true;
    }
  }
  return false;
};

let failures = 0;
const check = (name: string, ok: boolean, detail: string): void => {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name} — ${detail}`);
  if (!ok) failures += 1;
};

/* --- A square: every number here is exact ---------------------------------- */

const square: V[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

const grown = offsetRing(square, 10);
check('square area', Math.abs(area(grown) - 120 * 120) < 0.01, `${area(grown).toFixed(2)} want 14400`);
check(
  'square perimeter',
  Math.abs(perimeter(grown) - 480) < 0.01,
  `${perimeter(grown).toFixed(2)} want 480`,
);
check(
  'square clearance',
  Math.abs(clearance(grown, square) - 10) < 1e-6,
  `${clearance(grown, square).toFixed(6)} want 10`,
);

// Winding must not change the answer; source rings arrive in either order.
const reversed = offsetRing([...square].reverse(), 10);
check(
  'winding independent',
  Math.abs(area(reversed) - area(grown)) < 0.01,
  `${area(reversed).toFixed(2)} vs ${area(grown).toFixed(2)}`,
);

const shrunk = offsetRing(square, -10);
check('inward area', Math.abs(area(shrunk) - 80 * 80) < 0.01, `${area(shrunk).toFixed(2)} want 6400`);

/* --- A reflex corner must not fold the ring over itself -------------------- */

const ell: V[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 40 },
  { x: 40, y: 40 },
  { x: 40, y: 100 },
  { x: 0, y: 100 },
];
const ellOffset = offsetRing(ell, 10);
check('L simple', !selfIntersects(ellOffset), `${ellOffset.length} vertices`);
check('L clearance', clearance(ellOffset, ell) > 9.99, `${clearance(ellOffset, ell).toFixed(4)}`);

/* --- A slot narrower than twice the offset: the fold-over must be cut out --- */

const slotted: V[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 55, y: 100 },
  { x: 55, y: 30 },
  { x: 45, y: 30 },
  { x: 45, y: 100 },
  { x: 0, y: 100 },
];
const slotOffset = offsetRing(slotted, 8);
check('slot simple', !selfIntersects(slotOffset), `${slotOffset.length} vertices`);
check(
  'slot clearance',
  clearance(slotOffset, slotted) > 7.9,
  `${clearance(slotOffset, slotted).toFixed(4)}`,
);

/* --- A circle, against the analytic area ----------------------------------- */

const circle: V[] = Array.from({ length: 256 }, (_, i) => {
  const t = (i / 256) * Math.PI * 2;
  return { x: 200 + 50 * Math.cos(t), y: 200 + 50 * Math.sin(t) };
});
const ringOffset = offsetRing(circle, 12);
const expected = Math.PI * 62 * 62;
check(
  'circle area',
  Math.abs(area(ringOffset) - expected) / expected < 0.001,
  `${area(ringOffset).toFixed(1)} want ~${expected.toFixed(1)}`,
);

/* --- Degenerate input must return nothing, not nonsense -------------------- */

check(
  'open polyline empty',
  offsetRing([{ x: 0, y: 0 }, { x: 1, y: 1 }], 5).length === 0,
  'returned []',
);
check(
  'zero distance is identity',
  Math.abs(area(offsetRing(square, 0)) - 10000) < 0.01,
  `${area(offsetRing(square, 0)).toFixed(1)}`,
);

/* --- Per-edge distances: 20 on the first edge, 10 on the rest --------------- */

const varied = offsetRing(square, 10, { distances: [20, 10, 10, 10] });
const height = Math.max(...varied.map((p) => p.y)) - Math.min(...varied.map((p) => p.y));
check('per-edge distance', Math.abs(height - 130) < 0.01, `height ${height.toFixed(2)} want 130`);

console.log(
  failures === 0 ? '\nAll offset checks passed.' : `\n${failures} offset check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
