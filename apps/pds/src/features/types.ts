import type { ComponentType } from 'react';
import type { IconName } from '@/components/Icon';
import type { ToolDescriptor, WorkspaceId } from '@/store';

/**
 * A workspace is a self-contained mode of the shell: its own tool set and its own
 * content in all three swappable regions. Workspaces replace the legacy ribbon-tab
 * model — one shell, five modes.
 *
 * `Context` is the left panel  — what exists in the document.
 * `Stage`   is the centre layer — what this workspace draws over the document.
 * `Panel`   is the right inspector — properties of what is selected.
 *
 * The shared canvas underneath `Stage` is deliberately *not* per-workspace: it
 * stays mounted across switches so the camera, selection and document view survive.
 * A workspace layers onto that canvas rather than replacing it.
 */
export interface WorkspaceModule {
  readonly id: WorkspaceId;
  readonly title: string;
  readonly summary: string;
  readonly icon: IconName;
  readonly tools: readonly ToolDescriptor[];
  readonly Context: ComponentType;
  readonly Stage: ComponentType;
  readonly Panel: ComponentType;
  readonly Drawer?: ComponentType;
}
