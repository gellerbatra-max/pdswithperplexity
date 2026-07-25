import { Icon } from '@/components/Icon';
import { HISTORY } from '../mockData';

/**
 * Mock edit log. Reads top-down newest-first; the topmost entry is the current
 * state. Wires to the real command stack once undo/redo is implemented.
 */
export const HistoryList = () => (
  <ol className="history">
    {HISTORY.map((entry, index) => (
      <li key={entry.id}>
        <div className="history__row" data-current={index === 0 || undefined}>
          <span className="history__dot" aria-hidden="true" />
          <span className="history__text">
            <span className="history__label">{entry.label}</span>
            <span className="history__detail">{entry.detail}</span>
          </span>
          <span className="history__time">
            <Icon name="clock" size={11} />
            {entry.time}
          </span>
        </div>
      </li>
    ))}
  </ol>
);
