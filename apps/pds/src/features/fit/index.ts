import type { WorkspaceModule } from '../types';
import { FitContext } from './FitContext';
import { FitPanel } from './FitPanel';
import { FitStage } from './FitStage';

/** Measurement, ease and fit evaluation against a body or spec. */
export const fitWorkspace: WorkspaceModule = {
  id: 'fit',
  title: 'Fit',
  summary: 'Measure, compare ease, and evaluate fit.',
  icon: 'fit',
  Context: FitContext,
  Stage: FitStage,
  Panel: FitPanel,
  tools: [
    { id: 'select', icon: 'cursor', label: 'Select', hint: 'Pick pieces to measure', status: 'available', shortcut: 'V' },
    { id: 'measure', icon: 'ruler', label: 'Measure', hint: 'Length between points', status: 'planned', shortcut: 'M' },
    { id: 'walk-seam', icon: 'curve', label: 'Walk seam', hint: 'Compare mating seam lengths', status: 'planned' },
    { id: 'ease', icon: 'target', label: 'Ease analysis', hint: 'Pattern vs. body measurement', status: 'planned' },
    { id: 'spec', icon: 'table', label: 'Spec chart', hint: 'Points of measure table', status: 'planned' },
    { id: 'preview-3d', icon: 'prepare', label: '3D preview', hint: 'Drape on an avatar', status: 'planned' },
  ],
};

export { FitContext, FitStage, FitPanel };
