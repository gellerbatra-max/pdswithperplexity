import { useEffect, useRef, useState } from 'react';
import { gridStepFor, screenToWorld } from '@/canvas';
import { useViewportStore } from '@/store';

const RULER_SIZE = 22;

interface Tick {
  readonly offset: number;
  readonly value: number;
}

/** Ticks every `step` mm, labelled every 5th, across `extent` screen px. */
const ticksFor = (
  cameraOffset: number,
  zoom: number,
  extent: number,
  step: number,
): Tick[] => {
  const first = Math.floor(cameraOffset / step) * step;
  const out: Tick[] = [];
  for (let value = first; (value - cameraOffset) * zoom <= extent; value += step) {
    out.push({ value, offset: (value - cameraOffset) * zoom });
  }
  return out;
};

/**
 * Ruler gutters along the top and left of the stage. Driven by the live camera —
 * the ticks are real document millimetres, not decoration.
 */
export const Rulers = () => {
  const camera = useViewportStore((s) => s.camera);
  const cursor = useViewportStore((s) => s.cursor);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const sync = (): void => {
      const rect = host.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // One label per 5 minor steps keeps the gutter readable at any zoom.
  const step = gridStepFor(camera.zoom) * 5;
  const xTicks = size.width > 0 ? ticksFor(camera.x, camera.zoom, size.width, step) : [];
  const yTicks = size.height > 0 ? ticksFor(camera.y, camera.zoom, size.height, step) : [];

  const cursorScreen = cursor
    ? {
        x: (cursor.x - camera.x) * camera.zoom,
        y: (cursor.y - camera.y) * camera.zoom,
      }
    : null;

  // Origin marker, so 0,0 is always locatable.
  const origin = screenToWorld(camera, { x: 0, y: 0 });

  return (
    <div className="rulers" ref={hostRef} style={{ '--ruler-size': `${RULER_SIZE}px` } as React.CSSProperties}>
      <div className="ruler ruler--corner" aria-hidden="true">
        mm
      </div>

      <div className="ruler ruler--h" role="presentation">
        {xTicks.map((tick) => (
          <span className="ruler__tick" key={tick.value} style={{ left: tick.offset }}>
            <span className="ruler__label">{Math.round(tick.value)}</span>
          </span>
        ))}
        {origin.x <= 0 ? <span className="ruler__origin" style={{ left: -camera.x * camera.zoom }} /> : null}
        {cursorScreen ? (
          <span className="ruler__cursor" style={{ left: cursorScreen.x }} />
        ) : null}
      </div>

      <div className="ruler ruler--v" role="presentation">
        {yTicks.map((tick) => (
          <span className="ruler__tick" key={tick.value} style={{ top: tick.offset }}>
            <span className="ruler__label">{Math.round(tick.value)}</span>
          </span>
        ))}
        {origin.y <= 0 ? <span className="ruler__origin" style={{ top: -camera.y * camera.zoom }} /> : null}
        {cursorScreen ? <span className="ruler__cursor" style={{ top: cursorScreen.y }} /> : null}
      </div>
    </div>
  );
};
