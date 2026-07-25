import { PanelSection } from '@/components/PanelSection';

export const ReviewContext = () => (
  <PanelSection title="Checks" caption="0 run">
    <p className="muted">
      Verification runs seam-length, notch-pairing and grain checks across every piece
      and reports failures inline on the stage.
    </p>
  </PanelSection>
);
