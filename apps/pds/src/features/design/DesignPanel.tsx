import { PanelSection } from '@/components/PanelSection';
import { formatLength } from '@/geometry';
import { useDocumentStore } from '@/store';

/** Right inspector: properties of the current selection. */
export const DesignPanel = () => {
  const document = useDocumentStore((s) => s.document);
  const selectedPieceIds = useDocumentStore((s) => s.selectedPieceIds);

  const selected = document.pieces.filter((p) => selectedPieceIds.has(p.id));

  if (selected.length === 0) {
    return (
      <PanelSection title="Properties">
        <p className="muted">Select a piece to edit its properties.</p>
      </PanelSection>
    );
  }

  return (
    <>
      {selected.map((piece) => (
        <PanelSection key={piece.id} title={piece.name}>
          <dl className="props">
            <dt>Outline</dt>
            <dd>{piece.closed ? 'Closed' : 'Open'}</dd>
            <dt>Nodes</dt>
            <dd>{piece.nodes.length}</dd>
            <dt>Seam allowance</dt>
            <dd>{formatLength(piece.seamAllowance, document.unit)}</dd>
          </dl>
        </PanelSection>
      ))}
    </>
  );
};
