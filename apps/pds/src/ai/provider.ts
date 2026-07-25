import type { AiProvider } from './types';

/**
 * Default provider: reports its capabilities but returns nothing. Swap it out via
 * `setAiProvider` once a real transport is wired up.
 */
export const nullProvider: AiProvider = {
  id: 'null',
  capabilities: [
    'draft-from-brief',
    'suggest-grade-rules',
    'suggest-seam-allowance',
    'place-notches',
    'audit-pattern',
  ],
  suggest: async () => [],
};

let current: AiProvider = nullProvider;

export const getAiProvider = (): AiProvider => current;

export const setAiProvider = (provider: AiProvider): void => {
  current = provider;
};
