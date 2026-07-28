import { useCallback, useEffect, useRef, useState } from 'react';
import { createRestorePoint } from '@/db/persistence';
import { markerStatus, utilization } from '@/marker/selectors';
import type { NestInput } from '@/nest/heuristic';
import { NestCancelled, runNest } from '@/nest/nestRunner';
import { useMarkerStore } from '@/store/markerStore';
import { useUiStore, type NestEffortSetting } from '@/store/uiStore';

/**
 * Auto-Nest, with the effort it will run at.
 *
 * Everything already on the marker stays put and is treated as an obstacle:
 * this fills the gaps around a human's work rather than replacing it.
 */

/** Narrow a slider value to the union, rather than asserting it. */
const EFFORT_VALUES: readonly NestEffortSetting[] = [1, 2, 3, 4, 5];
const toEffort = (value: number): NestEffortSetting | undefined =>
  EFFORT_VALUES.find((candidate) => candidate === value);

const EFFORT_NOTES: Record<NestEffortSetting, string> = {
  1: 'Fastest. 1 cm grid, 8 angles for free pieces.',
  2: '0.5 cm grid, 16 angles.',
  3: 'Balanced. 0.33 cm grid, 24 angles.',
  4: '0.25 cm grid, 32 angles.',
  5: 'Tightest and slowest. 0.2 cm grid, 40 angles.',
};

export const AutoNestButton = () => {
  const [open, setOpen] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const effort = useUiStore((state) => state.nestEffort);
  const setEffort = useUiStore((state) => state.setNestEffort);
  const outstanding = useMarkerStore((state) =>
    (state.document?.trayPieces ?? []).reduce(
      (sum, piece) => sum + Math.max(0, piece.quantity - piece.placed),
      0,
    ),
  );

  // Close on an outside click or Escape, the way any menu should.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const start = useCallback(async () => {
    const marker = useMarkerStore.getState().document;
    const ui = useUiStore.getState();
    if (!marker) return;

    const queueSource = marker.trayPieces.filter((piece) => piece.placed < piece.quantity);
    if (queueSource.length === 0) {
      ui.setStatus('info', 'Every piece in the order is already placed');
      return;
    }

    setOpen(false);

    // A nest can move a great deal at once. Snapshot first, so there is a way
    // back that does not depend on the undo stack surviving a reload.
    try {
      await createRestorePoint('Before auto-nest');
    } catch (error) {
      ui.setStatus(
        'warn',
        `Could not save a restore point: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }

    // One entry per outstanding unit, so a quantity of four nests four times.
    const queue = queueSource.flatMap((piece) =>
      Array.from({ length: piece.quantity - piece.placed }, () => piece),
    );

    const input: NestInput = {
      pieces: queue,
      fabricWidth: marker.fabricWidth,
      placed: marker.pieces,
      defectZones: marker.defectZones,
      spliceLines: marker.spliceLines,
      effort: ui.nestEffort,
      cutterBuffer: marker.cutterBuffer,
    };

    setPercent(0);
    ui.setStatus('info', `Nesting ${queue.length} piece(s) at effort ${ui.nestEffort}…`);

    const run = runNest({ input, onProgress: setPercent });
    cancelRef.current = run.cancel;

    try {
      const result = await run.result;
      useMarkerStore.getState().applyPlacements(result.placements);

      const after = useMarkerStore.getState().document;
      const detail = result.unplaced.length > 0 ? `, ${result.unplaced.length} would not fit` : '';
      ui.setStatus(
        result.unplaced.length > 0 ? 'warn' : 'ok',
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

  if (running) {
    return (
      <div className="autonest" ref={rootRef}>
        <button
          type="button"
          className="topbar__button autonest__running"
          onClick={() => cancelRef.current?.()}
          title="Cancel the running nest"
        >
          Cancel {percent}%
        </button>
        <span
          className="autonest__progress"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${percent}%` }} />
        </span>
      </div>
    );
  }

  return (
    <div className="autonest" ref={rootRef}>
      <button
        type="button"
        className="topbar__button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        title="Nest the outstanding pieces"
      >
        Auto-Nest ▾
      </button>

      {open ? (
        <div className="autonest__menu" role="dialog" aria-label="Auto-nest options">
          <label className="autonest__row">
            <span className="field__label">Effort</span>
            <input
              type="range"
              min={1}
              max={5}
              step={1}
              value={effort}
              className="autonest__slider"
              onChange={(event) => {
                const next = toEffort(Number(event.target.value));
                if (next) setEffort(next);
              }}
            />
            <span className="autonest__effort">{effort}</span>
          </label>

          <p className="autonest__note">{EFFORT_NOTES[effort]}</p>
          {/*
            Effort costs twice over — it subdivides the placement grid and, for
            free pieces, the angle set — so run time grows far faster than the
            number suggests. Saying so here is cheaper than a surprised user.
          */}
          {effort >= 4 ? (
            <p className="autonest__warn">Effort {effort} can take minutes on a large order.</p>
          ) : null}

          <div className="autonest__actions">
            <span className="autonest__count">
              {outstanding} piece{outstanding === 1 ? '' : 's'} to place
            </span>
            <button
              type="button"
              className="topbar__button topbar__button--primary"
              onClick={() => void start()}
              disabled={outstanding === 0}
            >
              Start
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};
