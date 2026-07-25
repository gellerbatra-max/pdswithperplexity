import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  label: string;
  active?: boolean;
}

/** Square, icon-only control used throughout the chrome. `label` is the a11y name. */
export const IconButton = ({ icon, label, active, ...rest }: IconButtonProps) => (
  <button
    type="button"
    className="icon-button"
    data-active={active || undefined}
    aria-label={label}
    title={label}
    {...rest}
  >
    <Icon name={icon} />
  </button>
);
