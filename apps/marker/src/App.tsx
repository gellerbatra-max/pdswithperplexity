import { useEffect, useRef, useState } from 'react';
import { startPersistence, type Persistence } from '@/db/persistence';
import { BottomRibbon } from '@/components/BottomRibbon';
import { CommandPalette } from '@/components/CommandPalette';
import { HomeScreen } from '@/components/HomeScreen';
import { MarkerStage } from '@/components/MarkerStage';
import { PieceTray } from '@/components/PieceTray';
import { RightDock } from '@/components/RightDock';
import { StatusBar } from '@/components/StatusBar';
import { TopBar } from '@/components/TopBar';
import { useMarkerStore } from '@/store/markerStore';

/**
 * Two screens, chosen by whether a marker is open.
 *
 * There is no router: the app has exactly one piece of navigation state, and
 * it is already in the store. A URL would have to be kept in step with it for
 * no gain, since a marker lives in this browser and cannot be linked to.
 */
export const App = () => {
  const hasMarker = useMarkerStore((state) => state.document !== null);
  const persistenceRef = useRef<Persistence | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Start the subscription before anything can be opened, so the first edit
    // of a newly created marker is saved like any other.
    const persistence = startPersistence();
    persistenceRef.current = persistence;
    setReady(true);
    return () => {
      persistence.stop();
      persistenceRef.current = null;
    };
  }, []);

  if (!hasMarker) {
    return ready ? <HomeScreen persistence={persistenceRef.current ?? undefined} /> : <main className="home" />;
  }

  // Exactly one <main> per document: the two branches are never both mounted,
  // so the hub and the workspace can each claim it.
  return (
    <div className="marker-app">
      <TopBar persistence={persistenceRef.current ?? undefined} />
      <main className="marker-app__middle">
        <PieceTray />
        <MarkerStage />
        <RightDock />
      </main>
      <BottomRibbon />
      <StatusBar />
      <CommandPalette />
    </div>
  );
};
