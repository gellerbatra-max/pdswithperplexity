import { WORKSPACES } from '@/features';
import {
  createEmptyDocument,
  createSeedDocument,
  useDocumentStore,
  useUiStore,
  useViewportStore,
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

/** Mock commands report back instead of silently doing nothing. */
const mock = (message: string) => (): void => ui().notify(message);

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
    run: () => doc().setSelection(doc().document.pieces.map((p) => p.id)),
  },
  {
    id: 'design.select.clear',
    title: 'Clear selection',
    group: 'design',
    icon: 'minus',
    status: 'ready',
    keywords: ['deselect', 'none'],
    isEnabled: () => doc().selectedPieceIds.size > 0,
    run: () => doc().clearSelection(),
  },
];

/* --- Grading ---------------------------------------------------------------- */

const gradeCommands: readonly Command[] = [
  {
    id: 'grade.size-chart',
    title: 'Create size chart',
    group: 'grade',
    icon: 'grade',
    status: 'mock',
    keywords: ['sizes', 'range', 'chart'],
    run: mock('Create size chart — the grading engine is not built yet'),
  },
  {
    id: 'grade.rule.add',
    title: 'Add grade rule',
    group: 'grade',
    icon: 'grade',
    status: 'mock',
    keywords: ['increment', 'xy', 'rule'],
    run: mock('Add grade rule — the grading engine is not built yet'),
  },
  {
    id: 'grade.nest',
    title: 'Nest graded sizes',
    group: 'grade',
    icon: 'layers',
    status: 'mock',
    keywords: ['overlay', 'stack', 'sizes'],
    run: mock('Nest graded sizes — the grading engine is not built yet'),
  },
  {
    id: 'grade.rule.copy',
    title: 'Copy grade rules to selection',
    group: 'grade',
    icon: 'piece',
    status: 'mock',
    keywords: ['apply', 'paste', 'rules'],
    isEnabled: () => doc().selectedPieceIds.size > 0,
    run: mock('Copy grade rules — the grading engine is not built yet'),
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
    run: () => {
      doc().markSaved();
      ui().notify('Saved');
    },
  },
  {
    id: 'file.export.json',
    title: 'Export PDS JSON',
    group: 'file',
    icon: 'prepare',
    status: 'mock',
    keywords: ['download', 'json', 'export'],
    run: mock('Export PDS JSON — file output is not wired up yet'),
  },
  {
    id: 'file.export.dxf',
    title: 'Export DXF (AAMA)',
    group: 'file',
    icon: 'prepare',
    status: 'mock',
    keywords: ['download', 'dxf', 'aama', 'export', 'cad'],
    run: mock('Export DXF — the AAMA adapter is not implemented yet'),
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
