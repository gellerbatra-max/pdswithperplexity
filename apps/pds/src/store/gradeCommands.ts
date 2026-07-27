import {
  createId,
  type GradeRule,
  type GradeRuleId,
  type PatternDocument,
  type PatternPiece,
  type PieceId,
  type PointId,
  type SizeId,
} from '@/pattern';
import { useDocumentStore } from './documentStore';
import { useHistoryStore } from './historyStore';

/**
 * Grade-rule editing, as undoable commands.
 *
 * Same contract as `documentCommands.ts` and `geometryCommands.ts`: read the
 * live document, build a command that can reverse exactly what it is about to
 * do, run it through `historyStore`. Grade rules live on the document (they
 * are shared across pieces), so most of these edit `document.gradeRules`
 * directly; assigning a rule to a point edits the piece that owns the point,
 * the same way every other point edit does.
 */

const requirePiece = (id: PieceId, action: string): PatternPiece => {
  const piece = useDocumentStore.getState().document.pieces.find((p) => p.id === id);
  if (!piece) throw new Error(`${action}: no piece with id "${id}"`);
  return piece;
};

const replacePiece = (
  document: PatternDocument,
  id: PieceId,
  next: PatternPiece,
): PatternDocument => ({
  ...document,
  pieces: document.pieces.map((p) => (p.id === id ? next : p)),
});

const editPiece = (
  document: PatternDocument,
  id: PieceId,
  change: (piece: PatternPiece) => PatternPiece,
): PatternDocument => {
  const piece = document.pieces.find((p) => p.id === id);
  return piece ? replacePiece(document, id, change(piece)) : document;
};

const requireRule = (id: GradeRuleId, action: string): GradeRule => {
  const rule = useDocumentStore.getState().document.gradeRules.find((r) => r.id === id);
  if (!rule) throw new Error(`${action}: no grade rule "${id}"`);
  return rule;
};

const round = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

/* --- Grade rules -------------------------------------------------------- */

/**
 * A default name for a freshly created rule — a pattern maker renames on the
 * spot, same as a new layer or a new piece gets a placeholder name elsewhere
 * in this app. One counter shared by every caller (the context panel's "+"
 * button, the command palette), so creating a rule from either path in the
 * same session never proposes the same draft code twice.
 */
let draftRuleSequence = 0;
export const nextDraftGradeRuleName = (): { readonly code: string; readonly label: string } => {
  draftRuleSequence += 1;
  return { code: `n${draftRuleSequence}`, label: 'New rule' };
};

/**
 * Creates a new grade rule held at zero for every size, and returns its id.
 *
 * A rule with no movement anywhere is not a placeholder state — `gr-0` in the
 * seed document is exactly this, a deliberate "held at base size" rule — so
 * there is nothing invalid about a freshly created one before its increments
 * are filled in with `setGradeIncrement`.
 */
export const createGradeRule = (code: string, label: string): GradeRuleId => {
  const document = useDocumentStore.getState().document;
  const rule: GradeRule = {
    id: createId('gr'),
    code,
    label,
    increments: document.sizeRange.sizes.map((size) => ({ sizeId: size.id, dx: 0, dy: 0 })),
  };

  useHistoryStore.getState().execute({
    label: 'Add grade rule',
    detail: `${rule.code} · ${rule.label}`,
    do: (doc) => ({ ...doc, gradeRules: [...doc.gradeRules, rule] }),
    undo: (doc) => ({ ...doc, gradeRules: doc.gradeRules.filter((r) => r.id !== rule.id) }),
  });

  return rule.id;
};

/** Renames a rule's code and/or label. */
export const renameGradeRule = (
  id: GradeRuleId,
  patch: { readonly code?: string; readonly label?: string },
): void => {
  const before = requireRule(id, 'renameGradeRule');
  const next: GradeRule = { ...before, ...patch };
  if (next.code === before.code && next.label === before.label) return;

  useHistoryStore.getState().execute({
    label: 'Rename grade rule',
    detail: `${before.code} · ${before.label} → ${next.code} · ${next.label}`,
    // Typing into the code or label field fires per keystroke; one rule, one step.
    coalesceKey: `grade-rule-rename:${id}`,
    do: (doc) => ({ ...doc, gradeRules: doc.gradeRules.map((r) => (r.id === id ? next : r)) }),
    undo: (doc) => ({ ...doc, gradeRules: doc.gradeRules.map((r) => (r.id === id ? before : r)) }),
  });
};

