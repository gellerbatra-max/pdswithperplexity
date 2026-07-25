import type { WorkspaceModule } from '../types';
import { GradeContext } from './GradeContext';
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
  tools: [
    { id: 'select', label: 'Select', hint: 'Pick pieces and grade points', status: 'available', shortcut: 'V' },
    { id: 'grade-point', label: 'Grade point', hint: 'Mark a graded node', status: 'planned' },
    { id: 'grade-rule', label: 'Grade rule', hint: 'Assign X/Y increments', status: 'planned' },
    { id: 'size-chart', label: 'Size chart', hint: 'Define the size range', status: 'planned' },
    { id: 'nest', label: 'Nest sizes', hint: 'Overlay all graded sizes', status: 'planned' },
    { id: 'alteration', label: 'Alteration table', hint: 'Per-size adjustments', status: 'planned' },
  ],
};

export { GradeContext, GradeStage, GradePanel };
