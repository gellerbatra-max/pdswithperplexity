import { EmptyState, Field, NumberInput, TextInput, Toggle, Value } from '@/components/Field';
import { PanelSection } from '@/components/PanelSection';
import type { PatternPiece } from '@/pattern';
import { renamePiece, updatePiece, updatePieceMeta, useDocumentStore } from '@/store';

/**
 * Piece identity and production data.
 *
 * Every editable field writes through a command in `store/documentCommands.ts`,
 * so each edit is undoable and each one replaces the whole piece rather than
 * patching it. Fields that are derived from elsewhere in the document — style
 * code, base size — stay read-only, as does category, which has no editor yet.
 *
 * Text and number fields coalesce per piece and per field, so a typing burst
 * collapses into one undo step instead of one per keystroke.
 */
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

  const id = piece.id;

  return (
    <>
      <PanelSection title="Identity">
        <Field label="Name">
          <TextInput
            label="Piece name"
            value={piece.name}
            onCommit={(name) => renamePiece(id, name)}
          />
        </Field>
        <Field label="Code">
          <TextInput
            label="Piece code"
            value={piece.meta.code}
            onCommit={(code) =>
              updatePieceMeta(id, { code }, {
                label: 'Change piece code',
                detail: `${piece.name} · ${piece.meta.code} → ${code}`,
                coalesceKey: `piece-code:${id}`,
              })
            }
          />
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
          <TextInput
            label="Fabric"
            value={piece.meta.fabric}
            onCommit={(fabric) =>
              updatePieceMeta(id, { fabric }, {
                label: 'Change fabric',
                detail: `${piece.name} · ${fabric}`,
                coalesceKey: `piece-fabric:${id}`,
              })
            }
          />
        </Field>
      </PanelSection>

      <PanelSection title="Cutting">
        <Field label="Quantity">
          <NumberInput
            label="Cut quantity"
            value={piece.meta.quantity}
            min={1}
            step={1}
            onCommit={(quantity) =>
              updatePieceMeta(id, { quantity }, {
                label: 'Change cut quantity',
                detail: `${piece.name} · ×${piece.meta.quantity} → ×${quantity}`,
                coalesceKey: `piece-quantity:${id}`,
              })
            }
          />
        </Field>
        <Field label="Seam allow.">
          <NumberInput
            label="Seam allowance"
            value={piece.seamAllowance}
            unit="mm"
            min={0}
            step={1}
            onCommit={(seamAllowance) =>
              updatePiece(id, { seamAllowance }, {
                label: 'Change seam allowance',
                detail: `${piece.name} · ${piece.seamAllowance}mm → ${seamAllowance}mm`,
                coalesceKey: `piece-seam-allowance:${id}`,
              })
            }
          />
        </Field>
        <Toggle
          label="Cut on fold"
          on={piece.meta.onFold}
          onChange={(onFold) =>
            updatePieceMeta(id, { onFold }, {
              label: onFold ? 'Set cut on fold' : 'Clear cut on fold',
              detail: piece.name,
            })
          }
        />
        <Toggle
          label="Mirrored pair"
          on={piece.meta.mirrored}
          onChange={(mirrored) =>
            updatePieceMeta(id, { mirrored }, {
              label: mirrored ? 'Set mirrored pair' : 'Clear mirrored pair',
              detail: piece.name,
            })
          }
        />
      </PanelSection>

      {piece.meta.description ? (
        <PanelSection title="Notes">
          <p className="muted">{piece.meta.description}</p>
        </PanelSection>
      ) : null}
    </>
  );
};
