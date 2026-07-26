import type { PatternDocument, PieceId, PointId } from '@/pattern';
// Direct path, not the store barrel: this module must not pull in the stores.
import type { WorkspaceId } from '@/store/types';

/**
 * Shared types for the assistant layer.
 *
 * The product model is an *assistant*, not a chatbot: recommendations are
 * contextual, secondary, and always attached to something the user can see. A
 * recommendation is a structured proposal — never free text — so the UI can
 * show what would change before anything changes, and so a future apply step
 * has something machine-readable to act on.
 */

export type AiCapability =
  | 'dart-placement'
  | 'grade-anomaly'
  | 'seam-adjustment'
  | 'notch-placement'
  | 'ease-analysis';

export const CAPABILITY_LABEL: Record<AiCapability, string> = {
  'dart-placement': 'Dart placement',
  'grade-anomaly': 'Grading anomaly',
  'seam-adjustment': 'Seam adjustment',
  'notch-placement': 'Notch placement',
  'ease-analysis': 'Ease analysis',
};

/** How strongly a recommendation is worth surfacing. */
export type RecommendationTone = 'suggestion' | 'warning' | 'issue';

/**
 * What a recommendation points at. Ids rather than a `SelectionRef` so this
 * module stays independent of the store; the UI maps it to a selection.
 */
export interface RecommendationTarget {
  readonly pieceId: PieceId;
  readonly pointId?: PointId;
  /** Human-readable, for when the target cannot be resolved. */
  readonly label: string;
}

/**
 * One concrete edit a recommendation proposes. Structured rather than prose so
 * the panel can show a before/after, and so apply has something to execute.
 */
export interface RecommendationChange {
  readonly target: string;
  readonly summary: string;
  readonly from?: string;
  readonly to?: string;
}

export type ActionAvailability = 'available' | 'not-implemented';

export interface RecommendationAction {
  readonly label: string;
  readonly availability: ActionAvailability;
  /** Shown when unavailable, so the gap is explained rather than just disabled. */
  readonly unavailableReason?: string;
}

export interface Recommendation {
  readonly id: string;
  readonly capability: AiCapability;
  /** Which workspace this belongs in. Keeps the assistant contextual. */
  readonly workspace: WorkspaceId;
  readonly tone: RecommendationTone;

  /** One line, imperative — what the assistant is proposing. */
  readonly title: string;
  /** Why it is being raised: the observation behind the proposal. */
  readonly why: string;
  /** What would change if applied. */
  readonly changes: readonly RecommendationChange[];
  /** 0–1. Displayed, never used to auto-apply anything. */
  readonly confidence: number;

  readonly target: RecommendationTarget;

  /**
   * Preview reveals the affected geometry — it selects and frames the target and
   * changes nothing. It is implemented, because it needs no model.
   *
   * Apply would perform the edit. It is a placeholder: no recommendation in this
   * codebase can modify a document.
   */
  readonly preview: RecommendationAction;
  readonly apply: RecommendationAction;
}

export interface RecommendationRequest {
  readonly document: PatternDocument;
  readonly workspace: WorkspaceId;
  /** Narrow to the current selection when there is one. */
  readonly pieceId?: PieceId;
  readonly pointId?: PointId;
}

/**
 * Where inference runs. The product is local-first: the default provider runs
 * on the machine, and a pattern is commercially sensitive intellectual property
 * that must not leave it without an explicit, informed decision.
 */
export type ProviderRuntime = 'local' | 'remote';

export interface AiProvider {
  readonly id: string;
  readonly label: string;
  readonly runtime: ProviderRuntime;
  readonly capabilities: readonly AiCapability[];
  /** Never called during render — the UI requests, the provider answers. */
  readonly recommend: (
    request: RecommendationRequest,
  ) => Promise<readonly Recommendation[]>;
}
