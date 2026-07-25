import { create } from 'zustand';
import type { ToolId, WorkspaceId } from './types';

export const CONTEXT_WIDTH_MIN = 200;
export const CONTEXT_WIDTH_MAX = 420;
export const CONTEXT_WIDTH_DEFAULT = 264;

const clampContextWidth = (width: number): number =>
  Math.min(CONTEXT_WIDTH_MAX, Math.max(CONTEXT_WIDTH_MIN, Math.round(width)));

export interface UiState {
  workspace: WorkspaceId;
  activeTool: ToolId;

  contextPanelOpen: boolean;
  contextPanelWidth: number;
  inspectorOpen: boolean;
  commandPaletteOpen: boolean;

  setWorkspace: (workspace: WorkspaceId) => void;
  setActiveTool: (tool: ToolId) => void;
  toggleContextPanel: () => void;
  setContextPanelWidth: (width: number) => void;
  toggleInspector: () => void;
  setCommandPaletteOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  workspace: 'design',
  activeTool: 'select',

  contextPanelOpen: true,
  contextPanelWidth: CONTEXT_WIDTH_DEFAULT,
  inspectorOpen: true,
  commandPaletteOpen: false,

  setWorkspace: (workspace) => set({ workspace, activeTool: 'select' }),
  setActiveTool: (activeTool) => set({ activeTool }),

  toggleContextPanel: () => set((state) => ({ contextPanelOpen: !state.contextPanelOpen })),
  setContextPanelWidth: (width) => set({ contextPanelWidth: clampContextWidth(width) }),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
}));
