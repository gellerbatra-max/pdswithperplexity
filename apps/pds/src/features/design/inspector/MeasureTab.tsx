import { useMemo } from 'react';
import { PanelSection } from '@/components/PanelSection';
import { evaluateMeasurements } from '@/pattern';
import { useDocumentStore } from '@/store';

/**
 * Points of measure, derived from the document's measurement links rather than
 * typed in beside the pattern. Values that cannot be resolved show as "—" so a
 * missing link is visible instead of silently reading zero.
 */
export const MeasureTab = () => {
  const document = useDocumentStore((s) => s.document);
  const results = useMemo(() => evaluateMeasurements(document), [document]);

  const outOfTolerance = results.filter((r) => r.withinTolerance === false).length;
  const unlinked = results.filter((r) => r.measured === null).length;

  const caption =
    results.length === 0
      ? 'none linked'
      : outOfTolerance > 0
        ? `${outOfTolerance} out`
        : 'all in tolerance';

  return (
    <PanelSection title="Points of measure" caption={caption}>
      {results.length === 0 ? (
        <p className="muted">This document has no measurement links yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Measure</th>
              <th className="num">Patt.</th>
              <th className="num">Spec</th>
              <th className="num">Diff</th>
            </tr>
          </thead>
          <tbody>
            {results.map(({ link, measured, deviation, withinTolerance }) => (
              <tr key={link.id} data-flagged={withinTolerance === false || undefined}>
                <td>{link.label}</td>
                <td className="num">{measured === null ? '—' : Math.round(measured)}</td>
                <td className="num dim">{link.spec ?? '—'}</td>
                <td
                  className="num"
                  data-tone={
                    withinTolerance === null
                      ? undefined
                      : withinTolerance
                        ? 'positive'
                        : 'negative'
                  }
                >
                  {deviation === null
                    ? '—'
                    : `${deviation > 0 ? '+' : ''}${Math.round(deviation)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted table-note">
        Measured on the base size from linked geometry.
        {unlinked > 0 ? ` ${unlinked} not yet linked to geometry.` : ''}
      </p>
    </PanelSection>
  );
};
