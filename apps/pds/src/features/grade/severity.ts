import type { IconName } from '@/components/Icon';
import type { Severity } from '@/diagnostics';

/** Shared between the panel and the drawer — one chip icon per severity, not two definitions of it. */
export const SEVERITY_ICON: Record<Severity, IconName> = {
  error: 'review',
  warning: 'grade',
  info: 'clock',
};
