import { Icon } from '@/components/Icon';
import type { PatternPiece, PieceCategory } from '@/pattern';
import { pieceRef, useDocumentStore, useSelectionStore } from '@/store';

const GROUP_LABELS: Record<PieceCategory, string> = {
  shell: 'Shell',
  lining: 'Lining',
  interlining: 'Interlining',
  trim: 'Trim',
};

const GROUP_ORDER: readonly PieceCategory[] = ['shell', 'lining', 'interlining', 'trim'];

/** Pieces grouped by cut category — the document's structure, not a flat list. */
export const PieceTree = () => {
  const pieces = useDocumentStore((s) => s.document.pieces);
  const selectedPieceIds = useSelectionStore((s) => s.selectedPieceIds);
  const select = useSelectionStore((s) => s.select);

  const groups = GROUP_ORDER.map((category) => ({
    category,
    items: pieces.filter((p) => p.meta.category === category),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="tree">
      {groups.map((group) => (
        <div className="tree__group" key={group.category}>
          <div className="tree__group-header">
            <Icon name="folder" size={12} />
            <span>{GROUP_LABELS[group.category]}</span>
            <span className="tree__count">{group.items.length}</span>
          </div>
          {group.items.map((piece: PatternPiece) => {
            const selected = selectedPieceIds.has(piece.id);
            return (
              <button
                key={piece.id}
                type="button"
                className="tree__row"
                data-active={selected || undefined}
                onClick={(event) =>
                  select(pieceRef(piece.id), event.shiftKey || event.metaKey)
                }
              >
                <Icon name="piece" size={13} />
                <span className="tree__name">{piece.name}</span>
                <span className="tree__code">{piece.meta.code}</span>
                <span className="tree__qty">×{piece.meta.quantity}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
};
