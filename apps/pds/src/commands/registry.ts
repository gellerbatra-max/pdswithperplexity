import { WORKSPACES } from '@/features';
import { Dxf } from '@/io';
import {
  createEmptyDocument,
  createGradeRule,
  createSeedDocument,
  downloadDxf,
  downloadJson,
  flushAutosave,
  nextDraftGradeRuleName,
  pieceRef,
  setPointsGradeRule,
  useDocumentStore,
  useGradeStore,
  useHistoryStore,
  useImportStore,
  useSelectionStore,
  useUiStore,
  useViewportStore,
  type SelectionRef,
} from '@/store';
import type { Command, CommandGroup } from './types';

/**
 * The command registry.
 *
 * Deliberately plain TypeScript: no React, no JSX, no knowledge of how commands
 * are presented. Commands reach the app through store actions via `getState()`,
 * so the palette — or a menu, or a keybinding table — can render this list
 * without the registry knowing any of them exist.
 */

export const COMMAND_GROUPS: readonly CommandGroup[] = [
  { id: 'navigation', label: 'Navigation' },
  { id: 'design', label: 'Design' },
  { id: 'grade', label: 'Grading' },
  { id: 'file', label: 'File' },
];

const ui = () => useUiStore.getState();
const doc = () => useDocumentStore.getState();
const view = () => useViewportStore.getState();
const selection = () => useSelectionStore.getState();
const grade = () => useGradeStore.getState();

// The `mock` helper that used to live here is gone: every command in this
// registry now does the real thing. `CommandStatus` keeps its 'mock' member
// for the next feature that lands ahead of its plumbing.

/** Defer past the next React commit. A timer, not rAF, which stalls in background tabs. */
const afterRender = (fn: () => void): void => {
  setTimeout(fn, 0);
};

const focusRegion = (selector: string, label: string): void => {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) {
    ui().notify(`${label} is hidden`);
    return;
  }
  el.focus();
  ui().notify(`Focused ${label}`);
};

/* --- Navigation ------------------------------------------------------------- */

const navigationCommands: readonly Command[] = [
  ...WORKSPACES.map(
    (workspace): Command => ({
      id: `nav.workspace.${workspace.id}`,
      title: `Go to ${workspace.title}`,
      group: 'navigation',
      icon: workspace.icon,
      status: 'ready',
      keywords: ['workspace', 'switch', 'open', workspace.summary],
      run: () => ui().setWorkspace(workspace.id),
    }),
  ),
  {
    id: 'nav.focus.context',
    title: 'Focus context panel',
    group: 'navigation',
    icon: 'panel-left',
    status: 'ready',
    keywords: ['left', 'sidebar', 'pieces', 'tree'],
    run: () => {
      ui().setContextPanelOpen(true);
      afterRender(() => focusRegion('.context', 'context panel'));
    },
  },
  {
    id: 'nav.focus.inspector',
    title: 'Focus inspector',
    group: 'navigation',
    icon: 'panel-right',
    status: 'ready',
    keywords: ['right', 'properties', 'panel'],
    run: () => {
      ui().setInspectorOpen(true);
      afterRender(() => focusRegion('.inspector', 'inspector'));
    },
  },
  {
    id: 'nav.focus.stage',
    title: 'Focus stage',
    group: 'navigation',
    icon: 'maximize',
    status: 'ready',
    keywords: ['canvas', 'centre', 'center', 'drawing'],
    run: () => focusRegion('.stage-area', 'stage'),
  },
  {
    id: 'nav.toggle.context',
    title: 'Toggle context panel',
    group: 'navigation',
    icon: 'panel-left',
    status: 'ready',
    keywords: ['hide', 'show', 'left'],
    run: () => ui().toggleContextPanel(),
  },
  {
    id: 'nav.toggle.inspector',
    title: 'Toggle inspector',
    group: 'navigation',
    icon: 'panel-right',
    status: 'ready',
    keywords: ['hide', 'show', 'right'],
    run: () => ui().toggleInspector(),
  },
];

/* --- Design ----------------------------------------------------------------- */

