import { PanelSection } from '@/components/PanelSection';
import { useDocumentStore } from '@/store';

export const PrepareContext = () => {
  const pieces = useDocumentStore((s) => s.document.pieces);

  return (
    <PanelSection title="Cut parts" caption={String(pieces.length)}>
      <ul className="list">
        {pieces.map((piece) => (
          <li key={piece.id}>
            <div className="list__row list__row--static">
              <span className="list__label">{piece.name}</span>
              <span className="list__meta">×1</span>
            </div>
          </li>
        ))}
      </ul>
    </PanelSection>
  );
};
