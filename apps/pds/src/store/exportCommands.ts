import { Dxf, exportDocument } from '@/io';
import type { PatternDocument } from '@/pattern';
import { useDocumentStore } from './documentStore';
import { useUiStore } from './uiStore';

/**
 * Getting a finished file out of the app.
 *
 * The counterpart to `importStore.ts`'s file picker, and it lives here for the
 * same reason: this is the one place that touches the browser's download
 * machinery, and `io/` stays a pure format layer that a Node check script can
 * import without a DOM.
 *
 * The split inside this file matters too. `exportFileName` is pure and tested;
 * `saveTextFile` is the six lines that cannot be tested outside a browser, and
 * it is deliberately dumb — it takes bytes someone else produced and does
 * nothing to them. Nothing in the download path may transform what the writer
 * wrote, which is a property the export suite asserts directly rather than
 * trusting to review.
 */

/**
 * Characters no mainstream filesystem will take. Windows is the strictest of
 * the three and sets this list; the control range is in there because a
 * document name can hold a newline and a filename cannot.
 */
// eslint-disable-next-line no-control-regex
const ILLEGAL_IN_FILENAME = /[<>:"/\\|?*\x00-\x1f]/g;

/** Windows reserves these regardless of extension. */
const RESERVED_NAMES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/** Long enough for any real style code, short of every filesystem's limit. */
const MAX_STEM = 80;

/**
 * A deterministic filename for `document`.
 *
 * Deterministic on purpose: the same document exports to the same name every
 * time, so a second export overwrites the first rather than littering a
 * downloads folder with `style (3).dxf`. No timestamp, no counter — if the
 * user wants versions they can rename, and the alternative silently hides
 * that two exports differ.
 *
 * The style code wins over the document name because that is what downstream
 * systems key on; the name is the human label and only used when there is no
 * code.
 */
export const exportFileName = (document: PatternDocument, extension: string): string => {
  const preferred = document.style.code.trim() || document.name.trim() || 'pattern';
  const stem =
    preferred
      .replace(ILLEGAL_IN_FILENAME, '-')
      // Collapse whitespace and separator runs so a name like "8178V  -  SP27"
      // does not export as "8178V----SP27".
      .replace(/\s+/g, '-')
      .replace(/-{2,}/g, '-')
      // Leading dots hide the file on Unix; trailing dots and spaces are
      // silently stripped by Windows, which would break the "same document,
      // same name" promise.
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, MAX_STEM) || 'pattern';

  const safe = RESERVED_NAMES.has(stem.toLowerCase()) ? `${stem}-pattern` : stem;
  return `${safe}${extension}`;
};

/**
 * Hands `text` to the browser as a download. The only DOM in this file.
 *
 * The object URL is revoked on the next turn rather than immediately: some
 * browsers abort the download if the URL dies in the same tick as the click.
 */
const saveTextFile = (fileName: string, text: string, mimeType: string): void => {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/** What an export attempt did, so a caller can report it without re-deriving it. */
export interface ExportOutcome {
  readonly saved: boolean;
  readonly fileName: string;
  /** UTF-8 bytes, matching what lands on disk — not JS string length. */
  readonly bytes: number;
  readonly message: string;
}

/**
 * The size the file will actually be. `String.length` counts UTF-16 code
 * units, which undercounts any character outside the BMP's first byte — a
 * piece name with an accent in it would be reported short.
 */
const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/**
 * Writes the open document as DXF and downloads it.
 *
 * Refuses exactly when the writer refuses — the validation gate is not
 * re-implemented here, it is asked. A refusal reports why rather than
 * producing a file that a cutting room would trust.
 */
export const downloadDxf = (): ExportOutcome => {
  // Not named `document`: this file also needs the DOM's `document`, and
  // shadowing it here is a trap for whoever adds a line to this function.
  const pattern = useDocumentStore.getState().document;
  const options = { ...Dxf.DEFAULT_EXPORT_OPTIONS, flavour: 'aama' as const };

  const { text, issues } = Dxf.exportDxfWithDiagnostics(pattern, options);
  const fileName = exportFileName(pattern, '.dxf');

  if (Dxf.blocksConversion(issues)) {
    const message = `DXF export refused: ${Dxf.summariseIssues(issues, 'aama')}`;
    useUiStore.getState().notify(message);
    return { saved: false, fileName, bytes: 0, message };
  }

  saveTextFile(fileName, text, 'application/dxf');

  const warnings = Dxf.countBySeverity(issues).warning;
  const pieces = pattern.pieces.length;
  const bytes = byteLength(text);
  const message =
    `Exported ${fileName} — ${pieces} piece boundar${pieces === 1 ? 'y' : 'ies'}, ` +
    `${(bytes / 1024).toFixed(1)}kB` +
    (warnings > 0 ? `, ${warnings} warning${warnings === 1 ? '' : 's'} (boundaries only — see the export report)` : '');
  useUiStore.getState().notify(message);
  return { saved: true, fileName, bytes, message };
};

/**
 * Writes the open document as the app's own JSON and downloads it.
 *
 * Same path, different serializer. Unlike DXF this is lossless — it is the
 * format the app round-trips through — so there is nothing to warn about.
 */
export const downloadJson = (): ExportOutcome => {
  const pattern = useDocumentStore.getState().document;
  const text = exportDocument(pattern, 'pds-json');
  const fileName = exportFileName(pattern, '.pds.json');

  saveTextFile(fileName, text, 'application/json');

  const bytes = byteLength(text);
  const message = `Exported ${fileName} — ${(bytes / 1024).toFixed(1)}kB, lossless`;
  useUiStore.getState().notify(message);
  return { saved: true, fileName, bytes, message };
};
