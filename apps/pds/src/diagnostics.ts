/**
 * Shared diagnostic vocabulary.
 *
 * Three subsystems report findings about a pattern and will keep multiplying:
 * grading anomalies, DXF conversion issues, and — when Review lands — check
 * results and revision diffs. They had begun declaring the same severity union
 * separately, which is how two of them end up disagreeing about what "warning"
 * means and how the UI ends up with three chip styles.
 *
 * This file is intentionally tiny and dependency-free so any layer can import it
 * without dragging anything along.
 */

export type Severity = 'error' | 'warning' | 'info';

/** Ordered most severe first, for sorting and for picking a summary severity. */
export const SEVERITY_ORDER: readonly Severity[] = ['error', 'warning', 'info'];

export const compareSeverity = (a: Severity, b: Severity): number =>
  SEVERITY_ORDER.indexOf(a) - SEVERITY_ORDER.indexOf(b);

/**
 * The shape every reporter should converge on. Grade anomalies and DXF issues
 * each still carry their own extra fields; this is the common core the Review
 * workspace can render without knowing which subsystem produced it.
 */
export interface Diagnostic {
  readonly id: string;
  readonly severity: Severity;
  /** Short, imperative or declarative — fits on a chip. */
  readonly label: string;
  /** The full explanation. */
  readonly detail: string;
  /** Machine-readable kind, for grouping and for suppression rules later. */
  readonly code?: string;
}

export const countBySeverity = (
  diagnostics: readonly { readonly severity: Severity }[],
): Record<Severity, number> => ({
  error: diagnostics.filter((d) => d.severity === 'error').length,
  warning: diagnostics.filter((d) => d.severity === 'warning').length,
  info: diagnostics.filter((d) => d.severity === 'info').length,
});

export const highestSeverity = (
  diagnostics: readonly { readonly severity: Severity }[],
): Severity | null => {
  for (const severity of SEVERITY_ORDER) {
    if (diagnostics.some((d) => d.severity === severity)) return severity;
  }
  return null;
};
