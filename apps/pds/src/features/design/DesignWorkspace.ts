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
  tools: [
    { id: 'select', icon: 'cursor', label: 'Select', hint: 'Pick pieces and nodes', status: 'available', shortcut: 'V' },
    { id: 'pan', icon: 'hand', label: 'Pan', hint: 'Drag the canvas', status: 'available', shortcut: 'H' },
    { id: 'point', icon: 'dot', label: 'Point', hint: 'Place a construction point', status: 'planned', shortcut: 'P' },
    { id: 'line', icon: 'line', label: 'Line', hint: 'Draw a straight segment', status: 'planned', shortcut: 'L' },
    { id: 'curve', icon: 'curve', label: 'Curve', hint: 'Draw a shaped segment', status: 'planned', shortcut: 'C' },
    { id: 'seam-allowance', icon: 'ruler', label: 'Seam allowance', hint: 'Offset the net line', status: 'planned' },
    { id: 'notch', icon: 'notch', label: 'Notch', hint: 'Place and type notches', status: 'planned', shortcut: 'N' },
    { id: 'grain', icon: 'arrow-v', label: 'Grain line', hint: 'Set grain direction', status: 'planned', shortcut: 'G' },
    { id: 'annotate', icon: 'text', label: 'Annotate', hint: 'Piece name, text, symbols', status: 'planned' },
  ],
};
