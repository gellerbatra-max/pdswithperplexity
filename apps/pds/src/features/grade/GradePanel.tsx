import { PanelSection } from '@/components/PanelSection';

export const GradePanel = () => (
  <PanelSection title="Grade rules" caption="0">
    <p className="muted">
      Grade rules attach X/Y increments to graded nodes. The stage renders the nested
      stack once rules exist.
    </p>
  </PanelSection>
);
