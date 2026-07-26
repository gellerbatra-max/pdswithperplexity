export type {
  AiCapability,
  AiProvider,
  ProviderRuntime,
  Recommendation,
  RecommendationAction,
  RecommendationChange,
  RecommendationRequest,
  RecommendationTarget,
  RecommendationTone,
  ActionAvailability,
} from './types';
export { CAPABILITY_LABEL } from './types';

export {
  localMockProvider,
  getAiProvider,
  setAiProvider,
  resetAiProvider,
  requestRecommendations,
  allowRemoteProviders,
  isRemoteAllowed,
} from './provider';

export { MOCK_RECOMMENDATIONS } from './mock';

export { useRecommendations } from './useRecommendations';
export type { RecommendationsState } from './useRecommendations';
