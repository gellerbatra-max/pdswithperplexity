import { Icon } from '@/components/Icon';
import { PanelSection } from '@/components/PanelSection';
import { SUGGESTIONS } from '../mockData';

/**
 * AI suggestions. Cards are mock output shaped like `AiSuggestion` from `@/ai`;
 * swapping in a real provider means replacing the source, not this component.
 */
export const AiTab = () => (
  <PanelSection title="Suggestions" caption={String(SUGGESTIONS.length)}>
    <ul className="suggestions">
      {SUGGESTIONS.map((suggestion) => (
        <li key={suggestion.id}>
          <article className="suggestion">
            <header className="suggestion__header">
              <span className="suggestion__icon">
                <Icon name="sparkle" size={13} />
              </span>
              <h4 className="suggestion__title">{suggestion.title}</h4>
              <span className="suggestion__confidence" title="Model confidence">
                {Math.round(suggestion.confidence * 100)}%
              </span>
            </header>
            <p className="suggestion__detail">{suggestion.detail}</p>
            <footer className="suggestion__footer">
              <span className="badge" data-tone="muted">
                {suggestion.scope}
              </span>
              <span className="suggestion__actions">
                <button type="button" disabled title="Apply — not built yet">
                  Apply
                </button>
                <button type="button" disabled title="Dismiss — not built yet">
                  Dismiss
                </button>
              </span>
            </footer>
          </article>
        </li>
      ))}
    </ul>
    <p className="muted table-note">
      No provider is configured — these are sample results from the null AI provider.
    </p>
  </PanelSection>
);
