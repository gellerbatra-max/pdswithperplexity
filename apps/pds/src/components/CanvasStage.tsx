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
import { documentBounds, gradeVectors, nestPiece } from '@/pattern';
import {
  addNotch,
  insertPoint,
  moveSegment,
  movePoints,
  pointRef,
  segmentRef,
  selectionKey,
  setSegmentHandle,
  useDocumentStore,
  useGradeStore,
  usePreviewStore,
  useSelectionStore,
  useUiStore,
  useViewportStore,
  type SelectionKind,
  type SelectionRef,
} from '@/store';
import type { NestOverlay } from '@/canvas';

const ZOOM_SENSITIVITY = 0.0015;

/** Pick tolerance for points, in screen pixels. */
const POINT_PICK_RADIUS_PX = 9;

/** Below this the canvas has not been laid out yet, so an initial fit is meaningless. */
const MIN_FIT_SURFACE_PX = 240;

/**
 * What each workspace lets you pick, most specific first. Grade works on grade
 * points, so those win over the piece they sit on; everything else selects
 * whole pieces.
 */
const SELECTABLE_BY_WORKSPACE: Record<string, readonly SelectionKind[]> = {
  // Design drafts geometry, so it picks the smallest thing under the cursor
  // first: a point, then the edge it sits on, then the piece beneath both.
  design: ['point', 'segment', 'piece'],
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

  const selectedPieceIds = useSelectionStore((s) => s.selectedPieceIds);
  const selectedPointIds = useSelectionStore((s) => s.selectedPointIds);
  const selectedSegmentIds = useSelectionStore((s) => s.selectedSegmentIds);
  const selection = useSelectionStore((s) => s.selection);
  const select = useSelectionStore((s) => s.select);
  const clearSelection = useSelectionStore((s) => s.clear);

  const previewPiece = usePreviewStore((s) => s.piece);
  const setPreview = usePreviewStore((s) => s.setPreview);

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

  const activeSizeId = useGradeStore((s) => s.activeSizeId);
  const nestVisible = useGradeStore((s) => s.nestVisible);
  const vectorsVisible = useGradeStore((s) => s.vectorsVisible);

  const tool = getTool(activeTool);

  /*
   * The pieces everything downstream sees.
   *
   * While a drag is in flight the draft piece stands in for its committed self,
   * by id. Doing the substitution here means the renderer, the hit tests and the
   * tools all agree on one set of geometry — in particular, hit-testing against
   * the preview is what keeps the cursor tracking the shape you can actually see.
   */
  const pieces = useMemo(
    () =>
      previewPiece
        ? doc.pieces.map((piece) => (piece.id === previewPiece.id ? previewPiece : piece))
        : doc.pieces,
    [doc.pieces, previewPiece],
  );

  /*
   * Nest overlay for the Grade workspace.
   *
   * Built here because the host owns the render call, and only for the selected
   * piece — nesting all ten every frame would be wasted work, and a grader nests
   * one piece at a time anyway. If a second workspace ever needs to paint over
   * the stage, this is the seam to generalise into an overlay registry.
   */
  const nest = useMemo<NestOverlay | undefined>(() => {
    if (workspace !== 'grade') return undefined;

    const target = pieces.find((piece) => selectedPieceIds.has(piece.id));
    if (!target) return undefined;

    const sizes = nestVisible
      ? nestPiece(target, doc.gradeRules, doc.sizeRange).map((entry) => ({
          ...entry,
          isActive: entry.sizeId === activeSizeId,
        }))
      : [];

    const vectors = vectorsVisible
      ? gradeVectors(target, doc.gradeRules, doc.sizeRange)
      : [];

    if (sizes.length === 0 && vectors.length === 0) return undefined;
    return { sizes, vectors };
  }, [
    workspace,
    pieces,
    selectedPieceIds,
    doc.gradeRules,
    doc.sizeRange,
    activeSizeId,
    nestVisible,
    vectorsVisible,
  ]);

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

      preview: setPreview,

      /*
       * Turns a finished drag into exactly one command. This is the only place
       * a canvas gesture reaches the document, which is what keeps tools free
       * of store imports and keeps every geometry edit on the undo stack.
       */
      commitTranslate: ({ pieceId, origin, delta, target }) => {
        switch (target.kind) {
          case 'points':
            movePoints(pieceId, target.pointIds, delta, origin);
            return;
          case 'segment':
            moveSegment(pieceId, target.segmentId, delta, origin);
            return;
          case 'piece':
            // A whole-piece move is a points edit over every point, but it
            // reads better in history as its own label.
            movePoints(
              pieceId,
              origin.points.map((p) => p.id),
              delta,
              origin,
              { label: 'Move piece', detail: `${origin.name}` },
            );
            return;
        }
      },

      commitHandle: ({ pieceId, origin, segmentId, handle, position }) => {
        setSegmentHandle(pieceId, segmentId, handle, position, origin);
      },

      // Selecting the new point makes the split visible and immediately
      // draggable, which is what you want right after placing one.
      insertPoint: (pieceId, segmentId, t) => {
        const pointId = insertPoint(pieceId, segmentId, t);
        if (pointId) select(pointRef(pieceId, pointId), false);
      },

      // The edge stays selected, so the inspector's notch list shows the one
      // just placed and it can be adjusted or removed straight away.
      addNotch: (pieceId, segmentId, t) => {
        addNotch(pieceId, segmentId, t);
        select(segmentRef(pieceId, segmentId), false);
      },
    }),
    [select, clearSelection, panBy, setPreview],
  );

  /* --- Frame the document once, so it never opens off-screen -------------- */

  useEffect(() => {
    // Wait for a real layout. The first measurement can land before CSS has
    // sized the canvas, and fitting against that would latch a useless camera.
    const laidOut = surface.width >= MIN_FIT_SURFACE_PX && surface.height >= MIN_FIT_SURFACE_PX;
    if (didFitRef.current || !laidOut || pieces.length === 0) return;
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
      selectedSegmentIds,
      hoveredPieceId: hover?.pieceId ?? null,
      hoveredPointId: hover?.kind === 'point' ? hover.pointId : null,
      hoveredSegmentId: hover?.kind === 'segment' ? hover.segmentId : null,
      isPreview: previewPiece !== null,
    };

    renderScene(ctx, scene, {
      camera,
      width: surface.width,
      height: surface.height,
      devicePixelRatio: surface.devicePixelRatio,
      showGrid,
      layers,
      highlightGradePoints: workspace === 'grade',
      nest,
    });
  }, [
    pieces,
    selectedPieceIds,
    selectedPointIds,
    selectedSegmentIds,
    previewPiece,
    hover,
    camera,
    surface,
    showGrid,
    layers,
    workspace,
    nest,
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

  // Takes a MouseEvent rather than a PointerEvent: everything read here —
  // client coordinates, modifiers, button — is on the mouse event, and double
  // click delivers that narrower type.
  const buildContext = (
    event: React.MouseEvent<HTMLCanvasElement>,
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
      selection,
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
      onDoubleClick={(event) => tool.onDoubleClick?.(buildContext(event), actions)}
      onPointerLeave={() => {
        setCursor(null);
        setHover(null);
      }}
    />
  );
};
