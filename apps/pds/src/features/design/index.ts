import type { WorkspaceModule } from '../types';
import { DesignContext } from './DesignContext';
import { DesignPanel } from './DesignPanel';
import { DesignStage } from './DesignStage';

/**
 * Drafting and shaping of pattern pieces: outlines, seam allowance, notches,
 * grain, and annotation.
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
    { id: 'select', label: 'Select', hint: 'Pick pieces and nodes', status: 'available', shortcut: 'V' },
    { id: 'pan', label: 'Pan', hint: 'Drag the canvas', status: 'available', shortcut: 'H' },
    { id: 'point', label: 'Point', hint: 'Place a construction point', status: 'planned', shortcut: 'P' },
    { id: 'line', label: 'Line', hint: 'Draw a straight segment', status: 'planned', shortcut: 'L' },
    { id: 'curve', label: 'Curve', hint: 'Draw a shaped segment', status: 'planned', shortcut: 'C' },
    { id: 'seam-allowance', label: 'Seam allowance', hint: 'Offset the net line', status: 'planned' },
    { id: 'notch', label: 'Notch', hint: 'Place and type notches', status: 'planned', shortcut: 'N' },
    { id: 'grain', label: 'Grain line', hint: 'Set grain direction', status: 'planned', shortcut: 'G' },
    { id: 'annotate', label: 'Annotate', hint: 'Piece name, text, symbols', status: 'planned' },
  ],
};

export { DesignContext, DesignStage, DesignPanel };
