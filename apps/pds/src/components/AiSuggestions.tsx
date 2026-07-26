import {
  CAPABILITY_LABEL,
  getAiProvider,
  useRecommendations,
  type Recommendation,
} from '@/ai';
import { BoundsOps } from '@/geometry';
import { findPiece, pieceBounds } from '@/pattern';
import {
  pieceRef,
  pointRef,
  useDocumentStore,
  useSelectionStore,
  useViewportStore,
} from '@/store';
import { Icon } from './Icon';
import { PanelSection } from './PanelSection';

/**
 * AI suggestions panel.
 *
 * Deliberately an inspector section, not a chat window: the assistant is
 * contextual and secondary, it appears beside the thing it is talking about,
 * and it says nothing until something is selected. There is no prompt box and
 * no conversation — a recommendation is a structured proposal the user accepts
 * or ignores.
 *
 * Preview is implemented: it selects and frames the target, changing nothing.
 * Apply is a placeholder and renders disabled with its reason attached.
 */
const RecommendationCard = ({ recommendation }: { recommendation: Recommendation }) => {
  const document = useDocumentStore((s) => s.document);
  const select = useSelectionStore((s) => s.select);
  const fitTo = useViewportStore((s) => s.fitTo);

  const { target } = recommendation;
  const piece = findPiece(document, target.pieceId);

  const preview = (): void => {
    if (!piece) return;
    select(target.pointId ? pointRef(piece.id, target.pointId) : pieceRef(piece.id), false);
    const bounds = pieceBounds(piece);
    if (!BoundsOps.isEmpty(bounds)) fitTo(bounds);
  };

  return (
    <article className="suggestion" data-tone={recommendation.tone}>
      <header className="suggestion__header">
        <span className="suggestion__icon">
          <Icon name="sparkle" size={13} />
        </span>
        <h4 className="suggestion__title">{recommendation.title}</h4>
        <span className="suggestion__confidence" title="Assistant confidence">
          {Math.round(recommendation.confidence * 100)}%
        </span>
      </header>

      <div className="suggestion__block">
        <span className="suggestion__label">Why</span>
        <p className="suggestion__detail">{recommendation.why}</p>
      </div>

      <div className="suggestion__block">
        <span className="suggestion__label">What changes</span>
        <ul className="changes">
          {recommendation.changes.map((change, index) => (
            <li className="change" key={`${recommendation.id}-${index}`}>
              <span className="change__target">{change.target}</span>
              <span className="change__summary">{change.summary}</span>
              {change.from !== undefined || change.to !== undefined ? (
                <span className="change__delta">
                  {change.from !== undefined ? (
                    <span className="change__from">{change.from}</span>
                  ) : null}
                  <Icon name="chevron-right" size={11} />
                  <span className="change__to">{change.to ?? '—'}</span>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <footer className="suggestion__footer">
        <span className="badge" data-tone="muted">
          {CAPABILITY_LABEL[recommendation.capability]}
        </span>
        <span className="suggestion__actions">
          <button
            type="button"
            onClick={preview}
            disabled={!piece}
            title={piece ? `Reveal ${target.label}` : 'Target is no longer in the document'}
          >
            {recommendation.preview.label}
          </button>
          <button
            type="button"
            disabled
            title={recommendation.apply.unavailableReason ?? 'Not implemented'}
          >
            {recommendation.apply.label}
          </button>
        </span>
      </footer>
    </article>
  );
};

export const AiSuggestions = () => {
  const { recommendations, loading, idle } = useRecommendations();

  // Naming the provider and where it runs keeps local-first visible in the UI,
  // not just in the architecture.
  const provider = getAiProvider();
  const provenance =
    provider.runtime === 'local'
      ? `${provider.label} · runs on this machine, nothing is uploaded`
      : `${provider.label} · remote provider`;

  return (
    <PanelSection
      title="AI Suggestions"
      caption={idle ? '—' : loading ? '…' : String(recommendations.length)}
    >
      {idle ? (
        <p className="muted">Select a piece to see suggestions for it.</p>
      ) : loading ? (
        <p className="muted">Thinking…</p>
      ) : recommendations.length === 0 ? (
        <p className="muted">Nothing to suggest here.</p>
      ) : (
        <ul className="suggestions">
          {recommendations.map((recommendation) => (
            <li key={recommendation.id}>
              <RecommendationCard recommendation={recommendation} />
            </li>
          ))}
        </ul>
      )}
      <p className="muted table-note">{provenance}</p>
    </PanelSection>
  );
};
