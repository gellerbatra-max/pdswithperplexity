/** Colours the renderer draws with. Kept in TS because canvas cannot read CSS variables cheaply. */
export interface CanvasTheme {
  readonly background: string;
  readonly gridMinor: string;
  readonly gridMajor: string;
  readonly axis: string;
  readonly outline: string;
  readonly outlineSelected: string;
  readonly seamAllowance: string;
  readonly node: string;
  readonly nodeSelected: string;
  readonly label: string;
  readonly grain: string;
  readonly internal: string;
  readonly gradePoint: string;
  readonly selectionHalo: string;
}

/** Mirrors the `--surface-sunken` / `--accent` tokens in styles/tokens.css. */
export const DARK_CANVAS_THEME: CanvasTheme = {
  background: '#0a0c10',
  gridMinor: 'rgba(255, 255, 255, 0.04)',
  gridMajor: 'rgba(255, 255, 255, 0.09)',
  axis: 'rgba(77, 141, 255, 0.32)',
  outline: '#cfd8e3',
  outlineSelected: '#4d8dff',
  seamAllowance: 'rgba(207, 216, 227, 0.3)',
  node: '#8b96a5',
  nodeSelected: '#4d8dff',
  label: 'rgba(207, 216, 227, 0.72)',
  grain: 'rgba(233, 185, 73, 0.75)',
  internal: 'rgba(155, 200, 255, 0.55)',
  gradePoint: '#e9b949',
  selectionHalo: 'rgba(77, 141, 255, 0.28)',
};
