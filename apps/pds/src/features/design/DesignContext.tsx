import { CollapsibleSection } from '@/components/CollapsibleSection';
import { useDocumentStore, useHistoryStore } from '@/store';
import { BlockLibrary } from './panels/BlockLibrary';
import { HistoryList } from './panels/HistoryList';
import { LayerList } from './panels/LayerList';
import { PieceTree } from './panels/PieceTree';
import { BLOCKS } from './mockData';

/**
 * Design left panel — what exists in the document, stacked as collapsible
 * sections so all four fit one dense column.
 */
export const DesignContext = () => {
  const pieceCount = useDocumentStore((s) => s.document.pieces.length);
  // Counts every row the list renders — undone entries included, since they are
  // still on the stack and still shown.
  const historyCount = useHistoryStore((s) => s.past.length + s.future.length);

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

      <CollapsibleSection title="History" caption={String(historyCount)} defaultOpen={false}>
        <HistoryList />
      </CollapsibleSection>
    </div>
  );
};
