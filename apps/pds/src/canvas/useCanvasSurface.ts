import { useEffect, useRef, useState } from 'react';

export interface Surface {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
}

const EMPTY_SURFACE: Surface = { width: 0, height: 0, devicePixelRatio: 1 };

/**
 * Keeps a canvas element's backing store in sync with its CSS size and the
 * device pixel ratio, and reports the current surface metrics.
 */
export const useCanvasSurface = (
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
): Surface => {
  const [surface, setSurface] = useState<Surface>(EMPTY_SURFACE);
  const lastRef = useRef<Surface>(EMPTY_SURFACE);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const sync = (): void => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const next: Surface = {
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        devicePixelRatio: dpr,
      };
      const last = lastRef.current;
      if (
        next.width === last.width &&
        next.height === last.height &&
        next.devicePixelRatio === last.devicePixelRatio
      ) {
        return;
      }
      canvas.width = Math.round(next.width * dpr);
      canvas.height = Math.round(next.height * dpr);
      lastRef.current = next;
      setSurface(next);
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(canvas);
    window.addEventListener('resize', sync);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, [canvasRef]);

  return surface;
};
