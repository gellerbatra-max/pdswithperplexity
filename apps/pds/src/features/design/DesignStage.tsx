import { StageStub } from '@/components/StageStub';

/** Design draws directly on the shared canvas, so its layer only marks the mode. */
export const DesignStage = () => (
  <StageStub icon="design" title="Design" note="Drafting directly on the pattern." />
);
