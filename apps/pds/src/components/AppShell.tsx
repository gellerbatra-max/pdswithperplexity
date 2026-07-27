import { useEffect } from 'react';
import { hydrateFromAutosave, useHistoryStore, useUiStore } from '@/store';
import { CommandPalette } from './CommandPalette';
import { ContextPanel } from './ContextPanel';
import { ImportReviewDialog } from './ImportReviewDialog';
import { InspectorPanel } from './InspectorPanel';
import { StageArea } from './StageArea';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import { WorkspaceRail } from './WorkspaceRail';

/**
 * Six-region desktop shell:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ top bar                                 56px │
 *   ├──────┬─────────┬──────────────┬──────────────┤
 *   │ rail │ context │    stage     │  inspector   │
 *   │ 64px │ resize  │   flexible   │    288px     │
 *   ├──────┴─────────┴──────────────┴──────────────┤
 *   │ status bar                              32px │
 *   └──────────────────────────────────────────────┘
 *
 * Only the stage flexes; every other region is fixed or user-sized, so the layout
 * holds its proportions at any window size.
 */
export const AppShell = () => {
  const contextPanelOpen = useUiStore((s) => s.contextPanelOpen);
  const inspectorOpen = useUiStore((s) => s.inspectorOpen);

  // Runs once on mount: if a prior session left an autosave in IndexedDB, it
  // replaces the seed document. History is reset either way, since undoing
  // into whatever was live before hydration makes no sense.
  useEffect(() => {
    void hydrateFromAutosave().finally(() => useHistoryStore.getState().reset());
  }, []);

  return (
    <div className="shell">
      <TopBar />
      <div className="shell__body">
        <WorkspaceRail />
        {contextPanelOpen ? <ContextPanel /> : null}
        <StageArea />
        {inspectorOpen ? <InspectorPanel /> : null}
      </div>
      <StatusBar />
      <CommandPalette />
      <ImportReviewDialog />
    </div>
  );
};
