import type { PatternDocument } from '@/pattern';

/** Capabilities the AI layer is being built toward. */
export type AiCapability =
  | 'draft-from-brief'
  | 'suggest-grade-rules'
  | 'suggest-seam-allowance'
  | 'place-notches'
  | 'audit-pattern';

export interface AiSuggestion {
  readonly id: string;
  readonly capability: AiCapability;
  readonly title: string;
  readonly detail: string;
  readonly confidence: number;
}

export interface AiRequest {
  readonly capability: AiCapability;
  readonly prompt: string;
  readonly document: PatternDocument;
}

/**
 * Provider boundary. Nothing in the app calls a model directly — features ask the
 * provider, so the transport (hosted API, local, mock) stays swappable.
 */
export interface AiProvider {
  readonly id: string;
  readonly capabilities: readonly AiCapability[];
  suggest: (request: AiRequest) => Promise<readonly AiSuggestion[]>;
}
