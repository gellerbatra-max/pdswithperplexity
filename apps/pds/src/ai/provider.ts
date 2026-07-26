import { MOCK_RECOMMENDATIONS } from './mock';
import type { AiProvider, Recommendation, RecommendationRequest } from './types';

/**
 * Provider boundary — local-first by construction.
 *
 * A pattern is commercially sensitive intellectual property. The architecture
 * therefore assumes inference runs on the machine: the default provider is
 * local, and installing a provider that sends anything off-device requires an
 * explicit opt-in that a caller has to make deliberately (`allowRemoteProviders`).
 * That call is the single place a reviewer has to look to answer "can this app
 * upload my patterns".
 *
 * Nothing here calls a model. `localMockProvider` returns hand-written
 * recommendations from `mock.ts` so the UI has real data shapes to render.
 *
 * TODO(local-ai): add a provider backed by on-device inference. The rule checks
 * behind most recommendations are deterministic (seam-length mismatch, ease
 * progression) and should be written as plain analysers first — a model is only
 * needed for the judgement calls. See DEVELOPMENT.md.
 */

const matchesRequest = (
  recommendation: Recommendation,
  request: RecommendationRequest,
): boolean => {
  if (recommendation.workspace !== request.workspace) return false;
  // With nothing selected the assistant stays quiet rather than listing
  // everything — it is contextual, not a feed.
  if (!request.pieceId) return false;
  if (recommendation.target.pieceId !== request.pieceId) return false;
  // A point selection narrows further, but piece-scoped advice still applies.
  if (request.pointId && recommendation.target.pointId) {
    return recommendation.target.pointId === request.pointId;
  }
  return true;
};

/**
 * Default provider. Runs entirely in-process, performs no I/O, and returns the
 * mock set filtered to the request's context.
 */
export const localMockProvider: AiProvider = {
  id: 'local-mock',
  label: 'Local (mock)',
  runtime: 'local',
  capabilities: [
    'dart-placement',
    'grade-anomaly',
    'seam-adjustment',
    'notch-placement',
    'ease-analysis',
  ],
  recommend: async (request) =>
    MOCK_RECOMMENDATIONS.filter((r) => matchesRequest(r, request)),
};

let current: AiProvider = localMockProvider;
let remoteAllowed = false;

/**
 * Opt in to providers that leave the device. Off by default; a real UI would
 * gate this behind an explicit, informed setting rather than calling it at boot.
 */
export const allowRemoteProviders = (allowed: boolean): void => {
  remoteAllowed = allowed;
};

export const isRemoteAllowed = (): boolean => remoteAllowed;

export const getAiProvider = (): AiProvider => current;

export const setAiProvider = (provider: AiProvider): void => {
  if (provider.runtime === 'remote' && !remoteAllowed) {
    throw new Error(
      `Refusing to install remote AI provider "${provider.id}": ` +
        'pattern data is local-first. Call allowRemoteProviders(true) first.',
    );
  }
  current = provider;
};

export const resetAiProvider = (): void => {
  current = localMockProvider;
};

/** Ask the active provider. The only entry point features should use. */
export const requestRecommendations = async (
  request: RecommendationRequest,
): Promise<readonly Recommendation[]> => current.recommend(request);
