import type { Vec2 } from '@/geometry';
import type { PatternPiece } from '@/pattern';
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
}

export interface ToolActions {
  readonly select: (ref: SelectionRef, additive: boolean) => void;
  readonly clearSelection: () => void;
  readonly panBy: (deltaScreen: Vec2) => void;
  readonly setHover: (ref: SelectionRef | null) => void;
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
}
