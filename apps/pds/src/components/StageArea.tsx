import { getWorkspace } from '@/features';
import { useUiStore } from '@/store';
import { CanvasStage } from './CanvasStage';
import { ToolDock } from './ToolDock';

/**
 * The dominant region, in three layers:
 *
 *   1. CanvasStage — the shared document view. Never unmounts, so the camera and
 *      selection survive every workspace switch.
 *   2. Stage       — the active workspace's overlay. Swaps with the workspace.
 *   3. ToolDock    — the active workspace's tools, floating over both.
 *
 * The overlay is click-through by default; its children opt back in via CSS, so a
 * workspace layer can never accidentally swallow canvas input.
 */
export const StageArea = () => {
  const workspaceId = useUiStore((s) => s.workspace);
  const workspace = getWorkspace(workspaceId);
  const { Stage } = workspace;

  return (
    <main className="stage-area" aria-label={`${workspace.title} stage`}>
      <CanvasStage />
      <div className="stage-layer" data-workspace={workspaceId}>
        <Stage />
      </div>
      <ToolDock />
    </main>
  );
};
