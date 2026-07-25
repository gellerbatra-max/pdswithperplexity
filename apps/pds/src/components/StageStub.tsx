import { Icon, type IconName } from './Icon';

interface StageStubProps {
  icon: IconName;
  title: string;
  note: string;
}

/**
 * Placeholder marker for a workspace's stage layer. Makes the centre-region swap
 * visible while the real overlays (nested sizes, measurement rulers, cut layout,
 * check markers) are still to be built. Delete a workspace's stub once its stage
 * layer draws something real.
 */
export const StageStub = ({ icon, title, note }: StageStubProps) => (
  <div className="stage-stub">
    <span className="stage-stub__icon">
      <Icon name={icon} size={15} />
    </span>
    <span className="stage-stub__text">
      <span className="stage-stub__title">{title}</span>
      <span className="stage-stub__note">{note}</span>
    </span>
  </div>
);
