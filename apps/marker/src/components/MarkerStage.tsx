import { useEffect, useRef } from 'react';
import { MarkerCanvas, MIN_FABRIC_LENGTH } from '@/canvas/MarkerCanvas';
import { markerLength } from '@/marker/selectors';
import { useMarkerStore } from '@/store/markerStore';
import { useUiStore } from '@/store/uiStore';
import { useViewportStore } from '@/store/viewportStore';

/**
 * Hosts the imperative Konva canvas.
 *
 * This is the one component that talks to MarkerCanvas. It pushes store state
 * in and routes canvas events back out, so the canvas itself never imports a
 * store and the rest of the shell never touches Konva.
 */

/** Matches the zoom feel of the PDS zoom cluster. */
const ZOOM_STEP = 1.2;

export const MarkerStage = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = new MarkerCanvas(container, {
      onPanBy: (dx, dy) => {
        const { panX, panY, setPan } = useViewportStore.getState();
        setPan(panX + dx, panY + dy);
      },
      onStageResize: (width, height) => useViewportStore.getState().setStageSize(width, height),
      onPieceMoved: (pieceId, position) =>
        useMarkerStore.getState().updatePiece(pieceId, { position }),
      onPieceSelected: (pieceId, additive) => {
        const ui = useUiStore.getState();
        if (additive) ui.addToSelection(pieceId);
        else ui.setSelection([pieceId]);
      },
    });

    const render = () =>
      canvas.update(
        useMarkerStore.getState().document,
        useViewportStore.getState(),
        useUiStore.getState().selection,
      );

    render();
    const unsubscribeMarker = useMarkerStore.subscribe(render);
    const unsubscribeViewport = useViewportStore.subscribe(render);
    const unsubscribeUi = useUiStore.subscribe(render);

    return () => {
      unsubscribeMarker();
      unsubscribeViewport();
      unsubscribeUi();
      canvas.destroy();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never steal keys from a field the user is typing in.
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;

      const { zoom, setZoom, zoomToFit } = useViewportStore.getState();
      // '=' is the unshifted key most keyboards put '+' on.
      if (event.key === '+' || event.key === '=') setZoom(zoom * ZOOM_STEP);
      else if (event.key === '-') setZoom(zoom / ZOOM_STEP);
      else if (event.key === '0') {
        const document = useMarkerStore.getState().document;
        if (!document) return;
        zoomToFit(Math.max(markerLength(document), MIN_FABRIC_LENGTH), document.fabricWidth);
      } else if (event.key === 'Escape') useUiStore.getState().clearSelection();
      else return;
      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return <div className="marker-stage" ref={containerRef} />;
};
