/**
 * Thrown by adapters that are scaffolded but not implemented.
 *
 * A distinct error type rather than a bare `Error` so callers can tell "this
 * format cannot do this yet" apart from "this file is malformed", and surface
 * the two differently. Nothing in the codebase may return plausible-looking
 * data in place of a real conversion.
 */
export class FormatNotImplementedError extends Error {
  readonly formatLabel: string;
  readonly operation: 'import' | 'export';

  constructor(formatLabel: string, operation: 'import' | 'export', detail?: string) {
    super(
      `${formatLabel} ${operation} is not implemented yet` + (detail ? ` — ${detail}` : ''),
    );
    this.name = 'FormatNotImplementedError';
    this.formatLabel = formatLabel;
    this.operation = operation;
  }
}

/** Thrown when a payload is the right format but cannot be read. */
export class FormatParseError extends Error {
  readonly formatLabel: string;

  constructor(formatLabel: string, detail: string) {
    super(`${formatLabel}: ${detail}`);
    this.name = 'FormatParseError';
    this.formatLabel = formatLabel;
  }
}
