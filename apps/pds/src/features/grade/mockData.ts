import type { Severity } from '@/diagnostics';
import type { PieceId, PointId } from '@/pattern';

/**
 * Placeholder content for the Grade workspace.
 *
 * These anomalies are hand-written, not derived. A real checker would walk the
 * nest and compare mating seam lengths, ease progression and rule continuity —
 * this stands in so the chip UI and its selection binding can be built first.
 */

export interface GradeAnomaly {
  readonly id: string;
  readonly severity: Severity;
  readonly label: string;
  readonly detail: string;
  /** Scoped to a piece, and optionally to one point on it. */
  readonly pieceId: PieceId;
  readonly pointId?: PointId;
}

export const GRADE_ANOMALIES: readonly GradeAnomaly[] = [
  {
    id: 'ga-1',
    severity: 'error',
    label: 'Cap ease runs away',
    detail: 'Sleeve cap ease grows 4 mm per size against the armhole. XXL is 18 mm over target.',
    pieceId: 'piece-sleeve',
    pointId: 'piece-sleeve-p1',
  },
  {
    id: 'ga-2',
    severity: 'warning',
    label: 'Underarm mismatch',
    detail: 'Sleeve underarm and front armhole diverge from L upward.',
    pieceId: 'piece-sleeve',
    pointId: 'piece-sleeve-p3',
  },
  {
    id: 'ga-3',
    severity: 'warning',
    label: 'Shoulder outpaces chest',
    detail: 'Across-shoulder grows 10 mm per size while chest grows 20 mm. Check the ratio.',
    pieceId: 'piece-back',
    pointId: 'piece-back-p3',
  },
  {
    id: 'ga-4',
    severity: 'info',
    label: 'Hem ungraded',
    detail: 'Centre-back hem holds its base position across the range.',
    pieceId: 'piece-back',
    pointId: 'piece-back-p8',
  },
  {
    id: 'ga-5',
    severity: 'warning',
    label: 'Neckline drift',
    detail: 'Collar stand grades 4 mm per size; the neckline it joins grades 8 mm.',
    pieceId: 'piece-collar-stand',
  },
  {
    id: 'ga-6',
    severity: 'info',
    label: 'Pocket not graded',
    detail: 'Chest pocket is held at one size across the range, which is usually intended.',
    pieceId: 'piece-pocket',
  },
];

/** Anomalies for a piece, with point-scoped ones first when a point is active. */
export const anomaliesFor = (
  pieceId: PieceId | null,
  pointId: PointId | null,
): readonly GradeAnomaly[] => {
  if (!pieceId) return GRADE_ANOMALIES;
  const forPiece = GRADE_ANOMALIES.filter((a) => a.pieceId === pieceId);
  if (!pointId) return forPiece;
  return [...forPiece].sort((a, b) => {
    const aMatch = a.pointId === pointId ? 0 : 1;
    const bMatch = b.pointId === pointId ? 0 : 1;
    return aMatch - bMatch;
  });
};
