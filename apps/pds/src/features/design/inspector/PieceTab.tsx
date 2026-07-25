import { EmptyState, Field, Toggle, Value } from '@/components/Field';
import { PanelSection } from '@/components/PanelSection';
import type { PatternPiece } from '@/pattern';
import { useDocumentStore } from '@/store';

export const PieceTab = ({ selected }: { selected: readonly PatternPiece[] }) => {
  const style = useDocumentStore((s) => s.document.style);
  const sizeRange = useDocumentStore((s) => s.document.sizeRange);
  const piece = selected.length === 1 ? selected[0] : undefined;

  const baseSize = sizeRange.sizes.find((size) => size.id === sizeRange.baseSizeId);

  if (!piece) {
    return (
      <EmptyState>
        {selected.length === 0
          ? 'Select a piece to edit its production data.'
          : 'Select a single piece to edit its production data.'}
      </EmptyState>
    );
  }

  return (
    <>
      <PanelSection title="Identity">
        <Field label="Name">
          <Value value={piece.name} />
        </Field>
        <Field label="Code">
          <Value value={piece.meta.code} />
        </Field>
        <Field label="Style">
          <Value value={style.code} />
        </Field>
        <Field label="Base size">
          <Value value={baseSize?.label ?? '—'} />
        </Field>
      </PanelSection>

      <PanelSection title="Material">
        <Field label="Category">
          <Value value={piece.meta.category} />
        </Field>
        <Field label="Fabric" wide>
          <Value value={piece.meta.fabric} />
        </Field>
      </PanelSection>

      <PanelSection title="Cutting">
        <Field label="Quantity">
          <Value value={`×${piece.meta.quantity}`} />
        </Field>
        <Field label="Seam allow.">
          <Value value={piece.seamAllowance.toFixed(1)} unit="mm" />
        </Field>
        <Toggle label="Cut on fold" on={piece.meta.onFold} />
        <Toggle label="Mirrored pair" on={piece.meta.mirrored} />
      </PanelSection>

      {piece.meta.description ? (
        <PanelSection title="Notes">
          <p className="muted">{piece.meta.description}</p>
        </PanelSection>
      ) : null}
    </>
  );
};
