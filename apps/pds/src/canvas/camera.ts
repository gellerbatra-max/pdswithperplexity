import type { Bounds, Vec2 } from '@/geometry';

/**
 * Camera maps document space (mm, y-down) to screen space (CSS px).
 * `zoom` is screen px per mm.
 */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 40;

const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

export const worldToScreen = (camera: Camera, p: Vec2): Vec2 => ({
  x: (p.x - camera.x) * camera.zoom,
  y: (p.y - camera.y) * camera.zoom,
});

export const screenToWorld = (camera: Camera, p: Vec2): Vec2 => ({
  x: p.x / camera.zoom + camera.x,
  y: p.y / camera.zoom + camera.y,
});

export const pan = (camera: Camera, deltaScreen: Vec2): Camera => ({
  ...camera,
  x: camera.x - deltaScreen.x / camera.zoom,
  y: camera.y - deltaScreen.y / camera.zoom,
});

/** Zoom while keeping the world point under `anchorScreen` pinned to the cursor. */
export const zoomAt = (camera: Camera, anchorScreen: Vec2, factor: number): Camera => {
  const zoom = clampZoom(camera.zoom * factor);
  if (zoom === camera.zoom) return camera;
  const before = screenToWorld(camera, anchorScreen);
  const after = screenToWorld({ ...camera, zoom }, anchorScreen);
  return { x: camera.x + (before.x - after.x), y: camera.y + (before.y - after.y), zoom };
};

/** Frame `bounds` inside a viewport of `width` x `height` screen px. */
export const fitBounds = (
  bounds: Bounds,
  width: number,
  height: number,
  padding = 48,
): Camera => {
  const contentWidth = bounds.maxX - bounds.minX;
  const contentHeight = bounds.maxY - bounds.minY;
  if (!(contentWidth > 0) || !(contentHeight > 0)) return DEFAULT_CAMERA;

  const zoom = clampZoom(
    Math.min((width - padding * 2) / contentWidth, (height - padding * 2) / contentHeight),
  );
  return {
    zoom,
    x: (bounds.minX + bounds.maxX) / 2 - width / (2 * zoom),
    y: (bounds.minY + bounds.maxY) / 2 - height / (2 * zoom),
  };
};
