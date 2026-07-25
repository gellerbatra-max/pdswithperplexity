import { screenToWorld, type Camera } from './camera';
import type { CanvasTheme } from './theme';

/** Grid step in mm, chosen so lines stay roughly 8-80 screen px apart at any zoom. */
export const gridStepFor = (zoom: number): number => {
  const target = 12 / zoom; // aim for ~12px minor spacing
  const magnitude = 10 ** Math.floor(Math.log10(target));
  const normalized = target / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
};

export const drawGrid = (
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  width: number,
  height: number,
  theme: CanvasTheme,
): void => {
  const minor = gridStepFor(camera.zoom);
  const major = minor * 10;

  const topLeft = screenToWorld(camera, { x: 0, y: 0 });
  const bottomRight = screenToWorld(camera, { x: width, y: height });

  const line = (step: number, color: string, lineWidth: number): void => {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    const startX = Math.floor(topLeft.x / step) * step;
    for (let x = startX; x <= bottomRight.x; x += step) {
      const sx = Math.round((x - camera.x) * camera.zoom) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, height);
    }
    const startY = Math.floor(topLeft.y / step) * step;
    for (let y = startY; y <= bottomRight.y; y += step) {
      const sy = Math.round((y - camera.y) * camera.zoom) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(width, sy);
    }
    ctx.stroke();
  };

  line(minor, theme.gridMinor, 1);
  line(major, theme.gridMajor, 1);

  // Document origin.
  ctx.beginPath();
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1;
  const ox = Math.round((0 - camera.x) * camera.zoom) + 0.5;
  const oy = Math.round((0 - camera.y) * camera.zoom) + 0.5;
  ctx.moveTo(ox, 0);
  ctx.lineTo(ox, height);
  ctx.moveTo(0, oy);
  ctx.lineTo(width, oy);
  ctx.stroke();
};
