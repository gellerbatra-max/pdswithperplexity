import type { WorkspaceModule } from '../types';
import { GradeContext } from './GradeContext';
import { GradeDrawer } from './GradeDrawer';
import { GradePanel } from './GradePanel';
import { GradeStage } from './GradeStage';

/**
 * Size development: grade rules, per-point assignment, nested-size review.
 *
 * The dock lists only `select` because nothing else here is a distinct
 * *canvas* tool — picking a grade point on the stage already works through
 * it (`CanvasStage`'s per-workspace pickable kinds), and assigning or editing
 * a rule happens in the context panel and inspector, the same way every other
 * non-shape-changing edit in this app is a panel field rather than a tool
 * mode. A size chart editor (adding, removing, reordering sizes) is a real,
 * separate gap — see DEVELOPMENT.md — and does not get a placeholder entry
 * here now that this dock only lists what actually does something.
 */
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
  ],
};
