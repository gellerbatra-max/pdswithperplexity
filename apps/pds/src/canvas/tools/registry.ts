import { panTool } from './panTool';
import { selectTool } from './selectTool';
import type { CanvasTool } from './types';

/**
 * Tool registry.
 *
 * Adding a drafting tool means writing a `CanvasTool` and registering it here —
 * the canvas host, the tool dock and the workspace modules stay untouched.
 * Tools declared by a workspace but not yet implemented resolve to the select
 * tool, which matches how they render: listed, disabled, visibly not built.
 */
const TOOLS = new Map<string, CanvasTool>([
  [selectTool.id, selectTool],
  [panTool.id, panTool],
]);

export const registerTool = (tool: CanvasTool): void => {
  TOOLS.set(tool.id, tool);
};

export const getTool = (id: string): CanvasTool => TOOLS.get(id) ?? selectTool;

export const hasTool = (id: string): boolean => TOOLS.has(id);

export { panTool, selectTool };
