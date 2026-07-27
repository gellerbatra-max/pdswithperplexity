import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { useHistoryStore, type HistoryEntry } from '@/store';

/**
 * The real edit log, read straight off the command stack.
 *
 * Reads top-down newest-first. Entries above the current position are ones that
 * have been undone: they are still on the stack and still redoable, so they are
 * shown dimmed rather than hidden — losing them from view is how an undo starts
 * to feel like a delete.
 *
 * Coalesced edits need no handling here. `historyStore` merges a coalesced
 * command into the entry it replaces, so a typing burst or a drag is already one
 * entry by the time it reaches this list.
 */

/** How often relative timestamps are refreshed while the panel is open. */
const TICK_MS = 30_000;

const relativeTime = (at: number, now: number): string => {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 10) return 'now';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

interface Row {
  readonly entry: HistoryEntry;
  /** On the redo side of the current position. */
  readonly undone: boolean;
  /** The state the document is in right now. */
  readonly current: boolean;
}

export const HistoryList = () => {
  const past = useHistoryStore((s) => s.past);
  const future = useHistoryStore((s) => s.future);

  // Relative times would otherwise freeze at whatever they read when the last
  // command ran. Only ticks while this panel is mounted.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  if (past.length === 0 && future.length === 0) {
    return <p className="empty-state">No edits yet.</p>;
  }

  /*
   * Newest first. `future` is a stack whose last entry is the next redo, so it
   * is already newest-first; `past` is oldest-first and has to be reversed. The
   * boundary between the two is where the document currently stands.
   */
  const rows: Row[] = [
    ...future.map((entry) => ({ entry, undone: true, current: false })),
    ...[...past].reverse().map((entry, index) => ({
      entry,
      undone: false,
      current: index === 0,
    })),
  ];

  return (
    <>
      <ol className="history">
        {rows.map(({ entry, undone, current }, index) => (
          <li key={`${index}-${entry.at}`}>
            <div
              className="history__row"
              data-current={current || undefined}
              data-undone={undone || undefined}
            >
              <span className="history__dot" aria-hidden="true" />
              <span className="history__text">
                <span className="history__label">{entry.command.label}</span>
                {entry.command.detail ? (
                  <span className="history__detail">{entry.command.detail}</span>
                ) : null}
              </span>
              <span className="history__time">
                <Icon name="clock" size={11} />
                {relativeTime(entry.at, now)}
              </span>
            </div>
          </li>
        ))}
      </ol>

      {/* With nothing in `past` there is no current row to mark, so the state
          is stated instead of left to be inferred from an all-dimmed list. */}
      {past.length === 0 ? <p className="empty-state">All edits undone.</p> : null}
    </>
  );
};
