import { Icon, type IconName } from '@/components/Icon';
import { findPiece, findPoint, pointDelta } from '@/pattern';
import { useDocumentStore, useGradeStore, useSelectionStore } from '@/store';
import type { Severity } from '@/diagnostics';
import { anomaliesFor } from './mockData';

const SEVERITY_ICON: Record<Severity, IconName> = {
  error: 'review',
  warning: 'grade',
  info: 'clock',
};

/**
 * Bottom drawer: the size progression on the left, anomaly chips on the right.
 *
 * Both halves follow the shared selection. With a grade point selected the
 * progression shows that point's movement per size; with only a piece selected
 * it falls back to how many of its points each size moves. Clicking a size cell
 * sets the active size, which the nest overlay highlights on the stage — so the
 * drawer drives the canvas as well as reflecting it.
 */
export const GradeDrawer = () => {
  const document = useDocumentStore((s) => s.document);
  const primary = useSelectionStore((s) => s.primary);
  const activeSizeId = useGradeStore((s) => s.activeSizeId);
  const setActiveSize = useGradeStore((s) => s.setActiveSize);
  const nestVisible = useGradeStore((s) => s.nestVisible);
  const toggleNest = useGradeStore((s) => s.toggleNest);
  const vectorsVisible = useGradeStore((s) => s.vectorsVisible);
  const toggleVectors = useGradeStore((s) => s.toggleVectors);

  const piece = primary ? findPiece(document, primary.pieceId) : undefined;
  const point =
    piece && primary?.kind === 'point' ? findPoint(piece, primary.pointId) : undefined;

  const sizes = [...document.sizeRange.sizes].sort((a, b) => a.order - b.order);
  const anomalies = anomaliesFor(piece?.id ?? null, point?.id ?? null);

  const subject = point
    ? `${piece?.name ?? ''} · ${point.label ?? point.role}`
    : (piece?.name ?? 'No selection');

  return (
    <div className="drawer">
      <section className="drawer__section drawer__section--progression">
        <header className="drawer__header">
          <h3>Progression</h3>
          <span className="drawer__subject">{subject}</span>
          <div className="drawer__toggles">
            <button
              type="button"
              data-active={nestVisible || undefined}
              onClick={toggleNest}
              title="Show the nested size stack"
            >
              Nest
            </button>
            <button
              type="button"
              data-active={vectorsVisible || undefined}
              onClick={toggleVectors}
              title="Show grade movement arrows"
            >
              Vectors
            </button>
          </div>
        </header>

        <ol className="progression">
          {sizes.map((size) => {
            const isBase = size.id === document.sizeRange.baseSizeId;
            const isActive = size.id === activeSizeId;

            const delta = point ? pointDelta(point, document.gradeRules, size.id) : null;
            const movedPoints = piece
              ? piece.points.filter((p) => {
                  const d = pointDelta(p, document.gradeRules, size.id);
                  return d.dx !== 0 || d.dy !== 0;
                }).length
              : 0;

            return (
              <li key={size.id}>
                <button
                  type="button"
                  className="progression__cell"
                  data-active={isActive || undefined}
                  data-base={isBase || undefined}
                  onClick={() => setActiveSize(isActive ? null : size.id)}
                  title={isActive ? 'Clear active size' : `Focus size ${size.label}`}
                >
                  <span className="progression__size">
                    {size.label}
                    {isBase ? <span className="progression__base">base</span> : null}
                  </span>
                  {delta ? (
                    <span className="progression__delta">
                      {delta.dx >= 0 ? '+' : ''}
                      {delta.dx.toFixed(1)}
                      {' / '}
                      {delta.dy >= 0 ? '+' : ''}
                      {delta.dy.toFixed(1)}
                    </span>
                  ) : (
                    <span className="progression__delta progression__delta--muted">
                      {piece ? `${movedPoints} pts` : '—'}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="drawer__section drawer__section--anomalies">
        <header className="drawer__header">
          <h3>Anomalies</h3>
          <span className="badge" data-tone="muted">
            {anomalies.length}
          </span>
        </header>

        {anomalies.length === 0 ? (
          <p className="muted">No anomalies for this selection.</p>
        ) : (
          <ul className="chips">
            {anomalies.map((anomaly) => (
              <li key={anomaly.id}>
                <span
                  className="chip"
                  data-severity={anomaly.severity}
                  data-scoped={anomaly.pointId === point?.id || undefined}
                  title={anomaly.detail}
                >
                  <Icon name={SEVERITY_ICON[anomaly.severity]} size={11} />
                  {anomaly.label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
