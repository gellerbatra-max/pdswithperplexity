/**
 * Shared shapes for the canvas layer.
 *
 * The transform interface lives here rather than in MarkerCanvas so layers can
 * consume it without importing back into the module that constructs them.
 * MarkerCanvas is still the only place that builds one.
 */

/** The camera values the canvas needs — a read-only view of viewportStore. */
export interface ViewportSnapshot {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

/**
 * Marker space (cm, origin bottom-left) → stage space (px, origin top-left).
 *
 * Layers convert through this and never touch zoom or pan directly, so the two
 * coordinate systems meet in exactly one place.
 */
export interface MarkerTransform {
  /** px per cm. */
  readonly scale: number;
  readonly x: (cm: number) => number;
  readonly y: (cm: number) => number;
  /** Stage px back to marker cm — dragging reads positions off the stage. */
  readonly toMarkerX: (px: number) => number;
  readonly toMarkerY: (px: number) => number;
}

export interface FabricLayerInput {
  readonly fabricWidth: number;
  readonly fabricLength: number;
  readonly transform: MarkerTransform;
  /** Stage size in px, so grid and ruler draw only what can be seen. */
  readonly stageWidth: number;
  readonly stageHeight: number;
}
