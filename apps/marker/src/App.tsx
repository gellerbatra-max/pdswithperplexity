import { useEffect, useRef } from 'react';
import { MarkerCanvas, MIN_FABRIC_LENGTH } from '@/canvas/MarkerCanvas';
import { markerLength } from '@/marker/selectors';
import { useMarkerStore } from '@/store/markerStore';
import { createSeedMarker } from '@/store/seedMarker';
import { useViewportStore } from '@/store/viewportStore';

/** Matches the zoom feel of the PDS zoom cluster. */
const ZOOM_STEP = 1.2;

/**
 * TODO(step-6): this becomes the full shell — top bar, tray, dock, ribbon,
 * status bar. For now it hosts the canvas and the three camera shortcuts the
 * canvas foundation needs.
 */
export const App = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!useMarkerStore.getState().document) {
      useMarkerStore.getState().loadMarker(createSeedMarker());
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = new MarkerCanvas(container, {
      onPanBy: (dx, dy) => {
        const { panX, panY, setPan } = useViewportStore.getState();
        setPan(panX + dx, panY + dy);
      },
      onStageResize: (width, height) => useViewportStore.getState().setStageSize(width, height),
    });

    // Push state in rather than letting the canvas subscribe: the canvas stays
    // free of store imports, so it can be driven by anything.
    const render = () =>
      canvas.update(useMarkerStore.getState().document, useViewportStore.getState());

    render();
    const unsubscribeMarker = useMarkerStore.subscribe(render);
    const unsubscribeViewport = useViewportStore.subscribe(render);

    return () => {
      unsubscribeMarker();
      unsubscribeViewport();
      canvas.destroy();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { zoom, setZoom, zoomToFit } = useViewportStore.getState();
      // '=' is the unshifted key most keyboards put '+' on.
      if (event.key === '+' || event.key === '=') setZoom(zoom * ZOOM_STEP);
      else if (event.key === '-') setZoom(zoom / ZOOM_STEP);
      else if (event.key === '0') {
        const document = useMarkerStore.getState().document;
        if (!document) return;
        zoomToFit(Math.max(markerLength(document), MIN_FABRIC_LENGTH), document.fabricWidth);
      } else return;
      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="marker-app">
      <div className="marker-stage" ref={containerRef} />
    </div>
  );
};
