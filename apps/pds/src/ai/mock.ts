import type { Recommendation, RecommendationAction } from './types';

/**
 * Mock recommendations.
 *
 * Hand-written against the seed pattern (SH-2041), not produced by any model.
 * They exist so the panel, the targeting and the preview action can be built
 * and exercised before inference exists — and they are shaped exactly like the
 * output a provider must return, so swapping in a real one changes the source
 * and nothing else.
 */

const PREVIEW: RecommendationAction = {
  label: 'Preview',
  availability: 'available',
};

const APPLY: RecommendationAction = {
  label: 'Apply',
  availability: 'not-implemented',
  unavailableReason: 'Applying a recommendation needs the editing tools, which are not built yet.',
};

export const MOCK_RECOMMENDATIONS: readonly Recommendation[] = [
  {
    id: 'rec-dart-move',
    capability: 'dart-placement',
    workspace: 'design',
    tone: 'suggestion',
    title: 'Move the chest pocket placement 12 mm toward centre front',
    why: 'The placement box sits 52 mm from centre front while the shoulder point has moved outward, leaving the pocket visually off-centre on the finished front.',
    confidence: 0.72,
    target: { pieceId: 'piece-front-left', label: 'Front Left · pocket placement' },
    changes: [
      {
        target: 'Front Left · Chest pocket placement',
        summary: 'Shift the placement rectangle toward centre front',
        from: 'x 52 mm',
        to: 'x 40 mm',
      },
    ],
    preview: PREVIEW,
    apply: APPLY,
  },
  {
    id: 'rec-seam-mismatch',
    capability: 'seam-adjustment',
    workspace: 'design',
    tone: 'issue',
    title: 'Match seam allowance across the armhole',
    why: 'Sleeve uses 12 mm on the cap while Front Left uses 10 mm on the armhole it joins. Mismatched allowances on a sewn pair mis-align the notches at the machine.',
    confidence: 0.94,
    target: { pieceId: 'piece-sleeve', label: 'Sleeve ↔ Front Left armhole' },
    changes: [
      {
        target: 'Sleeve · seam allowance',
        summary: 'Reduce to match the mating armhole',
        from: '12.0 mm',
        to: '10.0 mm',
      },
    ],
    preview: PREVIEW,
    apply: APPLY,
  },
  {
    id: 'rec-balance-notch',
    capability: 'notch-placement',
    workspace: 'design',
    tone: 'suggestion',
    title: 'Add a balance notch to the back side seam',
    why: 'The back side seam runs 320 mm between the underarm and the hem with no balance notch, which makes it easy to ease unevenly when joining.',
    confidence: 0.68,
    target: { pieceId: 'piece-back', label: 'Back · side seam' },
    changes: [
      {
        target: 'Back · Side seam',
        summary: 'Place a slit notch at the midpoint',
        to: '50% along the segment',
      },
      {
        target: 'Front Left · Side seam',
        summary: 'Place the mating notch so the pair walks together',
        to: '50% along the segment',
      },
    ],
    preview: PREVIEW,
    apply: APPLY,
  },
  {
    id: 'rec-grade-anomaly-shoulder',
    capability: 'grade-anomaly',
    workspace: 'grade',
    tone: 'warning',
    title: 'Shoulder grades slower than the chest',
    why: 'Across-shoulder grows 10 mm per size while the chest grows 20 mm. The ratio drifts across the range, so the largest sizes will read narrow-shouldered.',
    confidence: 0.81,
    target: { pieceId: 'piece-back', pointId: 'piece-back-p3', label: 'Back · HPS' },
    changes: [
      {
        target: 'Back · HPS — rule 4',
        summary: 'Raise the shoulder increment',
        from: '5.0 mm per size',
        to: '7.0 mm per size',
      },
    ],
    preview: PREVIEW,
    apply: APPLY,
  },
  {
    id: 'rec-grade-anomaly-cap',
    capability: 'grade-anomaly',
    workspace: 'grade',
    tone: 'issue',
    title: 'Sleeve cap ease grows across the range',
    why: 'Cap ease increases about 4 mm per size against the armhole it sets into. By XXL the sleeve is roughly 18 mm over the workable range for woven poplin.',
    confidence: 0.86,
    target: { pieceId: 'piece-sleeve', pointId: 'piece-sleeve-p1', label: 'Sleeve · cap point' },
    changes: [
      {
        target: 'Sleeve · Cap point — rule 4',
        summary: 'Reduce the cap increment so ease holds across sizes',
        from: '5.0 mm per size',
        to: '3.5 mm per size',
      },
    ],
    preview: PREVIEW,
    apply: APPLY,
  },
  {
    id: 'rec-collar-stand',
    capability: 'grade-anomaly',
    workspace: 'grade',
    tone: 'warning',
    title: 'Collar stand grades slower than the neckline',
    why: 'The stand grades 4 mm per size while the neckline it joins grades 8 mm, so the two diverge steadily toward the top of the range.',
    confidence: 0.63,
    target: { pieceId: 'piece-collar-stand', label: 'Collar Stand · neckline' },
    changes: [
      {
        target: 'Collar Stand — rule 6',
        summary: 'Match the neckline increment',
        from: '4.0 mm per size',
        to: '8.0 mm per size',
      },
    ],
    preview: PREVIEW,
    apply: APPLY,
  },
];
