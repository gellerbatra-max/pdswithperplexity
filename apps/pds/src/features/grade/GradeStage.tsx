import { StageStub } from '@/components/StageStub';

/**
 * Grade stage layer. The renderer draws graded points as square markers while
 * this workspace is active, and clicking one selects it — the nested size stack
 * itself arrives with the grading engine.
 */
export const GradeStage = () => (
  <StageStub icon="grade" title="Grade" note="Click a grade point to inspect its rule." />
);
