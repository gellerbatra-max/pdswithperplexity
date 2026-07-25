import { CollapsibleSection } from '@/components/CollapsibleSection';
import { useDocumentStore } from '@/store';
import { BlockLibrary } from './panels/BlockLibrary';
import { HistoryList } from './panels/HistoryList';
import { LayerList } from './panels/LayerList';
import { PieceTree } from './panels/PieceTree';
import { BLOCKS, HISTORY } from './mockData';

/**
 * Design left panel — what exists in the document, stacked as collapsible
 * sections so all four fit one dense column.
 */
export const DesignContext = () => {
  const pieceCount = useDocumentStore((s) => s.document.pieces.length);

  return (
    <div className="stack">
      <CollapsibleSection title="Piece Tree" caption={String(pieceCount)}>
        <PieceTree />
      </CollapsibleSection>

      <CollapsibleSection title="Block Library" caption={String(BLOCKS.length)} defaultOpen={false}>
        <BlockLibrary />
      </CollapsibleSection>

      <CollapsibleSection title="Layers">
        <LayerList />
      </CollapsibleSection>

      <CollapsibleSection title="History" caption={String(HISTORY.length)} defaultOpen={false}>
        <HistoryList />
      </CollapsibleSection>
    </div>
  );
};
