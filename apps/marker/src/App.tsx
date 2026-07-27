import { useEffect } from 'react';
import { BottomRibbon } from '@/components/BottomRibbon';
import { MarkerStage } from '@/components/MarkerStage';
import { PieceTray } from '@/components/PieceTray';
import { RightDock } from '@/components/RightDock';
import { StatusBar } from '@/components/StatusBar';
import { TopBar } from '@/components/TopBar';
import { useMarkerStore } from '@/store/markerStore';
import { createSeedMarker } from '@/store/seedMarker';

/** Layout only — every panel reads what it needs from the stores itself. */
export const App = () => {
  useEffect(() => {
    // TODO(step-8): open the last marker from IndexedDB instead of seeding.
    if (!useMarkerStore.getState().document) {
      useMarkerStore.getState().loadMarker(createSeedMarker());
    }
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
    </div>
  );
};
