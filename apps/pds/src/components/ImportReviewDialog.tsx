import { useEffect, useMemo, useRef } from 'react';
import { Dxf } from '@/io';
import { useImportStore } from '@/store';
import type { Severity } from '@/diagnostics';
import { compareSeverity, countBySeverity } from '@/diagnostics';

/**
 * The review step of the DXF import workflow.
 *
 * The importer's whole contract is that it accounts for everything it did —
 * what it imported, what it read without claiming meaning, what it skipped,
 * and where the file disagrees with the (unverified) layer table. This dialog
 * is that account, shown at the one moment it is actionable: before the
 * parsed document replaces the open one. Nothing here re-derives anything;
 * every row comes structured from `importDxfWithDiagnostics`.
 *
 * Closing is not discarding: a closed session stays inspectable (and, if
 * still unapplied, appliable) through the `file.import.dxf.report` command.
 */

const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'Blocking',
  warning: 'Warning',
  info: 'Note',
};

/** Short badge text per treatment; the full sentence is in the row title. */
const TREATMENT_BADGE: Record<Dxf.LayerTreatment, string> = {
  outline: 'outline',
  construction: 'kept, unclaimed',
  metadata: 'metadata',
  skipped: 'skipped',
};

const LayerRows = ({ layers }: { layers: readonly Dxf.LayerUsageRow[] }) => (
  <table className="import-layers" aria-label="Layer usage">
    <thead>
      <tr>
        <th scope="col">Layer</th>
        <th scope="col">Entities</th>
        <th scope="col">Treatment</th>
        <th scope="col">Layer table</th>
      </tr>
    </thead>
    <tbody>
      {layers.map((row) => (
        <tr key={`${row.layer} ${row.entity} ${row.treatment}`}>
          <td className="import-layers__layer">{row.layer}</td>
          <td>
            {row.entity}
            <span className="import-layers__count">×{row.count}</span>
          </td>
          <td title={Dxf.TREATMENT_LABEL[row.treatment]}>
            <span className="import-badge" data-treatment={row.treatment}>
              {TREATMENT_BADGE[row.treatment]}
            </span>
          </td>
          <td className="import-layers__table">
            {row.tableAgrees === null ? (
              <span className="import-badge" data-agree="unmapped">
                unmapped
              </span>
            ) : row.tableAgrees ? (
              <span className="import-layers__concept">{row.concept}</span>
            ) : (
              <span
                className="import-badge"
                data-agree="conflict"
                title={`The unverified layer table maps this layer to "${row.concept}", which does not list ${row.entity}. The table was not changed to match this file.`}
              >
                disagrees: {row.concept}
              </span>
            )}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const IssueList = ({ issues }: { issues: readonly Dxf.ConversionIssue[] }) => {
  const sorted = useMemo(
    // Stable within a severity: the importer's own order is the pipeline order.
    () => [...issues].sort((a, b) => compareSeverity(a.severity, b.severity)),
    [issues],
  );
  return (
    <ul className="import-issues" aria-label="Import diagnostics">
      {sorted.map((issue, index) => (
        <li key={index} className="import-issue" data-severity={issue.severity}>
          <span className="import-issue__dot" aria-hidden />
          <span className="import-issue__severity">{SEVERITY_LABEL[issue.severity]}</span>
          <span className="import-issue__message">{issue.message}</span>
        </li>
      ))}
    </ul>
  );
};

const Dialog = () => {
  const session = useImportStore((s) => s.session);
  const applySession = useImportStore((s) => s.applySession);
  const discardSession = useImportStore((s) => s.discardSession);
  const closeDialog = useImportStore((s) => s.closeDialog);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  // Same focus discipline as the command palette: capture, move in, restore.
  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => restoreRef.current?.focus?.();
  }, []);

  if (!session) return null;

  const counts = countBySeverity(session.issues);
  const blocked = Dxf.blocksConversion(session.issues);
  const pieces = session.document?.pieces.length ?? 0;
  const internalLines =
    session.document?.pieces.reduce((sum, piece) => sum + piece.internalLines.length, 0) ?? 0;

  return (
    <div className="palette-scrim" role="presentation" onClick={closeDialog}>
      <div
        ref={dialogRef}
        className="import-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`DXF import review — ${session.fileName}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            closeDialog();
          }
        }}
      >
        <header className="import-dialog__header">
          <div>
            <h2>{session.fileName}</h2>
            <p className="import-dialog__sub">
              {session.flavourLabel}
              {session.status === 'applied' ? ' · applied to the document' : null}
              {session.status === 'failed' ? ' · failed to parse' : null}
            </p>
          </div>
          <div className="import-dialog__counts">
            {counts.error > 0 ? <span data-severity="error">{counts.error} blocking</span> : null}
            {counts.warning > 0 ? (
              <span data-severity="warning">{counts.warning} warning{counts.warning === 1 ? '' : 's'}</span>
            ) : null}
            {counts.info > 0 ? <span data-severity="info">{counts.info} note{counts.info === 1 ? '' : 's'}</span> : null}
          </div>
        </header>

        <div className="import-dialog__body">
          {session.status === 'failed' ? (
            <section className="import-dialog__section">
              <h3>The file could not be parsed</h3>
              <p className="import-dialog__error">{session.error}</p>
              <p className="import-dialog__hint">
                Nothing was imported. The message above is the parser's own account of where the
                file's structure defeated it — there is no partial result to review.
              </p>
            </section>
          ) : (
            <>
              <section className="import-dialog__section">
                <h3>What would be imported</h3>
                <p className="import-dialog__summary">
                  {pieces} piece{pieces === 1 ? '' : 's'}
                  {internalLines > 0
                    ? `, ${internalLines} construction line${internalLines === 1 ? '' : 's'} (kept as geometry, meaning unclaimed)`
                    : ''}
                  {session.document ? ` — style “${session.document.name}”` : ''}
                </p>
              </section>

              <section className="import-dialog__section">
                <h3>How each layer was treated</h3>
                <LayerRows layers={session.layers} />
              </section>

              <section className="import-dialog__section">
                <h3>Diagnostics</h3>
                <IssueList issues={session.issues} />
              </section>
            </>
          )}
        </div>

        <footer className="import-dialog__footer">
          <button type="button" className="import-dialog__discard" onClick={discardSession}>
            {session.status === 'applied' ? 'Clear report' : 'Discard'}
          </button>
          <div className="import-dialog__footer-main">
            <button type="button" onClick={closeDialog}>
              Close
            </button>
            {session.status === 'reviewing' ? (
              <button
                type="button"
                className="import-dialog__apply"
                disabled={blocked}
                title={
                  blocked
                    ? 'Blocking issues above must be resolved in the source file — this importer does not guess past them.'
                    : undefined
                }
                onClick={applySession}
              >
                {blocked ? 'Blocked' : `Import ${pieces} piece${pieces === 1 ? '' : 's'}`}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
};

export const ImportReviewDialog = () => {
  const open = useImportStore((s) => s.dialogOpen);
  return open ? <Dialog /> : null;
};
