import type { WorkspaceModule } from '../types';
import { PrepareContext } from './PrepareContext';
import { PreparePanel } from './PreparePanel';
import { PrepareStage } from './PrepareStage';

/** Production readiness: cut parts, piece data, marker handoff, and export bundles. */
export const prepareWorkspace: WorkspaceModule = {
  id: 'prepare',
  title: 'Prepare',
  summary: 'Ready the pattern for cutting and handoff.',
  icon: 'prepare',
  Context: PrepareContext,
  Stage: PrepareStage,
  Panel: PreparePanel,
  tools: [
    { id: 'select', label: 'Select', hint: 'Pick pieces to prepare', status: 'available', shortcut: 'V' },
    { id: 'cut-parts', label: 'Cut parts', hint: 'Quantity, fold, mirror', status: 'planned' },
    { id: 'piece-data', label: 'Piece data', hint: 'Codes, fabric, category', status: 'planned' },
    { id: 'marker-handoff', label: 'Marker handoff', hint: 'Send pieces to nesting', status: 'planned' },
    { id: 'export', label: 'Export', hint: 'DXF-AAMA, ASTM, PDF, JSON', status: 'planned' },
  ],
};

export { PrepareContext, PrepareStage, PreparePanel };
