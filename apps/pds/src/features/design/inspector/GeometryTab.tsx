import { EmptyState, Field, Value } from '@/components/Field';
import { PanelSection } from '@/components/PanelSection';
import { area } from '@/geometry';
import {
  boundarySegments,
  outlineLength,
  outlinePoints,
  segmentLength,
  type PatternPiece,
} from '@/pattern';

export const GeometryTab = ({ selected }: { selected: readonly PatternPiece[] }) => {
  const piece = selected.length === 1 ? selected[0] : undefined;

  if (!piece) {
    return (
      <EmptyState>
        {selected.length === 0
          ? 'Select a piece to inspect its geometry.'
          : 'Select a single piece to inspect its geometry.'}
      </EmptyState>
    );
  }

  const outline = piece.points.filter((p) => p.role !== 'construction');
  const corners = outline.filter((p) => p.role === 'corner').length;
  const curves = outline.filter((p) => p.role === 'curve').length;
  const construction = piece.points.length - outline.length;
  const segments = boundarySegments(piece);
  const curveSegments = segments.filter((s) => s.geometry.kind !== 'line').length;

  return (
    <>
      <PanelSection title="Outline">
        <Field label="Path">
          <Value value={piece.closed ? 'Closed' : 'Open'} />
        </Field>
        <Field label="Segments">
          <Value value={segments.length} />
        </Field>
        <Field label="Curved">
          <Value value={`${curveSegments} of ${segments.length}`} />
        </Field>
        <Field label="Perimeter">
          <Value value={outlineLength(piece).toFixed(1)} unit="mm" />
        </Field>
        <Field label="Area">
          <Value value={(area(outlinePoints(piece)) / 100).toFixed(1)} unit="cm²" />
        </Field>
      </PanelSection>

      <PanelSection title="Points" caption={String(piece.points.length)}>
        <Field label="Corner">
          <Value value={corners} />
        </Field>
        <Field label="Curve">
          <Value value={curves} />
        </Field>
        <Field label="Construction">
          <Value value={construction} tone="muted" />
        </Field>
      </PanelSection>

      <PanelSection title="Segments">
        <table className="data-table">
          <thead>
            <tr>
              <th>Edge</th>
              <th>Type</th>
              <th className="num">Length</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((segment) => (
              <tr key={segment.id}>
                <td>{segment.label ?? '—'}</td>
                <td className="dim">{segment.geometry.kind}</td>
                <td className="num">{segmentLength(piece, segment).toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PanelSection>

      <PanelSection title="Point list">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Role</th>
              <th className="num">X</th>
              <th className="num">Y</th>
            </tr>
          </thead>
          <tbody>
            {piece.points.map((point, index) => (
              <tr key={point.id}>
                <td className="dim">{index + 1}</td>
                <td>{point.label ?? point.role}</td>
                <td className="num">{point.position.x.toFixed(1)}</td>
                <td className="num">{point.position.y.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PanelSection>
    </>
  );
};