const designCommands: readonly Command[] = [
  {
    id: 'design.tool.select',
    title: 'Select tool',
    group: 'design',
    icon: 'design',
    status: 'ready',
    shortcut: 'V',
    keywords: ['pick', 'arrow', 'cursor'],
    run: () => {
      ui().setWorkspace('design');
      ui().setActiveTool('select');
    },
  },
  {
    id: 'design.tool.pan',
    title: 'Pan tool',
    group: 'design',
    icon: 'maximize',
    status: 'ready',
    shortcut: 'H',
    keywords: ['hand', 'move', 'scroll'],
    run: () => {
      ui().setWorkspace('design');
      ui().setActiveTool('pan');
    },
  },
  {
    id: 'design.zoom.fit',
    title: 'Zoom to fit',
    group: 'design',
    icon: 'maximize',
    status: 'ready',
    keywords: ['frame', 'fit', 'all', 'zoom'],
    run: () => view().fitToContent(),
  },
  {
    id: 'design.zoom.reset',
    title: 'Zoom to 100%',
    group: 'design',
    icon: 'search',
    status: 'ready',
    keywords: ['actual', 'size', 'reset', 'zoom'],
    run: () => view().resetCamera(),
  },
  {
    id: 'design.toggle.grid',
    title: 'Toggle grid',
    group: 'design',
    icon: 'grid',
    status: 'ready',
    keywords: ['guides', 'graph', 'show', 'hide'],
    run: () => view().toggleGrid(),
  },
  {
    id: 'design.layer.seam',
    title: 'Toggle seam allowance layer',
    group: 'design',
    icon: 'layers',
    status: 'ready',
    keywords: ['sa', 'offset', 'layer'],
    run: () => view().toggleLayer('seam'),
  },
  {
    id: 'design.layer.nodes',
    title: 'Toggle control points layer',
    group: 'design',
    icon: 'layers',
    status: 'ready',
    keywords: ['nodes', 'handles', 'layer'],
    run: () => view().toggleLayer('nodes'),
  },
  {
    id: 'design.layer.labels',
    title: 'Toggle piece labels layer',
    group: 'design',
    icon: 'layers',
    status: 'ready',
    keywords: ['names', 'text', 'layer'],
    run: () => view().toggleLayer('labels'),
  },
  {
    id: 'design.select.all',
    title: 'Select all pieces',
    group: 'design',
    icon: 'piece',
    status: 'ready',
    keywords: ['everything'],
    isEnabled: () => doc().document.pieces.length > 0,
    run: () => selection().selectMany(doc().document.pieces.map((p) => pieceRef(p.id))),
  },
  {
    id: 'design.select.clear',
    title: 'Clear selection',
    group: 'design',
    icon: 'minus',
    status: 'ready',
    keywords: ['deselect', 'none'],
    isEnabled: () => selection().selection.length > 0,
    run: () => selection().clear(),
  },
];

/* --- Grading ---------------------------------------------------------------- */

const gradeCommands: readonly Command[] = [
  {
    id: 'grade.rule.add',
    title: 'Add grade rule',
    group: 'grade',
    icon: 'grade',
    status: 'ready',
    keywords: ['increment', 'xy', 'rule'],
    run: () => {
      const draft = nextDraftGradeRuleName();
      createGradeRule(draft.code, draft.label);
      ui().notify(`Added grade rule ${draft.code}`);
    },
  },
  {
    id: 'grade.nest',
    title: 'Toggle nested size stack',
    group: 'grade',
    icon: 'layers',
    status: 'ready',
    keywords: ['overlay', 'stack', 'sizes'],
    run: () => {
      grade().toggleNest();
      ui().notify(grade().nestVisible ? 'Nest shown' : 'Nest hidden');
    },
  },
  {
    id: 'grade.rule.copy',
    title: "Copy the active point's grade rule to the rest of the selection",
    group: 'grade',
    icon: 'piece',
    status: 'ready',
    keywords: ['apply', 'paste', 'rules'],
    isEnabled: () => selection().primary?.kind === 'point' && selection().selection.length > 1,
    run: () => {
      const sel = selection();
      if (sel.primary?.kind !== 'point') return;
      const source = sel.primary;

      const sourcePiece = doc().document.pieces.find((p) => p.id === source.pieceId);
      const sourcePoint = sourcePiece?.points.find((p) => p.id === source.pointId);
      const ruleId = sourcePoint?.gradeRuleId;
      if (!ruleId) {
        ui().notify('The active point has no grade rule to copy');
        return;
      }

      const targets = sel.selection.filter(
        (ref): ref is Extract<SelectionRef, { kind: 'point' }> =>
          ref.kind === 'point' && !(ref.pieceId === source.pieceId && ref.pointId === source.pointId),
      );
      const byPiece = new Map<string, string[]>();
      for (const ref of targets) {
        byPiece.set(ref.pieceId, [...(byPiece.get(ref.pieceId) ?? []), ref.pointId]);
      }
      for (const [pieceId, pointIds] of byPiece) {
        setPointsGradeRule(pieceId, pointIds, ruleId);
      }
      ui().notify(
        targets.length === 0
          ? 'Nothing else selected to copy the rule to'
          : `Copied grade rule to ${targets.length} point${targets.length === 1 ? '' : 's'}`,
      );
    },
  },
];

/* --- File ------------------------------------------------------------------- */

