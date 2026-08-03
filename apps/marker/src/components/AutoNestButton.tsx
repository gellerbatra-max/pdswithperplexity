import { useCallback, useEffect, useRef, useState } from 'react';
import { createRestorePoint } from '@/db/persistence';
import { markerStatus, utilization } from '@/marker/selectors';
import { NestCancelled, runNestWorker } from '@/nest/nestRunner';
import {
  ENGINE_LABELS,
  MODE_LABELS,
  MODE_NOTES,
  NEST_MODES,
  requestFromMarker,
  toStorePlacements,
  type NestMode,
} from '@/nest/pipeline';
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

/** Narrow a select value to the union, rather than asserting it. */
const toMode = (value: string): NestMode | undefined =>
  NEST_MODES.find((candidate) => candidate === value);

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
  const mode = useUiStore((state) => state.nestMode);
  const setMode = useUiStore((state) => state.setNestMode);
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

  /**
   * Stop an in-flight run when this button goes away.
   *
   * A run outlives the component otherwise. The worker keeps searching, and
   * its result is applied through `useMarkerStore.getState()`, which is still
   * there — but this button unmounts when the marker closes, so that result
   * belongs to a document the user has left, and could land on the next one
   * they open.
   *
   * `cancelRef` is null except while a run is in flight, so this is a no-op
   * both for the StrictMode remount in development and for any unmount after
   * a run has already settled. Cancelling a settled run cannot take back its
   * result in any case — `nestRunner` guards that, and its tests pin it.
   */
  useEffect(() => () => cancelRef.current?.(), []);

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

    // The pipeline expands quantities, so the count here is only for the
    // message the user reads.
    const outstanding = queueSource.reduce(
      (total, piece) => total + (piece.quantity - piece.placed),
      0,
    );
    const request = requestFromMarker(marker, ui.nestEffort);

    setPercent(0);
    ui.setStatus(
      'info',
      `Nesting ${outstanding} piece(s) — ${MODE_LABELS[ui.nestMode]}, effort ${ui.nestEffort}…`,
    );

    const run = runNestWorker({ request, mode: ui.nestMode, onProgress: setPercent });
    cancelRef.current = run.cancel;

    try {
      const { plan, engine } = await run.result;
      useMarkerStore.getState().applyPlacements(toStorePlacements(plan));

      const after = useMarkerStore.getState().document;
      const detail = plan.unplaced.length > 0 ? `, ${plan.unplaced.length} would not fit` : '';
      // Name the engine only when the user did not: picking "Best of both"
      // means the answer is which one won, and pinning an engine means they
      // already know.
      const chose = ui.nestMode === 'best' ? ` via ${ENGINE_LABELS[engine]}` : '';
      ui.setStatus(
        plan.unplaced.length > 0 ? 'warn' : 'ok',
        `Nested ${plan.placements.length} piece(s)${detail}${chose} — ${
          after ? utilization(after).toFixed(1) : '0.0'
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
            <span className="field__label">Engine</span>
            <select
              className="field__input autonest__mode"
              value={mode}
              onChange={(event) => {
                const next = toMode(event.target.value);
                if (next) setMode(next);
              }}
            >
              {NEST_MODES.map((option) => (
                <option key={option} value={option}>
                  {MODE_LABELS[option]}
                </option>
              ))}
            </select>
          </label>

          <p className="autonest__note">{MODE_NOTES[mode]}</p>

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
