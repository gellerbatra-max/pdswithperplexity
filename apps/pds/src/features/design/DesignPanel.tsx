import { useState } from 'react';
import { useDocumentStore } from '@/store';
import { AiTab } from './inspector/AiTab';
import { ConstructionTab } from './inspector/ConstructionTab';
import { GeometryTab } from './inspector/GeometryTab';
import { MeasureTab } from './inspector/MeasureTab';
import { PieceTab } from './inspector/PieceTab';
import { SelectionTab } from './inspector/SelectionTab';

type TabId = 'selection' | 'geometry' | 'piece' | 'construction' | 'measure' | 'ai';

interface TabDescriptor {
  readonly id: TabId;
  readonly label: string;
  readonly title: string;
}

const TABS: readonly TabDescriptor[] = [
  { id: 'selection', label: 'Selection', title: 'Selection' },
  { id: 'geometry', label: 'Geometry', title: 'Geometry' },
  { id: 'piece', label: 'Piece', title: 'Piece' },
  { id: 'construction', label: 'Constr.', title: 'Construction' },
  { id: 'measure', label: 'Measure', title: 'Measure' },
  { id: 'ai', label: 'AI', title: 'AI Suggestions' },
];

/** Design right inspector — six tabs over the current selection. */
export const DesignPanel = () => {
  const [tab, setTab] = useState<TabId>('selection');

  const pieces = useDocumentStore((s) => s.document.pieces);
  const selectedPieceIds = useDocumentStore((s) => s.selectedPieceIds);
  const selected = pieces.filter((p) => selectedPieceIds.has(p.id));

  return (
    <div className="tabs">
      <div className="tabs__strip" role="tablist" aria-label="Inspector sections">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            className="tabs__tab"
            aria-selected={tab === entry.id}
            data-active={tab === entry.id || undefined}
            title={entry.title}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="tabs__body" role="tabpanel">
        {tab === 'selection' ? <SelectionTab selected={selected} /> : null}
        {tab === 'geometry' ? <GeometryTab selected={selected} /> : null}
        {tab === 'piece' ? <PieceTab selected={selected} /> : null}
        {tab === 'construction' ? <ConstructionTab selected={selected} /> : null}
        {tab === 'measure' ? <MeasureTab /> : null}
        {tab === 'ai' ? <AiTab /> : null}
      </div>
    </div>
  );
};
