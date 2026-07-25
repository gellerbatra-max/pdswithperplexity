import { ContextToolbar } from './stage/ContextToolbar';
import { MiniMap } from './stage/MiniMap';
import { Rulers } from './stage/Rulers';
import { ZoomControls } from './stage/ZoomControls';

/**
 * Design stage chrome, layered over the shared drafting canvas.
 *
 * Everything here is click-through except the controls themselves, so drawing on
 * the canvas underneath is never blocked. The canvas itself is owned by the shell.
 */
export const DesignStage = () => (
  <>
    <Rulers />
    <ContextToolbar />
    <div className="stage-corner">
      <MiniMap />
      <ZoomControls />
    </div>
  </>
);
