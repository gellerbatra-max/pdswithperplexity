import { create } from 'zustand';
// Type-only, so `verbatimModuleSyntax` erases it and the engines stay out of
// the main bundle.
import type { NestMode } from '@/nest/pipeline';

/** Canvas tools, one per file under `canvas/tools/`. */
export type MarkerTool = 'select' | 'drag' | 'buttSlide';

export type DockTab = 'piece' | 'order' | 'options' | 'keys';

export type StatusLevel = 'info' | 'ok' | 'warn' | 'error';

export interface StatusMessage {
  level: StatusLevel;
  text: string;
}

/** Effort the nester runs at: grid step and, for free pieces, angle count. */
export type NestEffortSetting = 1 | 2 | 3 | 4 | 5;

export interface UiState {
  activeTool: MarkerTool;
  /** Ids of selected PlacedPieces, in click order. */
  selection: string[];
  dockTab: DockTab;
  statusMessage: StatusMessage | null;
  /** A preference rather than document data, so it lives here. */
  nestEffort: NestEffortSetting;
  /** Which engine, or which intent, auto-nest runs. Also a preference. */
  nestMode: NestMode;

  setTool: (tool: MarkerTool) => void;
  setSelection: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  clearSelection: () => void;
  setDockTab: (tab: DockTab) => void;
  setStatus: (level: StatusLevel, text: string) => void;
  setNestEffort: (effort: NestEffortSetting) => void;
  setNestMode: (mode: NestMode) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeTool: 'select',
  selection: [],
  dockTab: 'piece',
  statusMessage: null,
  nestEffort: 3,
  // Bottom-left fill, which is what auto-nest ran before the mode existed.
  // Changing the default would quietly change every existing user's markers.
  // (Was `tightest`, which resolved to this same engine — same behaviour.)
  nestMode: 'heuristic',

  setTool: (activeTool) => set({ activeTool }),
  setSelection: (selection) => set({ selection }),

  // Idempotent: selecting an already-selected piece must not duplicate its id,
  // or removing it later would leave a stale entry behind.
  addToSelection: (id) =>
    set((state) =>
      state.selection.includes(id) ? {} : { selection: [...state.selection, id] },
    ),

  clearSelection: () => set({ selection: [] }),
  setDockTab: (dockTab) => set({ dockTab }),

  // Never auto-dismissed. Warnings and errors have to survive until something
  // replaces them, so a failed nest is still on screen when the user looks up.
  setStatus: (level, text) => set({ statusMessage: { level, text } }),

  setNestEffort: (nestEffort) => set({ nestEffort }),
  setNestMode: (nestMode) => set({ nestMode }),
}));
