import { CollapsibleSection } from '@/components/CollapsibleSection';
import { TextInput } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { findPiece } from '@/pattern';
import {
  createGradeRule,
  deleteGradeRule,
  nextDraftGradeRuleName,
  pointRef,
  renameGradeRule,
  useDocumentStore,
  useSelectionStore,
} from '@/store';

/**
 * Grade left panel: the size range, the rule library, and the graded points of
 * whichever piece is in context — so grade points are reachable from the list as
 * well as by picking them on the stage.
 *
 * The rule library is a real editor, not a readout: every rule's code and
 * label commit through `renameGradeRule` on every keystroke (coalesced, like
 * every other text field in this app), and deleting one un-assigns it from
 * every point that carried it rather than leaving a dangling id — see
 * `deleteGradeRule`. Sizes are still read-only here: the range itself
 * (adding, removing, reordering sizes) has no editor yet, which is a real gap
 * and not this file pretending there isn't one.
 *
 * TODO(grading-size-range): add size CRUD — a command shaped like the ones in
 * `gradeCommands.ts` (capture the prior `SizeRange`, undo restores it), plus
 * this list gaining the same inline-edit treatment the rule library has. Not
 * done here because every rule's increments are indexed by `sizeId`, so
 * removing a size has to decide what happens to every rule's entry for it —
 * a real design question, not a mechanical add.
 */
export const GradeContext = () => {
  const document = useDocumentStore((s) => s.document);
  const primary = useSelectionStore((s) => s.primary);
  const selectedPointIds = useSelectionStore((s) => s.selectedPointIds);
  const select = useSelectionStore((s) => s.select);

  const piece = primary ? findPiece(document, primary.pieceId) : undefined;
  const gradedPoints = piece?.points.filter((p) => p.gradeRuleId !== undefined) ?? [];

  return (
    <div className="stack">
      <CollapsibleSection title="Size range" caption={String(document.sizeRange.sizes.length)}>
        <ul className="list">
          {document.sizeRange.sizes.map((size) => (
            <li key={size.id}>
              <div className="list__row list__row--static">
                <span className="list__label">{size.label}</span>
                {size.id === document.sizeRange.baseSizeId ? (
                  <span className="badge" data-tone="ok">
                    base
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </CollapsibleSection>

      <CollapsibleSection
        title="Grade rules"
        caption={String(document.gradeRules.length)}
        action={
          <button
            type="button"
            className="icon-button"
            title="Add grade rule"
            onClick={() => {
              const draft = nextDraftGradeRuleName();
              createGradeRule(draft.code, draft.label);
            }}
          >
            <Icon name="plus" size={12} />
          </button>
        }
      >
        {document.gradeRules.length === 0 ? (
          <p className="muted">No grade rules yet.</p>
        ) : (
          <ul className="list">
            {document.gradeRules.map((rule) => (
              <li key={rule.id}>
                <div className="grade-rule-row">
                  <span className="grade-rule-row__code">
                    <TextInput
                      label={`Code for ${rule.label}`}
                      value={rule.code}
                      onCommit={(code) => renameGradeRule(rule.id, { code })}
                    />
                  </span>
                  <span className="grade-rule-row__label">
                    <TextInput
                      label={`Name for ${rule.code}`}
                      value={rule.label}
                      onCommit={(label) => renameGradeRule(rule.id, { label })}
                    />
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    title={`Delete ${rule.label} — unassigns it from every point that carries it`}
                    onClick={() => deleteGradeRule(rule.id)}
                  >
                    <Icon name="minus" size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Grade points"
        caption={piece ? String(gradedPoints.length) : '—'}
      >
        {!piece ? (
          <p className="muted">Select a piece to list its grade points.</p>
        ) : gradedPoints.length === 0 ? (
          <p className="muted">{piece.name} has no graded points.</p>
        ) : (
          <ul className="list">
            {gradedPoints.map((point) => {
              const rule = document.gradeRules.find((r) => r.id === point.gradeRuleId);
              return (
                <li key={point.id}>
                  <button
                    type="button"
                    className="list__row"
                    data-active={selectedPointIds.has(point.id) || undefined}
                    onClick={(event) => select(pointRef(piece.id, point.id), event.shiftKey)}
                  >
                    <Icon name="grade" size={12} />
                    <span className="list__label">{point.label ?? point.role}</span>
                    <span className="list__meta">{rule?.code ?? '—'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CollapsibleSection>
    </div>
  );
};
