import type { WorkspaceModule } from '../types';
import { DesignContext } from './DesignContext';
import { DesignPanel } from './DesignPanel';
import { DesignStage } from './DesignStage';

/**
 * Design workspace — drafting and shaping of pattern pieces.
 *
 * The workspace is defined by the three region components it contributes to the
 * shared shell, plus its tool set:
 *
 *   DesignContext — piece tree, block library, layers, history
 *   DesignStage   — rulers, context toolbar, minimap, zoom controls
 *   DesignPanel   — Selection / Geometry / Piece / Construction / Measure / AI
 *
 * There is no single mounted "DesignWorkspace" element: the shell owns the layout
 * and renders each region into its own slot, which is what keeps one shared frame
 * across all five workspaces. This module is the composition root for all of it.
 */
export const designWorkspace: WorkspaceModule = {
  id: 'design',
  title: 'Design',
  summary: 'Draft and shape pattern pieces.',
  icon: 'design',
  Context: DesignContext,
  Stage: DesignStage,
  Panel: DesignPanel,
  /*
   * Only tools that do something.
   *
   * Design used to list seven more, rendered disabled — Point, Line, Curve,
   * Seam allowance, Notch, Grain, Annotate. A dock full of controls that cannot
   * be pressed teaches people the app is broken, and it hid the fact that the
   * work those tools imply is reachable elsewhere: edges are split and notched
   * by double-clicking them, seam allowance is per-piece and per-edge in the
   * inspector, and shape is the Line/Curve/Arc control there. What is genuinely
   * missing — drawing a new piece from nothing, grain, annotation — is recorded
   * in DEVELOPMENT.md rather than mimed here.
   */
  tools: [
    { id: 'select', icon: 'cursor', label: 'Select', hint: 'Pick pieces, edges and points', status: 'available', shortcut: 'V' },
    { id: 'pan', icon: 'hand', label: 'Pan', hint: 'Drag the canvas', status: 'available', shortcut: 'H' },
  ],
};
