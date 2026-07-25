import { CollapsibleSection } from '@/components/CollapsibleSection';
import { Icon } from '@/components/Icon';
import { findPiece } from '@/pattern';
import { pointRef, useDocumentStore, useSelectionStore } from '@/store';

/**
 * Grade left panel: the size range, the rule library, and the graded points of
 * whichever piece is in context — so grade points are reachable from the list as
 * well as by picking them on the stage.
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

      <CollapsibleSection title="Grade rules" caption={String(document.gradeRules.length)}>
        <ul className="list">
          {document.gradeRules.map((rule) => (
            <li key={rule.id}>
              <div className="list__row list__row--static">
                <span className="tree__code">{rule.code}</span>
                <span className="list__label">{rule.label}</span>
              </div>
            </li>
          ))}
        </ul>
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
