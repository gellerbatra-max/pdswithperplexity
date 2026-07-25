import { EmptyState, Field, Value } from '@/components/Field';
import { PanelSection } from '@/components/PanelSection';
import { boundarySegments, findSegment, type PatternPiece } from '@/pattern';

/** Seam, notch, grain and internal-line data — all read from the piece itself. */
export const ConstructionTab = ({ selected }: { selected: readonly PatternPiece[] }) => {
  const piece = selected.length === 1 ? selected[0] : undefined;

  if (!piece) {
    return (
      <EmptyState>
        {selected.length === 0
          ? 'Select a piece to inspect its construction.'
          : 'Select a single piece to inspect its construction.'}
      </EmptyState>
    );
  }

  const segments = boundarySegments(piece);

  return (
    <>
      <PanelSection title="Seam allowance">
        <Field label="Default">
          <Value value={piece.seamAllowance.toFixed(1)} unit="mm" />
        </Field>
        <table className="data-table">
          <thead>
            <tr>
              <th>Edge</th>
              <th className="num">SA</th>
              <th>Finish</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((segment) => (
              <tr key={segment.id}>
                <td>{segment.label ?? '—'}</td>
                <td className="num">
                  {(segment.seamAllowance ?? piece.seamAllowance).toFixed(1)}
                </td>
                <td className="dim">{segment.seamFinish ?? 'plain'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </PanelSection>

      <PanelSection title="Notches" caption={String(piece.notches.length)}>
        {piece.notches.length === 0 ? (
          <p className="muted">No notches placed.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Notch</th>
                <th>Edge</th>
                <th>Type</th>
                <th className="num">Pos</th>
              </tr>
            </thead>
            <tbody>
              {piece.notches.map((notch) => (
                <tr key={notch.id}>
                  <td>{notch.label ?? '—'}</td>
                  <td className="dim">
                    {findSegment(piece, notch.segmentId)?.label ?? '—'}
                  </td>
                  <td className="dim">{notch.kind}</td>
                  <td className="num">{Math.round(notch.t * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PanelSection>

      <PanelSection title="Internals">
        <Field label="Grain line">
          <Value
            value={piece.grainLine ? piece.grainLine.kind : 'none'}
            tone={piece.grainLine ? 'default' : 'muted'}
          />
        </Field>
        <Field label="Internal lines">
          <Value
            value={piece.internalLines.length}
            tone={piece.internalLines.length > 0 ? 'default' : 'muted'}
          />
        </Field>
        {piece.internalLines.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Line</th>
                <th>Role</th>
                <th>Cut</th>
              </tr>
            </thead>
            <tbody>
              {piece.internalLines.map((line) => (
                <tr key={line.id}>
                  <td>{line.label ?? '—'}</td>
                  <td className="dim">{line.role}</td>
                  <td className="dim">{line.cut ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </PanelSection>
    </>
  );
};
