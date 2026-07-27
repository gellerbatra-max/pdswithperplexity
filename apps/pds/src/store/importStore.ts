import { create } from 'zustand';
import { Dxf } from '@/io';
import { FormatParseError } from '@/io';
import type { PatternDocument } from '@/pattern';
import { useDocumentStore } from './documentStore';
import { useHistoryStore } from './historyStore';
import { useUiStore } from './uiStore';
import { useViewportStore } from './viewportStore';

/**
 * The DXF import workflow: pick a file, parse it, *review what the parser
 * says about it*, then apply or discard.
 *
 * The review step is the point. This importer's contract is that it never
 * silently reinterprets or drops content — every unsupported entity, layer
 * conflict and defaulted field comes back as an issue — and a workflow that
 * swapped the document in directly would throw that account away at the one
 * moment the user can act on it. So parsing lands here first, as a *session*,
 * and the document store is only touched when the user applies it.
 *
 * The session outlives the apply on purpose: "what did that import actually
 * read, skip and warn about?" is a question that comes up after the fact,
 * when a piece looks wrong on the stage. `file.import.dxf.report` reopens the
 * same dialog over the kept session.
 */

export type ImportSessionStatus = 'reviewing' | 'failed' | 'applied';

export interface ImportSession {
  readonly fileName: string;
  readonly flavourLabel: string;
  readonly status: ImportSessionStatus;
  /** Parsed but not yet applied. Null when parsing failed structurally. */
  readonly document: PatternDocument | null;
  readonly issues: readonly Dxf.ConversionIssue[];
  readonly layers: readonly Dxf.LayerUsageRow[];
  /** The parse error's message, when status is 'failed'. */
  readonly error: string | null;
  readonly importedAt: string;
}

export interface ImportState {
  session: ImportSession | null;
  dialogOpen: boolean;

  /** Opens the browser's file picker; hands the chosen file to `beginImport`. */
  pickDxfFile: () => void;
  /** Parses `payload` into a reviewing (or failed) session and opens the dialog. */
  beginImport: (fileName: string, payload: string) => void;
  /** Replaces the open document with the session's. Reviewing sessions only. */
  applySession: () => void;
  /** Drops the session entirely. */
  discardSession: () => void;
  /** Closes the dialog but keeps the session inspectable via the report command. */
  closeDialog: () => void;
  /** Reopens the dialog over the kept session, if there is one. */
  openDialog: () => void;
}

/** Defer past the next React commit — same reasoning as the command registry. */
const afterRender = (fn: () => void): void => {
  setTimeout(fn, 0);
};

/**
 * Both flavours share one layer table today, and neither real fixture
 * distinguishes them; AAMA is the label the palette command has always
 * carried. Revisit when a file proves an actual ASTM-only difference.
 */
const IMPORT_FLAVOUR = 'aama' as const;

/**
 * The picker input lives outside React: created per invocation, removed on
 * the next one. A cancelled dialog fires no event anywhere, so the previous
 * input can linger until then — harmless, hidden, and replaced on reuse.
 */
let activeInput: HTMLInputElement | null = null;

export const useImportStore = create<ImportState>((set, get) => ({
  session: null,
  dialogOpen: false,

  pickDxfFile: () => {
    activeInput?.remove();
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.dxf';
    input.style.display = 'none';
    input.dataset.role = 'dxf-import-input';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (activeInput === input) activeInput = null;
      if (!file) return;
      void file
        .text()
        .then((payload) => get().beginImport(file.name, payload))
        .catch((error: unknown) => {
          useUiStore
            .getState()
            .notify(`Could not read ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
        });
    });
    document.body.append(input);
    activeInput = input;
    input.click();
  },

  beginImport: (fileName, payload) => {
    const flavourLabel = Dxf.DXF_FLAVOUR_LABEL[IMPORT_FLAVOUR];
    const importedAt = new Date().toISOString();
    try {
      const { document, issues, layers } = Dxf.importDxfWithDiagnostics(payload, {
        ...Dxf.DEFAULT_IMPORT_OPTIONS,
        flavour: IMPORT_FLAVOUR,
      });
      set({
        session: { fileName, flavourLabel, status: 'reviewing', document, issues, layers, error: null, importedAt },
        dialogOpen: true,
      });
    } catch (error) {
      // A FormatParseError means the file's *structure* defeated the
      // tokenizer or walker — there is no partial document to review, only
      // the reason. Anything else is a bug and should not be dressed up as
      // a file problem, so it is rethrown.
      if (!(error instanceof FormatParseError)) throw error;
      set({
        session: {
          fileName,
          flavourLabel,
          status: 'failed',
          document: null,
          issues: [],
          layers: [],
          error: error.message,
          importedAt,
        },
        dialogOpen: true,
      });
    }
  },

  applySession: () => {
    const { session } = get();
    if (!session || session.status !== 'reviewing' || !session.document) return;
    // Same gate importDxf's throwing contract enforces, surfaced as a
    // disabled button in the dialog instead of an exception here.
    if (Dxf.blocksConversion(session.issues)) return;

    useDocumentStore.getState().setDocument(session.document);
    useHistoryStore.getState().reset();
    afterRender(() => useViewportStore.getState().fitToContent());

    set({ session: { ...session, status: 'applied' }, dialogOpen: false });

    const counts = Dxf.countBySeverity(session.issues);
    const pieces = session.document.pieces.length;
    useUiStore
      .getState()
      .notify(
        `Imported ${pieces} piece${pieces === 1 ? '' : 's'} from ${session.fileName}` +
          (counts.warning > 0 ? ` — ${counts.warning} warning${counts.warning === 1 ? '' : 's'} kept in the import report` : ''),
      );
  },

  discardSession: () => {
    const { session } = get();
    set({ session: null, dialogOpen: false });
    if (session) useUiStore.getState().notify(`Discarded import of ${session.fileName}`);
  },

  closeDialog: () => set({ dialogOpen: false }),

  openDialog: () => {
    if (get().session) set({ dialogOpen: true });
  },
}));
