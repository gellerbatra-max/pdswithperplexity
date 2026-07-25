import { EmptyState, Field, Value } from '@/components/Field';
import { PanelSection } from '@/components/PanelSection';
import { findPiece, findPoint, findIncrement } from '@/pattern';
import { useDocumentStore, useSelectionStore } from '@/store';
import { anomaliesFor } from './mockData';

/**
 * Grade inspector, bound to the shared selection.
 *
 * A point selection shows that point's grade rule and its per-size movement;
 * a piece selection summarises how much of the piece is graded.
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

    return (
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
    );
  }

  /* --- Point selected: show its rule and increments --- */
  const point = findPoint(piece, primary.pointId);
  if (!point) return <EmptyState>Selection no longer resolves.</EmptyState>;

  const rule = point.gradeRuleId
    ? document.gradeRules.find((r) => r.id === point.gradeRuleId)
    : undefined;

  const anomalies = anomaliesFor(piece.id, point.id);

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
      </PanelSection>

      <PanelSection title="Grade rule" caption={rule ? rule.code : 'none'}>
        {!rule ? (
          <p className="muted">
            This point is not graded. It holds its base position across the size range.
          </p>
        ) : (
          <>
            <Field label="Rule">
              <Value value={rule.label} />
            </Field>
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
                      <td className="num">{increment ? increment.dx.toFixed(1) : '—'}</td>
                      <td className="num">{increment ? increment.dy.toFixed(1) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </PanelSection>

      <PanelSection title="Anomalies" caption={String(anomalies.length)}>
        {anomalies.length === 0 ? (
          <p className="muted">Nothing flagged on this piece.</p>
        ) : (
          <ul className="chips chips--stacked">
            {anomalies.map((anomaly) => (
              <li key={anomaly.id}>
                <span
                  className="chip"
                  data-severity={anomaly.severity}
                  data-scoped={anomaly.pointId === point.id || undefined}
                >
                  {anomaly.label}
                </span>
                <p className="chip__detail">{anomaly.detail}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="muted table-note">
          Placeholder checks — the nest is not analysed yet.
        </p>
      </PanelSection>
    </>
  );
};
