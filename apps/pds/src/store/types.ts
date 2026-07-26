// Type-only import: no runtime dependency, but it makes a mistyped icon name a
// build error rather than a silently missing glyph.
import type { IconName } from '@/components/Icon';

/**
 * UI and view state types.
 *
 * The pattern document model lives in `@/pattern` — this file is only for state
 * that describes how the app is being *used*, not what the document *is*.
 */

export type SaveState = 'saved' | 'unsaved' | 'saving';

/** Draw layers the stage can show or hide. */
export type LayerId =
  | 'net'
  | 'seam'
  | 'nodes'
  | 'labels'
  | 'notches'
  | 'grain'
  | 'internals'
  | 'annotation';

export type LayerVisibility = Record<LayerId, boolean>;

/** Top-level workspaces. Replaces the legacy ribbon-tab model with one canvas per intent. */
export type WorkspaceId = 'design' | 'grade' | 'fit' | 'prepare' | 'review';

export const WORKSPACE_IDS: readonly WorkspaceId[] = [
  'design',
  'grade',
  'fit',
  'prepare',
  'review',
];

export type ToolId = string;

export type ToolStatus = 'available' | 'planned';

export interface ToolDescriptor {
  readonly id: ToolId;
  readonly label: string;
  /** The dock is icon-first; labels live in the tooltip and the accessible name. */
  readonly icon: IconName;
  readonly hint: string;
  readonly status: ToolStatus;
  /** Single-key accelerator, when the tool has one. */
  readonly shortcut?: string;
}
