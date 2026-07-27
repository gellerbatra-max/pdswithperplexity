import { useCallback, useRef, useState } from 'react';
import { createRestorePoint } from '@/db/persistence';
import { markerStatus, utilization } from '@/marker/selectors';
import type { NestEffort, NestInput } from '@/nest/heuristic';
import { NestCancelled, runNest } from '@/nest/nestRunner';
import { useMarkerStore } from '@/store/markerStore';
import { useUiStore } from '@/store/uiStore';

/**
 * Runs the heuristic nester over whatever is still in the tray.
 *
 * Everything already on the marker stays put and is treated as an obstacle:
 * auto-nest fills the gaps around a human's work rather than replacing it.
 */

/** Effort trades search time for fabric. 3 is the useful default. */
const DEFAULT_EFFORT: NestEffort = 3;

export const AutoNestButton = () => {
  const [percent, setPercent] = useState<number | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const start = useCallback(async () => {
    const store = useMarkerStore.getState();
    const marker = store.document;
    const ui = useUiStore.getState();
    if (!marker) return;

    const outstanding = marker.trayPieces.filter((piece) => piece.placed < piece.quantity);
    if (outstanding.length === 0) {
      ui.setStatus('info', 'Every piece in the order is already placed');
      return;
    }

    // A nest can move a great deal at once. Snapshot first, so there is a way
    // back that does not depend on the undo stack surviving a reload.
    try {
      await createRestorePoint('Before auto-nest');
    } catch (error) {
      // Worth saying, not worth blocking on.
      ui.setStatus(
        'warn',
        `Could not save a restore point: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    // One entry per outstanding unit, so a quantity of four nests four times.
    const queue = outstanding.flatMap((piece) =>
      Array.from({ length: piece.quantity - piece.placed }, () => piece),
    );

    const input: NestInput = {
      pieces: queue,
      fabricWidth: marker.fabricWidth,
      placed: marker.pieces,
      defectZones: marker.defectZones,
      spliceLines: marker.spliceLines,
      effort: DEFAULT_EFFORT,
      cutterBuffer: marker.cutterBuffer,
    };

    setPercent(0);
    ui.setStatus('info', `Nesting ${queue.length} piece(s)…`);

    const run = runNest({ input, onProgress: setPercent });
    cancelRef.current = run.cancel;

    try {
      const result = await run.result;
      useMarkerStore.getState().applyPlacements(result.placements);

      const after = useMarkerStore.getState().document;
      const level = result.unplaced.length > 0 ? 'warn' : 'ok';
      const detail =
        result.unplaced.length > 0 ? `, ${result.unplaced.length} would not fit` : '';
      ui.setStatus(
        level,
        `Nested ${result.placements.length} piece(s)${detail} — ${
          after ? utilization(after).toFixed(1) : result.utilization.toFixed(1)
        }% utilisation, ${after ? markerStatus(after) : ''}`,
      );
    } catch (error) {
      if (error instanceof NestCancelled) ui.setStatus('info', 'Auto-nest cancelled');
      else ui.setStatus('error', error instanceof Error ? error.message : 'Auto-nest failed');
    } finally {
      cancelRef.current = null;
      setPercent(null);
    }
  }, []);

  const running = percent !== null;

  return (
    <span className="autonest">
      <button
        type="button"
        className="topbar__button"
        onClick={running ? () => cancelRef.current?.() : () => void start()}
        title={running ? 'Cancel the running nest' : 'Nest the outstanding pieces'}
      >
        {running ? `Cancel ${percent}%` : 'Auto-Nest'}
      </button>
      {running ? (
        <span className="autonest__progress" role="progressbar" aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }} />
        </span>
      ) : null}
    </span>
  );
};
