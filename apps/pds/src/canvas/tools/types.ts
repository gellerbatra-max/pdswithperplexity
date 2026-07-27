import type { Vec2 } from '@/geometry';
import type { HandleKind, PatternPiece, PieceId, PointId, SegmentId } from '@/pattern';
import type { SelectionKind, SelectionRef } from '@/store';
import type { Camera } from '../camera';

/**
 * The canvas interaction layer.
 *
 * A tool is a plain object of optional handlers — no React, no store access, no
 * DOM. Everything it needs arrives in `ToolContext`, and everything it changes
 * goes through `ToolActions`. That keeps tools pure enough to unit test and
 * means adding a drafting tool never touches the canvas host.
 */

export interface PointerModifiers {
  readonly shift: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
  readonly ctrl: boolean;
}

export interface ToolContext {
  readonly pieces: readonly PatternPiece[];
  readonly camera: Camera;
  /** Pointer in CSS pixels, relative to the canvas. */
  readonly screen: Vec2;
  /** Pointer in document space (millimetres). */
  readonly world: Vec2;
  readonly modifiers: PointerModifiers;
  readonly button: number;
  /**
   * What the active workspace allows picking, most specific first. Design picks
   * pieces; Grade tries points and falls back to the piece underneath.
   */
  readonly selectableKinds: readonly SelectionKind[];
  /** Pick tolerance in document units — a constant screen distance at any zoom. */
  readonly pickRadius: number;
  /**
   * The current selection. Tools need it for affordances that only exist on
   * selected geometry — curve handles are drawn for a selected edge and must
   * only be grabbable there, so the tool has to know what is selected to know
   * what is draggable.
   */
  readonly selection: readonly SelectionRef[];
}

/**
 * What a finished drag changed, expressed against the piece as it was when the
 * drag began. `origin` is captured on pointerdown and every intermediate frame
 * is derived from it, so the result depends only on where the pointer ended up,
 * never on how it got there — no accumulated rounding, and a jittery mouse
 * lands in the same place as a straight one.
 */
export interface TranslateEdit {
  readonly pieceId: PieceId;
  readonly origin: PatternPiece;
  readonly delta: Vec2;
  readonly target:
    | { readonly kind: 'points'; readonly pointIds: readonly PointId[] }
    | { readonly kind: 'segment'; readonly segmentId: SegmentId }
    | { readonly kind: 'piece' };
}

export interface ToolActions {
  readonly select: (ref: SelectionRef, additive: boolean) => void;
  readonly clearSelection: () => void;
  readonly panBy: (deltaScreen: Vec2) => void;
  readonly setHover: (ref: SelectionRef | null) => void;
  /**
   * Draw a draft piece without touching the document. Pass null to drop it.
   * This is how a drag shows itself: the document stays untouched until the
   * gesture commits, so an abandoned drag needs no rollback.
   */
  readonly preview: (piece: PatternPiece | null) => void;
  /** Commit a finished drag as exactly one undoable command. */
  readonly commitTranslate: (edit: TranslateEdit) => void;
  /** Commit a finished curve-handle drag. */
  readonly commitHandle: (edit: HandleEdit) => void;
  /** Split an edge at `t`, adding an outline point. Selects the new point. */
  readonly insertPoint: (pieceId: PieceId, segmentId: SegmentId, t: number) => void;
  /** Place a notch on an edge at `t`. */
  readonly addNotch: (pieceId: PieceId, segmentId: SegmentId, t: number) => void;
}

/** A finished handle drag, expressed against the piece the drag started from. */
export interface HandleEdit {
  readonly pieceId: PieceId;
  readonly origin: PatternPiece;
  readonly segmentId: SegmentId;
  readonly handle: HandleKind;
  readonly position: Vec2;
}

/**
 * A drag in progress. Returned from `onPointerDown` to capture the pointer.
 * The gesture closes over its own state, so drag bookkeeping never leaks into
 * the host as refs.
 */
export interface ToolGesture {
  readonly cursor?: string;
  readonly onMove?: (ctx: ToolContext, actions: ToolActions) => void;
  readonly onEnd?: (ctx: ToolContext, actions: ToolActions) => void;
}

export interface CanvasTool {
  readonly id: string;
  /** CSS cursor while this tool is active and idle. */
  readonly cursor: string;
  /** Return a gesture to begin a drag; return nothing for a click-only action. */
  readonly onPointerDown?: (ctx: ToolContext, actions: ToolActions) => ToolGesture | void;
  /** Called on move when no gesture is active — hover feedback and previews. */
  readonly onPointerMove?: (ctx: ToolContext, actions: ToolActions) => void;
  /** Double-click, for actions that need a position rather than a drag. */
  readonly onDoubleClick?: (ctx: ToolContext, actions: ToolActions) => void;
}
