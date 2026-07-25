import type { IconName } from '@/components/Icon';

export type CommandGroupId = 'navigation' | 'design' | 'grade' | 'file';

export interface CommandGroup {
  readonly id: CommandGroupId;
  readonly label: string;
}

/** `ready` commands do the real thing; `mock` ones report back and change nothing. */
export type CommandStatus = 'ready' | 'mock';

export interface Command {
  readonly id: string;
  readonly title: string;
  readonly group: CommandGroupId;
  readonly icon: IconName;
  readonly status: CommandStatus;
  /** Extra match terms — synonyms and jargon that never appear in the title. */
  readonly keywords?: readonly string[];
  /** Displayed right-aligned; purely informational, the palette binds nothing. */
  readonly shortcut?: string;
  /** Commands returning false are listed but not runnable. */
  readonly isEnabled?: () => boolean;
  readonly run: () => void;
}
