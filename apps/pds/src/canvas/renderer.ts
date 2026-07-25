import { BoundsOps } from '@/geometry';
import {
  boundarySegments,
  pieceBounds,
  pointAlongSegment,
  findPoint,
  findSegment,
  pointPositions,
  segmentEndpoints,
  type PatternPiece,
  type PieceId,
} from '@/pattern';
import type { LayerVisibility } from '@/store/types';
import { worldToScreen, type Camera } from './camera';
import { drawGrid } from './grid';
import { DARK_CANVAS_THEME, type CanvasTheme } from './theme';

export interface Scene {
  readonly pieces: readonly PatternPiece[];
  readonly selectedPieceIds: ReadonlySet<PieceId>;
}

export interface RenderOptions {
  readonly camera: Camera;
  /** Viewport size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  readonly showGrid: boolean;
  readonly layers: LayerVisibility;
  readonly theme?: CanvasTheme;
}

/** Trace the outline, using real Bézier curves rather than the flattened polyline. */
const tracePiece = (
  ctx: CanvasRenderingContext2D,
  piece: PatternPiece,
  camera: Camera,
): void => {
  ctx.beginPath();
  let started = false;

  for (const segment of boundarySegments(piece)) {
    const ends = segmentEndpoints(piece, segment);
    if (!ends) continue;
    const from = worldToScreen(camera, ends[0]);
    const to = worldToScreen(camera, ends[1]);

    if (!started) {
      ctx.moveTo(from.x, from.y);
      started = true;
    }

    if (segment.geometry.kind === 'cubic') {
      const c1 = worldToScreen(camera, segment.geometry.control1);
      const c2 = worldToScreen(camera, segment.geometry.control2);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
    } else {
      ctx.lineTo(to.x, to.y);
    }
  }

  if (piece.closed && started) ctx.closePath();
};

const drawNotches = (
  ctx: CanvasRenderingContext2D,
  piece: PatternPiece,
  camera: Camera,
  theme: CanvasTheme,
): void => {
  ctx.strokeStyle = theme.outline;
  ctx.lineWidth = 1.5;

  for (const notch of piece.notches) {
    const segment = findSegment(piece, notch.segmentId);
    if (!segment) continue;
    const at = pointAlongSegment(piece, segment, notch.t);
    const ends = segmentEndpoints(piece, segment);
    if (!at || !ends) continue;

    // Inward normal, approximated from the segment chord.
    const dx = ends[1].x - ends[0].x;
    const dy = ends[1].y - ends[0].y;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;

    const base = worldToScreen(camera, at);
    const tip = worldToScreen(camera, {
      x: at.x + nx * notch.depth,
      y: at.y + ny * notch.depth,
    });

    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
  }
};

const drawGrainLine = (
  ctx: CanvasRenderingContext2D,
  piece: PatternPiece,
  camera: Camera,
  theme: CanvasTheme,
): void => {
  const grain = piece.grainLine;
  if (!grain) return;
  const from = findPoint(piece, grain.from);
  const to = findPoint(piece, grain.to);
  if (!from || !to) return;

  const a = worldToScreen(camera, from.position);
  const b = worldToScreen(camera, to.position);

  ctx.strokeStyle = theme.grain;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();

  // Arrowheads, sized in screen space so they stay legible at any zoom.
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const head = 6;
  const arrow = (tip: { x: number; y: number }, direction: number): void => {
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(
      tip.x - head * Math.cos(direction - 0.4),
      tip.y - head * Math.sin(direction - 0.4),
    );
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(
      tip.x - head * Math.cos(direction + 0.4),
      tip.y - head * Math.sin(direction + 0.4),
    );
    ctx.stroke();
  };

  if (grain.arrows === 'end' || grain.arrows === 'both') arrow(b, angle);
  if (grain.arrows === 'start' || grain.arrows === 'both') arrow(a, angle + Math.PI);
};

const drawInternalLines = (
  ctx: CanvasRenderingContext2D,
  piece: PatternPiece,
  camera: Camera,
  theme: CanvasTheme,
): void => {
  ctx.strokeStyle = theme.internal;
  ctx.lineWidth = 1;

  for (const line of piece.internalLines) {
    const positions = pointPositions(piece, line.points);
    if (positions.length < 2) continue;

    // Drawn (non-cut) internals are dashed, the way they read on a plot.
    ctx.setLineDash(line.cut ? [] : [4, 3]);
    ctx.beginPath();
    positions.forEach((position, index) => {
      const p = worldToScreen(camera, position);
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    if (line.closed) ctx.closePath();
    ctx.stroke();
  }

  ctx.setLineDash([]);
};

const drawPiece = (
  ctx: CanvasRenderingContext2D,
  piece: PatternPiece,
  camera: Camera,
  selected: boolean,
  theme: CanvasTheme,
  layers: LayerVisibility,
): void => {
  if (piece.points.length === 0) return;

  if (layers.seam && piece.seamAllowance > 0 && piece.closed) {
    // Placeholder rendering: a widened stroke stands in until the offset solver lands.
    tracePiece(ctx, piece, camera);
    ctx.strokeStyle = theme.seamAllowance;
    ctx.lineWidth = Math.max(1, piece.seamAllowance * camera.zoom * 2);
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  if (layers.net) {
    tracePiece(ctx, piece, camera);
    ctx.strokeStyle = selected ? theme.outlineSelected : theme.outline;
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  if (layers.internals) drawInternalLines(ctx, piece, camera, theme);
  if (layers.grain) drawGrainLine(ctx, piece, camera, theme);
  if (layers.notches) drawNotches(ctx, piece, camera, theme);

  // Outline nodes clutter the view when zoomed out, so they fade below a usable scale.
  if (layers.nodes && camera.zoom > 0.25) {
    const nodeRadius = selected ? 3.5 : 2.5;
    ctx.fillStyle = selected ? theme.nodeSelected : theme.node;
    for (const point of piece.points) {
      if (point.role === 'construction') continue;
      const p = worldToScreen(camera, point.position);
      ctx.beginPath();
      ctx.arc(p.x, p.y, nodeRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (layers.labels) {
    const bounds = pieceBounds(piece);
    if (!BoundsOps.isEmpty(bounds)) {
      const label = worldToScreen(camera, { x: bounds.minX, y: bounds.minY });
      ctx.fillStyle = selected ? theme.outlineSelected : theme.label;
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(piece.name, label.x, label.y - 8);
    }
  }
};

/** Draws one full frame. Stateless by design — the store owns all state. */
export const renderScene = (
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  options: RenderOptions,
): void => {
  const theme = options.theme ?? DARK_CANVAS_THEME;
  const { camera, width, height, devicePixelRatio } = options;

  ctx.save();
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);

  if (options.showGrid) drawGrid(ctx, camera, width, height, theme);

  for (const piece of scene.pieces) {
    drawPiece(ctx, piece, camera, scene.selectedPieceIds.has(piece.id), theme, options.layers);
  }

  ctx.restore();
};
