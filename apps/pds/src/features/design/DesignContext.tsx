import { PanelSection } from '@/components/PanelSection';
import { useDocumentStore } from '@/store';

/** Left panel: what is in the document. */
export const DesignContext = () => {
  const pieces = useDocumentStore((s) => s.document.pieces);
  const selectedPieceIds = useDocumentStore((s) => s.selectedPieceIds);
  const selectPiece = useDocumentStore((s) => s.selectPiece);

  return (
    <PanelSection title="Pieces" caption={String(pieces.length)}>
      <ul className="list">
        {pieces.map((piece) => (
          <li key={piece.id}>
            <button
              type="button"
              className="list__row"
              data-active={selectedPieceIds.has(piece.id) || undefined}
              onClick={(event) => selectPiece(piece.id, event.shiftKey)}
            >
              <span className="list__label">{piece.name}</span>
              <span className="list__meta">{piece.nodes.length}</span>
            </button>
          </li>
        ))}
      </ul>
    </PanelSection>
  );
};
