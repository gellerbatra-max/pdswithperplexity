import { useEffect, useState } from 'react';
import { useDocumentStore, useSelectionStore, useUiStore } from '@/store';
import { requestRecommendations } from './provider';
import type { Recommendation } from './types';

export interface RecommendationsState {
  readonly recommendations: readonly Recommendation[];
  readonly loading: boolean;
  /** True when nothing is selected — the assistant stays quiet by design. */
  readonly idle: boolean;
}

/**
 * Binds the active provider to the current workspace and selection.
 *
 * Asynchronous even though the mock provider resolves immediately, because a
 * local model will not: the panel has to tolerate latency from day one. The
 * effect ignores results that arrive after the context has moved on, so a slow
 * answer can never overwrite a newer one.
 */
export const useRecommendations = (): RecommendationsState => {
  const document = useDocumentStore((s) => s.document);
  const workspace = useUiStore((s) => s.workspace);
  const primary = useSelectionStore((s) => s.primary);

  const [recommendations, setRecommendations] = useState<readonly Recommendation[]>([]);
  const [loading, setLoading] = useState(false);

  const pieceId = primary?.pieceId;
  const pointId = primary?.kind === 'point' ? primary.pointId : undefined;

  useEffect(() => {
    if (!pieceId) {
      setRecommendations([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void requestRecommendations({
      document,
      workspace,
      ...(pieceId ? { pieceId } : {}),
      ...(pointId ? { pointId } : {}),
    }).then((result) => {
      if (cancelled) return;
      setRecommendations(result);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [document, workspace, pieceId, pointId]);

  return { recommendations, loading, idle: !pieceId };
};
