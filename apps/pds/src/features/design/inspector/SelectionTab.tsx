import { EmptyState, Field, FieldRow, Pair, Toggle, Value } from '@/components/Field';
import { PanelSection } from '@/components/PanelSection';
import { BoundsOps } from '@/geometry';
import { findPoint, pieceBounds, type PatternPiece } from '@/pattern';
import { GeometryEdit } from './GeometryEdit';

export const SelectionTab = ({ selected }: { selected: readonly PatternPiece[] }) => {
  if (selected.length === 0) {
    return (
      <EmptyState>Nothing selected. Click a piece on the stage or in the piece tree.</EmptyState>
    );
  }

  const bounds = selected
    .map(pieceBounds)
    .filter((b) => !BoundsOps.isEmpty(b))
    .reduce(BoundsOps.union, BoundsOps.EMPTY_BOUNDS);

  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const single = selected.length === 1 ? selected[0] : undefined;

  const grainAngle = ((): string => {
    if (!single?.grainLine) return '—';
    const from = findPoint(single, single.grainLine.from);
    const to = findPoint(single, single.grainLine.to);
    if (!from || !to) return '—';
    const degrees =
      (Math.atan2(to.position.x - from.position.x, to.position.y - from.position.y) * 180) /
      Math.PI;
    return degrees.toFixed(1);
  })();

  return (
    <>
      {/* Sits first: when a point or edge is picked, that is what the user is
          working on, and the piece-level summary is context beneath it. */}
      <GeometryEdit pieces={selected} />

      <PanelSection title="Selection">
        <Field label="Type">
          <Value value={single ? 'Pattern piece' : `${selected.length} pattern pieces`} />
        </Field>
        {single ? (
          <Field label="Name">
            <Value value={single.name} />
          </Field>
        ) : null}
        <Field label="Count">
          <Value value={selected.length} />
        </Field>
      </PanelSection>

      <PanelSection title="Transform">
        <FieldRow>
          <Pair label="X" value={bounds.minX.toFixed(1)} unit="mm" />
          <Pair label="Y" value={bounds.minY.toFixed(1)} unit="mm" />
        </FieldRow>
        <FieldRow>
          <Pair label="W" value={width.toFixed(1)} unit="mm" />
          <Pair label="H" value={height.toFixed(1)} unit="mm" />
        </FieldRow>
        <FieldRow>
          <Pair label="Rotation" value="0.0" unit="°" />
          <Pair label="Grain" value={grainAngle} unit="°" />
        </FieldRow>
      </PanelSection>

      <PanelSection title="State">
        <Toggle label="Visible" on />
        <Toggle label="Locked" on={false} />
      </PanelSection>
    </>
  );
};