const fileCommands: readonly Command[] = [
  {
    id: 'file.new',
    title: 'New document',
    group: 'file',
    icon: 'plus',
    status: 'ready',
    keywords: ['blank', 'empty', 'create'],
    run: () => {
      doc().setDocument(createEmptyDocument());
      useHistoryStore.getState().reset();
      view().resetCamera();
      ui().notify('New empty document');
    },
  },
  {
    id: 'file.open.sample',
    title: 'Open sample document — SH-2041 Classic Shirt',
    group: 'file',
    icon: 'folder',
    status: 'ready',
    keywords: ['load', 'demo', 'shirt', 'seed', 'example'],
    run: () => {
      doc().setDocument(createSeedDocument());
      useHistoryStore.getState().reset();
      afterRender(() => view().fitToContent());
      ui().notify('Opened SH-2041 Classic Shirt');
    },
  },
  {
    id: 'file.save',
    title: 'Save document',
    group: 'file',
    icon: 'cloud',
    status: 'ready',
    shortcut: '⌘S',
    keywords: ['store', 'persist'],
    isEnabled: () => doc().saveState !== 'saved',
    // Bypasses the autosave debounce and writes now, so ⌘S means what it says
    // rather than just flipping the save-state flag.
    run: () => {
      void flushAutosave().then(() => ui().notify('Saved'));
    },
  },
  {
    id: 'file.export.json',
    title: 'Export PDS JSON',
    group: 'file',
    icon: 'prepare',
    status: 'ready',
    keywords: ['download', 'json', 'export', 'save', 'file'],
    // The app's own format, and the only lossless one — this is what to hand
    // someone when the geometry matters more than the recipient's CAD.
    run: () => downloadJson(),
  },
  {
    id: 'file.import.dxf',
    title: 'Import DXF (AAMA/ASTM)…',
    group: 'file',
    icon: 'folder',
    status: 'ready',
    keywords: ['dxf', 'aama', 'astm', 'import', 'open', 'cad', 'accumark'],
    /*
     * The real workflow: pick a file, parse it with full diagnostics, review
     * what the parser says about it in the import dialog, then apply or
     * discard. The document store is only touched on apply — see
     * store/importStore.ts.
     */
    run: () => useImportStore.getState().pickDxfFile(),
  },
  {
    id: 'file.import.dxf.report',
    title: 'Show last DXF import report',
    group: 'file',
    icon: 'review',
    status: 'ready',
    keywords: ['dxf', 'import', 'report', 'diagnostics', 'issues', 'layers'],
    /*
     * The session outlives the apply so "what did that import actually read,
     * skip and warn about?" stays answerable after the dialog closes — the
     * question usually arrives later, when a piece looks wrong on the stage.
     */
    isEnabled: () => useImportStore.getState().session !== null,
    run: () => useImportStore.getState().openDialog(),
  },
  {
    id: 'file.export.dxf',
    title: 'Export DXF (AAMA) — piece boundaries',
    group: 'file',
    icon: 'prepare',
    status: 'ready',
    keywords: ['download', 'dxf', 'aama', 'export', 'cad', 'save', 'file'],
    /*
     * Titled "piece boundaries" rather than plain "Export DXF" because that
     * is what it writes: every other layer binding is unverified against
     * ASTM D6673 and four are contradicted by real vendor files, so the
     * writer emits the one concept three files agree on. Saying so in the
     * command name means nobody has to read a diagnostic to find out.
     */
    run: () => downloadDxf(),
  },
  {
    id: 'file.export.dxf.report',
    title: 'Show what a DXF export would contain',
    group: 'file',
    icon: 'review',
    status: 'ready',
    keywords: ['dxf', 'export', 'report', 'plan', 'blockers', 'warnings'],
    // The detail the notification cannot hold: what would be written, what
    // would be dropped, and what is blocking.
    run: () => {
      const document = doc().document;
      const plan = Dxf.describeExportPlan(document, { flavour: 'aama', includeGradedSizes: false });
      const { issues } = Dxf.exportDxfWithDiagnostics(document, {
        ...Dxf.DEFAULT_EXPORT_OPTIONS,
        flavour: 'aama',
      });
      const counts = Dxf.countBySeverity(issues);
      ui().notify(
        `${plan.label}: ${plan.blocksToWrite} piece(s) over ${plan.layersUsed} verified layer binding — ` +
          `${plan.wouldSucceed ? 'would write' : 'BLOCKED'}, ${counts.error} error(s), ${counts.warning} warning(s). ` +
          `Notches, grain and internal lines are not written; their layer bindings are unverified.`,
      );
    },
  },
];

export const COMMANDS: readonly Command[] = [
  ...navigationCommands,
  ...designCommands,
  ...gradeCommands,
  ...fileCommands,
];

/**
 * Plain substring match over title and keywords. Intentionally not a scoring
 * engine — ranking stays registry order until there is enough content to need
 * anything smarter.
 */
export const searchCommands = (query: string): readonly Command[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return COMMANDS;
  const terms = needle.split(/\s+/);
  return COMMANDS.filter((command) => {
    const haystack = `${command.title} ${(command.keywords ?? []).join(' ')}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
};
