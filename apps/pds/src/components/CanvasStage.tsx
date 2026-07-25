import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fitBounds,
  getTool,
  panTool,
  renderScene,
  screenToWorld,
  useCanvasSurface,
  type Scene,
  type ToolActions,
  type ToolContext,
  type ToolGesture,
} from '@/canvas';
import { BoundsOps, type Vec2 } from '@/geometry';
import { documentBounds } from '@/pattern';
import {
  selectionKey,
  useDocumentStore,
  useSelectionStore,
  useUiStore,
  useViewportStore,
  type SelectionKind,
  type SelectionRef,
} from '@/store';

const ZOOM_SENSITIVITY = 0.0015;

/** Pick tolerance for points, in screen pixels. */
const POINT_PICK_RADIUS_PX = 9;

/**
 * What each workspace lets you pick, most specific first. Grade works on grade
 * points, so those win over the piece they sit on; everything else selects
 * whole pieces.
 */
const SELECTABLE_BY_WORKSPACE: Record<string, readonly SelectionKind[]> = {
  grade: ['point', 'piece'],
};
const DEFAULT_SELECTABLE: readonly SelectionKind[] = ['piece'];

/**
 * Canvas host.
 *
 * Owns the surface, the render loop and pointer plumbing — and nothing else.
 * All interaction behaviour lives in `canvas/tools`, so adding a drafting tool
 * means writing a `CanvasTool` and registering it, never editing this file.
 */
export const CanvasStage = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surface = useCanvasSurface(canvasRef);

  /** The drag in progress, owned by whichever tool started it. */
  const gestureRef = useRef<ToolGesture | null>(null);
  const [gestureCursor, setGestureCursor] = useState<string | null>(null);
  const [hover, setHover] = useState<SelectionRef | null>(null);

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
  const panBy = useViewportStore((s) => s.panBy);
  const zoomAtPoint = useViewportStore((s) => s.zoomAtPoint);
  const setCursor = useViewportStore((s) => s.setCursor);

  const activeTool = useUiStore((s) => s.activeTool);
  const workspace = useUiStore((s) => s.workspace);
  const didFitRef = useRef(false);

  const tool = getTool(activeTool);

  /* --- Actions handed to tools ------------------------------------------- */

  const actions = useMemo<ToolActions>(
    () => ({
      select,
      clearSelection,
      panBy,
      // Only re-render when the hovered thing actually changes; pointer moves
      // fire far faster than the scene needs to redraw.
      setHover: (ref) =>
        setHover((current) => {
          const same =
            current === ref ||
            (current !== null && ref !== null && selectionKey(current) === selectionKey(ref));
          return same ? current : ref;
        }),
    }),
    [select, clearSelection, panBy],
  );

  /* --- Frame the document once, so it never opens off-screen -------------- */

  useEffect(() => {
    if (didFitRef.current || surface.width === 0 || pieces.length === 0) return;
    const bounds = documentBounds(doc);
    if (BoundsOps.isEmpty(bounds)) return;
    didFitRef.current = true;
    setCamera(fitBounds(bounds, surface.width, surface.height));
  }, [doc, pieces, surface, setCamera]);

  /* --- Draw --------------------------------------------------------------- */

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx || surface.width === 0) return;

    const scene: Scene = {
      pieces,
      selectedPieceIds,
      selectedPointIds,
      hoveredPieceId: hover?.pieceId ?? null,
      hoveredPointId: hover?.kind === 'point' ? hover.pointId : null,
    };

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
    hover,
    camera,
    surface,
    showGrid,
    layers,
    workspace,
  ]);

  /* --- Wheel: viewport concern, not a tool concern ------------------------ */

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

  /* --- Pointer plumbing --------------------------------------------------- */

  const buildContext = (
    event: React.PointerEvent<HTMLCanvasElement>,
  ): ToolContext => {
    const rect = event.currentTarget.getBoundingClientRect();
    const screen: Vec2 = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return {
      pieces,
      camera,
      screen,
      world: screenToWorld(camera, screen),
      modifiers: {
        shift: event.shiftKey,
        alt: event.altKey,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
      },
      button: event.button,
      selectableKinds: SELECTABLE_BY_WORKSPACE[workspace] ?? DEFAULT_SELECTABLE,
      pickRadius: POINT_PICK_RADIUS_PX / camera.zoom,
    };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const ctx = buildContext(event);

    // Middle-drag pans regardless of the active tool — universal convention.
    const active = event.button === 1 ? panTool : tool;
    const gesture = active.onPointerDown?.(ctx, actions);
    if (!gesture) return;

    gestureRef.current = gesture;
    setGestureCursor(gesture.cursor ?? null);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const ctx = buildContext(event);
    setCursor(ctx.world);

    const gesture = gestureRef.current;
    if (gesture) gesture.onMove?.(ctx, actions);
    else tool.onPointerMove?.(ctx, actions);
  };

  const endGesture = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    const gesture = gestureRef.current;
    if (!gesture) return;

    gesture.onEnd?.(buildContext(event), actions);
    gestureRef.current = null;
    setGestureCursor(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      className="stage"
      data-tool={activeTool}
      style={{ cursor: gestureCursor ?? tool.cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onPointerLeave={() => {
        setCursor(null);
        setHover(null);
      }}
    />
  );
};
