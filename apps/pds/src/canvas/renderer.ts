import { BoundsOps } from '@/geometry';
import type { Piece, PieceId } from '@/store/types';
import { worldToScreen, type Camera } from './camera';
import { drawGrid } from './grid';
import { DARK_CANVAS_THEME, type CanvasTheme } from './theme';

export interface Scene {
  readonly pieces: readonly Piece[];
  readonly selectedPieceIds: ReadonlySet<PieceId>;
}

export interface RenderOptions {
  readonly camera: Camera;
  /** Viewport size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  readonly showGrid: boolean;
  readonly theme?: CanvasTheme;
}

const tracePiece = (
  ctx: CanvasRenderingContext2D,
  piece: Piece,
  camera: Camera,
): void => {
  ctx.beginPath();
  piece.nodes.forEach((node, index) => {
    const p = worldToScreen(camera, node.position);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  if (piece.closed) ctx.closePath();
};

const drawPiece = (
  ctx: CanvasRenderingContext2D,
  piece: Piece,
  camera: Camera,
  selected: boolean,
  theme: CanvasTheme,
): void => {
  if (piece.nodes.length === 0) return;

  if (piece.seamAllowance > 0 && piece.closed) {
    // Placeholder rendering: a widened stroke stands in until the offset solver lands.
    tracePiece(ctx, piece, camera);
    ctx.strokeStyle = theme.seamAllowance;
    ctx.lineWidth = Math.max(1, piece.seamAllowance * camera.zoom * 2);
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  tracePiece(ctx, piece, camera);
  ctx.strokeStyle = selected ? theme.outlineSelected : theme.outline;
  ctx.lineWidth = selected ? 2 : 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  const nodeRadius = selected ? 3.5 : 2.5;
  ctx.fillStyle = selected ? theme.nodeSelected : theme.node;
  for (const node of piece.nodes) {
    const p = worldToScreen(camera, node.position);
    ctx.beginPath();
    ctx.arc(p.x, p.y, nodeRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  const bounds = BoundsOps.fromPoints(piece.nodes.map((n) => n.position));
  if (!BoundsOps.isEmpty(bounds)) {
    const label = worldToScreen(camera, { x: bounds.minX, y: bounds.minY });
    ctx.fillStyle = theme.label;
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(piece.name, label.x, label.y - 8);
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
    drawPiece(ctx, piece, camera, scene.selectedPieceIds.has(piece.id), theme);
  }

  ctx.restore();
};
