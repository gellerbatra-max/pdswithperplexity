import type { WorkspaceId } from '@/store';
import { designWorkspace } from './design';
import { gradeWorkspace } from './grade';
import { fitWorkspace } from './fit';
import { prepareWorkspace } from './prepare';
import { reviewWorkspace } from './review';
import type { WorkspaceModule } from './types';

/** Ordered left-to-right as the rail presents them — the product's core flow. */
export const WORKSPACES: readonly WorkspaceModule[] = [
  designWorkspace,
  gradeWorkspace,
  fitWorkspace,
  prepareWorkspace,
  reviewWorkspace,
];

const BY_ID = new Map<WorkspaceId, WorkspaceModule>(WORKSPACES.map((w) => [w.id, w]));

export const getWorkspace = (id: WorkspaceId): WorkspaceModule => {
  const workspace = BY_ID.get(id);
  if (!workspace) throw new Error(`Unknown workspace: ${id}`);
  return workspace;
};