/**
 * Deletes a grade rule, and un-assigns it from every point that carried it —
 * across every piece in the document.
 *
 * Left alone, a piece would keep a `gradeRuleId` pointing at nothing, and
 * `pointDelta` already treats an unresolvable rule id as "no movement" — so
 * the point would silently stop grading rather than error, which is exactly
 * the kind of quiet wrongness the rest of this app throws on instead of
 * hiding. The whole document is captured for undo rather than one piece,
 * because this is the one edit here that can touch many pieces at once; it
 * is also a rare, deliberate action, not a per-frame one, so a full snapshot
 * is the simple correct answer rather than the anti-pattern the per-drag
 * commands avoid.
 */
export const deleteGradeRule = (id: GradeRuleId): void => {
  const before = useDocumentStore.getState().document;
  const rule = before.gradeRules.find((r) => r.id === id);
  if (!rule) return;

  useHistoryStore.getState().execute({
    label: 'Delete grade rule',
    detail: `${rule.code} · ${rule.label}`,
    do: (doc) => ({
      ...doc,
      gradeRules: doc.gradeRules.filter((r) => r.id !== id),
      pieces: doc.pieces.map((piece) => {
        if (!piece.points.some((p) => p.gradeRuleId === id)) return piece;
        return {
          ...piece,
          points: piece.points.map((p) => {
            if (p.gradeRuleId !== id) return p;
            const { gradeRuleId: _dropped, ...rest } = p;
            return rest;
          }),
        };
      }),
    }),
    undo: (_document) => before,
  });
};

/**
 * Sets one size's X/Y increment on a rule. The base size is refused rather
 * than written: its increment is zero by definition (see `pattern/grading.ts`),
 * and letting it drift would make every point graded by this rule move at the
 * size everything else is measured from.
 */
export const setGradeIncrement = (
  ruleId: GradeRuleId,
  sizeId: SizeId,
  dx: number,
  dy: number,
): void => {
  const document = useDocumentStore.getState().document;
  const before = requireRule(ruleId, 'setGradeIncrement');
  if (sizeId === document.sizeRange.baseSizeId) return;

  const size = document.sizeRange.sizes.find((s) => s.id === sizeId);
  const previous = before.increments.find((i) => i.sizeId === sizeId);
  if (previous && previous.dx === dx && previous.dy === dy) return;

  const next: GradeRule = {
    ...before,
    increments: previous
      ? before.increments.map((i) => (i.sizeId === sizeId ? { sizeId, dx, dy } : i))
      : [...before.increments, { sizeId, dx, dy }],
  };

  useHistoryStore.getState().execute({
    label: 'Change grade increment',
    detail: `${before.code} · ${size?.label ?? sizeId} → ${round(dx)}, ${round(dy)}mm`,
    // Typing into a dx or dy field fires per keystroke; one rule, one size, one step.
    coalesceKey: `grade-increment:${ruleId}:${sizeId}`,
    do: (doc) => ({ ...doc, gradeRules: doc.gradeRules.map((r) => (r.id === ruleId ? next : r)) }),
    undo: (doc) => ({ ...doc, gradeRules: doc.gradeRules.map((r) => (r.id === ruleId ? before : r)) }),
  });
};

/* --- Point assignment ----------------------------------------------------- */

/**
 * Assigns (or clears, with `ruleId` undefined) a grade rule on one or more
 * points of a piece. A rule is typically shared by many points across many
 * pieces, so this takes a list rather than one point at a time — selecting a
 * shoulder point on every piece and assigning "shoulder width" in one action
 * is the ordinary way a grader works, not a bulk-edit afterthought.
 */
export const setPointsGradeRule = (
  pieceId: PieceId,
  pointIds: readonly PointId[],
  ruleId: GradeRuleId | undefined,
): void => {
  if (pointIds.length === 0) return;
  const before = requirePiece(pieceId, 'setPointsGradeRule');
  const rule = ruleId !== undefined ? requireRule(ruleId, 'setPointsGradeRule') : undefined;

  const ids = new Set(pointIds);
  const apply = (piece: PatternPiece): PatternPiece => ({
    ...piece,
    points: piece.points.map((point) => {
      if (!ids.has(point.id)) return point;
      if (ruleId === undefined) {
        if (point.gradeRuleId === undefined) return point;
        const { gradeRuleId: _dropped, ...rest } = point;
        return rest;
      }
      return point.gradeRuleId === ruleId ? point : { ...point, gradeRuleId: ruleId };
    }),
  });

  useHistoryStore.getState().execute({
    label: ruleId === undefined ? 'Clear grade rule' : 'Assign grade rule',
    detail: `${before.name} · ${pointIds.length === 1 ? '1 point' : `${pointIds.length} points`}${
      rule ? ` → ${rule.code}` : ''
    }`,
    do: (document) => editPiece(document, pieceId, apply),
    undo: (document) => replacePiece(document, pieceId, before),
  });
};
