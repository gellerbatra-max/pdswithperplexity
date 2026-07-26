import type { WorkspaceModule } from '../types';
import { GradeContext } from './GradeContext';
import { GradeDrawer } from './GradeDrawer';
import { GradePanel } from './GradePanel';
import { GradeStage } from './GradeStage';

/** Size development: grade points, grade rules, size charts, nested-size review. */
export const gradeWorkspace: WorkspaceModule = {
  id: 'grade',
  title: 'Grade',
  summary: 'Develop the size range from the base pattern.',
  icon: 'grade',
  Context: GradeContext,
  Stage: GradeStage,
  Panel: GradePanel,
  Drawer: GradeDrawer,
  tools: [
    { id: 'select', icon: 'cursor', label: 'Select', hint: 'Pick pieces and grade points', status: 'available', shortcut: 'V' },
    { id: 'grade-point', icon: 'target', label: 'Grade point', hint: 'Mark a graded node', status: 'planned' },
    { id: 'grade-rule', icon: 'table', label: 'Grade rule', hint: 'Assign X/Y increments', status: 'planned' },
    { id: 'size-chart', icon: 'library', label: 'Size chart', hint: 'Define the size range', status: 'planned' },
    { id: 'nest', icon: 'layers', label: 'Nest sizes', hint: 'Overlay all graded sizes', status: 'planned' },
    { id: 'alteration', icon: 'table', label: 'Alteration table', hint: 'Per-size adjustments', status: 'planned' },
  ],
};

export { GradeContext, GradeStage, GradePanel, GradeDrawer };
