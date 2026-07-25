import { useCallback, useEffect, useRef } from 'react';
import {
  fitBounds,
  pickPiece,
  pickPoint,
  renderScene,
  screenToWorld,
  useCanvasSurface,
  type Scene,
} from '@/canvas';
import { BoundsOps } from '@/geometry';
import { documentBounds } from '@/pattern';
import {
  pieceRef,
  pointRef,
  useDocumentStore,
  useSelectionStore,
  useUiStore,
  useViewportStore,
} from '@/store';

const ZOOM_SENSITIVITY = 0.0015;

/** Pick radius for points, in screen pixels. */
const POINT_PICK_RADIUS_PX = 9;

/**
 * The canvas is the application. Everything else is chrome arranged around it, and
 * it never unmounts when the workspace changes.
 */
export const CanvasStage = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surface = useCanvasSurface(canvasRef);
  const panningRef = useRef(false);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);

  const doc = useDocumentStore((s) => s.document);
  const pieces = doc.pieces;
  const selectedPieceIds = useSelectionStore((s) => s.selectedPieceIds);
  const selectedPointIds = useSelectionStore((s) => s.selectedPointIds);
  const select = useSelectionStore((s) => s.select);
  const clearSelection = useSelectionStore((s) => s.clear);

  const camera = useViewportStore((s) => s.camera);
  const showGrid = useViewportStore((s) => s.showGrid);
  const layers = useViewportStore((s) => s.layers);
  const setCamera = useViewportStore((s) => s.setCamera);
  const didFitRef = useRef(false);
  const panBy = useViewportStore((s) => s.panBy);
  const zoomAtPoint = useViewportStore((s) => s.zoomAtPoint);
  const setCursor = useViewportStore((s) => s.setCursor);

  const activeTool = useUiStore((s) => s.activeTool);
  const workspace = useUiStore((s) => s.workspace);

  // Frame the document once, on first paint, so it never opens off-screen.
  useEffect(() => {
    if (didFitRef.current || surface.width === 0 || pieces.length === 0) return;
    const bounds = documentBounds(doc);
    if (BoundsOps.isEmpty(bounds)) return;
    didFitRef.current = true;
    setCamera(fitBounds(bounds, surface.width, surface.height));
  }, [doc, pieces, surface, setCamera]);

  // Draw whenever the scene, camera or surface changes.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || surface.width === 0) return;
    const scene: Scene = { pieces, selectedPieceIds, selectedPointIds };
    renderScene(ctx, scene, {
      camera,
      width: surface.width,
      height: surface.height,
      devicePixelRatio: surface.devicePixelRatio,
      showGrid,
      layers,
      highlightGradePoints: workspace === 'grade',
    });
  }, [
    pieces,
    selectedPieceIds,
    selectedPointIds,
    camera,
    surface,
    showGrid,
    layers,
    workspace,
  ]);

  // Wheel must be non-passive so the page does not scroll while zooming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (event.ctrlKey || event.metaKey) {
        zoomAtPoint(anchor, Math.exp(-event.deltaY * ZOOM_SENSITIVITY * 4));
      } else {
        panBy({ x: -event.deltaX, y: -event.deltaY });
      }
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [panBy, zoomAtPoint]);

  const localPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const point = localPoint(event);
    const spaceDrag = event.button === 1 || activeTool === 'pan';

    if (spaceDrag) {
      panningRef.current = true;
      lastPointerRef.current = point;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (event.button !== 0) return;
    const world = screenToWorld(camera, point);

    /*
     * Grade works on points, so it picks those first and only falls back to the
     * piece. Every other workspace selects whole pieces. The tolerance is a
     * constant screen distance, converted to document units so it stays the same
     * physical target at any zoom.
     */
    if (workspace === 'grade') {
      const pointHit = pickPoint(pieces, world, POINT_PICK_RADIUS_PX / camera.zoom);
      if (pointHit) {
        select(pointRef(pointHit.pieceId, pointHit.pointId), event.shiftKey);
        return;
      }
    }

    const hit = pickPiece(pieces, world);
    if (hit) select(pieceRef(hit), event.shiftKey);
    else if (!event.shiftKey) clearSelection();
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const point = localPoint(event);
    setCursor(screenToWorld(camera, point));

    if (!panningRef.current) return;
    const last = lastPointerRef.current;
    if (last) panBy({ x: point.x - last.x, y: point.y - last.y });
    lastPointerRef.current = point;
  };

  const endPan = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!panningRef.current) return;
    panningRef.current = false;
    lastPointerRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="stage"
      data-tool={activeTool}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onPointerLeave={() => setCursor(null)}
    />
  );
};
