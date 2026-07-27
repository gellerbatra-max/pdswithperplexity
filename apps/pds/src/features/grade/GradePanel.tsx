import { AiSuggestions } from '@/components/AiSuggestions';
import { EmptyState, Field, NumberInput, Value } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { PanelSection } from '@/components/PanelSection';
import { SEVERITY_ICON } from './severity';
import {
  findPiece,
  findPoint,
  findIncrement,
  gradeDiagnostics,
  type GradeDiagnostic,
  type PatternPiece,
  type PointId,
} from '@/pattern';
import { setGradeIncrement, setPointsGradeRule, useDocumentStore, useSelectionStore } from '@/store';

/** True when a diagnostic's segment has this point as one of its ends. */
const touchesPoint = (diagnostic: GradeDiagnostic, piece: PatternPiece, pointId: PointId): boolean => {
  if (!diagnostic.segmentId) return false;
  const segment = piece.segments.find((s) => s.id === diagnostic.segmentId);
  return segment !== undefined && (segment.from === pointId || segment.to === pointId);
};

/**
 * Grade inspector, bound to the shared selection.
 *
 * A point selection is a real editor: the rule dropdown assigns or clears a
 * point's grade rule, and once one is assigned its increment table is
 * editable per size (the base size stays fixed at zero — see
 * `setGradeIncrement`). A piece selection summarises how much of the piece is
 * graded. Both show `gradeDiagnostics`, computed from the actual graded
 * geometry — not a hand-written list standing in for a checker that does not
 * exist yet.
 */
export const GradePanel = () => {
  const document = useDocumentStore((s) => s.document);
  const primary = useSelectionStore((s) => s.primary);

  if (!primary) {
    return (
      <EmptyState>
        Select a grade point on the stage, or a piece, to inspect its grading.
      </EmptyState>
    );
  }

  const piece = findPiece(document, primary.pieceId);
  if (!piece) return <EmptyState>Selection no longer resolves.</EmptyState>;

  /* --- Piece selected: summarise coverage --- */
  if (primary.kind === 'piece') {
    const graded = piece.points.filter((p) => p.gradeRuleId !== undefined);
    const outline = piece.points.filter((p) => p.role !== 'construction');
    const rules = new Set(graded.map((p) => p.gradeRuleId));
    const diagnostics = gradeDiagnostics(document, piece.id);

    return (
      <>
        <PanelSection title="Grading" caption={piece.meta.code}>
          <Field label="Piece">
            <Value value={piece.name} />
          </Field>
          <Field label="Graded pts">
            <Value value={`${graded.length} of ${outline.length}`} />
          </Field>
          <Field label="Rules used">
            <Value value={rules.size} />
          </Field>
          <p className="muted table-note">
            Select an individual point to see its per-size movement.
          </p>
        </PanelSection>
        <DiagnosticsSection diagnostics={diagnostics} />
        <AiSuggestions />
      </>
    );
  }

  // Grade never offers segments as a selectable kind, but a segment selected in
  // Design survives a workspace switch — so this panel has to say something
  // rather than resolve a point id the ref does not carry.
  if (primary.kind === 'segment') {
    return <EmptyState>Select a grade point or a piece to inspect its grading.</EmptyState>;
  }

  /* --- Point selected: assign a rule and edit its per-size increments --- */
  const point = findPoint(piece, primary.pointId);
  if (!point) return <EmptyState>Selection no longer resolves.</EmptyState>;

  const rule = point.gradeRuleId
    ? document.gradeRules.find((r) => r.id === point.gradeRuleId)
    : undefined;

  const diagnostics = [...gradeDiagnostics(document, piece.id)].sort(
    (a, b) => Number(touchesPoint(b, piece, point.id)) - Number(touchesPoint(a, piece, point.id)),
  );

  return (
    <>
      <PanelSection title="Grade point">
        <Field label="Piece">
          <Value value={piece.name} />
        </Field>
        <Field label="Point">
          <Value value={point.label ?? point.role} />
        </Field>
        <Field label="X">
          <Value value={point.position.x.toFixed(1)} unit="mm" />
        </Field>
        <Field label="Y">
          <Value value={point.position.y.toFixed(1)} unit="mm" />
        </Field>
        <Field label="Rule">
          <select
            aria-label="Grade rule"
            className="value value--editable"
            value={point.gradeRuleId ?? ''}
            onChange={(event) => {
              const value = event.target.value;
              setPointsGradeRule(piece.id, [point.id], value === '' ? undefined : value);
            }}
          >
            <option value="">— none, holds base position —</option>
            {document.gradeRules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} · {r.label}
              </option>
            ))}
          </select>
        </Field>
      </PanelSection>

      <PanelSection title="Grade rule" caption={rule ? rule.code : 'none'}>
        {!rule ? (
          <p className="muted">
            This point is not graded. It holds its base position across the size range.
          </p>
        ) : (
          <>
            <p className="muted table-note">
              Editing this rule changes every point that carries it, on any piece.
            </p>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Size</th>
                  <th className="num">ΔX</th>
                  <th className="num">ΔY</th>
                </tr>
              </thead>
              <tbody>
                {document.sizeRange.sizes.map((size) => {
                  const increment = findIncrement(rule, size.id);
                  const isBase = size.id === document.sizeRange.baseSizeId;
                  return (
                    <tr key={size.id} data-flagged={isBase || undefined}>
                      <td>
                        {size.label}
                        {isBase ? ' (base)' : ''}
                      </td>
                      <td className="num">
                        {isBase ? (
                          <Value value="0.0" tone="muted" />
                        ) : (
                          <NumberInput
                            label={`${size.label} X increment`}
                            value={increment?.dx ?? 0}
                            step={0.5}
                            onCommit={(dx) =>
                              setGradeIncrement(rule.id, size.id, dx, increment?.dy ?? 0)
                            }
                          />
                        )}
                      </td>
                      <td className="num">
                        {isBase ? (
                          <Value value="0.0" tone="muted" />
                        ) : (
                          <NumberInput
                            label={`${size.label} Y increment`}
                            value={increment?.dy ?? 0}
                            step={0.5}
                            onCommit={(dy) =>
                              setGradeIncrement(rule.id, size.id, increment?.dx ?? 0, dy)
                            }
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </PanelSection>

      <DiagnosticsSection diagnostics={diagnostics} />
      <AiSuggestions />
    </>
  );
};

/**
 * Real grading findings, computed by `gradeDiagnostics` from the graded
 * geometry — an arc whose radius couldn't hold, or a mated seam that drifts
 * apart across the range. Empty means the checker ran and found nothing, not
 * that nothing has been checked.
 */
const DiagnosticsSection = ({ diagnostics }: { diagnostics: readonly GradeDiagnostic[] }) => (
  <PanelSection title="Anomalies" caption={String(diagnostics.length)}>
    {diagnostics.length === 0 ? (
      <p className="muted">Nothing flagged on this piece.</p>
    ) : (
      <ul className="chips chips--stacked">
        {diagnostics.map((diagnostic) => (
          <li key={diagnostic.id}>
            <span className="chip" data-severity={diagnostic.severity}>
              <Icon name={SEVERITY_ICON[diagnostic.severity]} size={11} />
              {diagnostic.label}
            </span>
            <p className="chip__detail">{diagnostic.detail}</p>
          </li>
        ))}
      </ul>
    )}
    <p className="muted table-note">
      Checks an arc's radius against the endpoints it grades to, and mated seams
      against each other, at every size but the base.
    </p>
  </PanelSection>
);
