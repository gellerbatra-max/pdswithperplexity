import { useEffect } from 'react';
import { restoreOrSeed, startPersistence } from '@/db/persistence';
import { BottomRibbon } from '@/components/BottomRibbon';
import { CommandPalette } from '@/components/CommandPalette';
import { MarkerStage } from '@/components/MarkerStage';
import { PieceTray } from '@/components/PieceTray';
import { RightDock } from '@/components/RightDock';
import { StatusBar } from '@/components/StatusBar';
import { TopBar } from '@/components/TopBar';
import { useUiStore } from '@/store/uiStore';

/** Layout only — every panel reads what it needs from the stores itself. */
export const App = () => {
  useEffect(() => {
    // Start the subscription before restoring, so a seeded marker is saved but
    // a restored one is not written straight back.
    const persistence = startPersistence();

    void restoreOrSeed(undefined, persistence).then((outcome) => {
      if (outcome.restored) {
        useUiStore.getState().setStatus('ok', `Reopened ${outcome.marker.name}`);
      }
    });

    return persistence.stop;
  }, []);

  return (
    <div className="marker-app">
      <TopBar />
      <div className="marker-app__middle">
        <PieceTray />
        <MarkerStage />
        <RightDock />
      </div>
      <BottomRibbon />
      <StatusBar />
      <CommandPalette />
    </div>
  );
};
