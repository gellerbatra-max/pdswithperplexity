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
  readonly hover: string;
  readonly nestGhost: string;
  readonly nestActive: string;
  readonly gradeVector: string;
}

/*
 * Canvas palette. Mirrors the surface and accent tokens in styles/tokens.css.
 *
 * The stage is the only surface allowed real contrast: pattern linework is the
 * brightest thing in the app, and the grid sits far enough back that it never
 * competes with it. Accents here run slightly stronger than the chrome tokens
 * because they must read against grey linework rather than a flat panel.
 */
export const DARK_CANVAS_THEME: CanvasTheme = {
  background: '#0b0e12',
  gridMinor: 'rgba(255, 255, 255, 0.028)',
  gridMajor: 'rgba(255, 255, 255, 0.062)',
  axis: 'rgba(109, 163, 212, 0.24)',
  outline: '#d3dae3',
  outlineSelected: '#8bb8e0',
  seamAllowance: 'rgba(211, 218, 227, 0.22)',
  node: '#7b8595',
  nodeSelected: '#8bb8e0',
  label: 'rgba(211, 218, 227, 0.62)',
  grain: 'rgba(194, 160, 88, 0.62)',
  internal: 'rgba(140, 176, 210, 0.42)',
  gradePoint: '#c2a058',
  selectionHalo: 'rgba(139, 184, 224, 0.22)',
  hover: 'rgba(139, 184, 224, 0.4)',
  nestGhost: 'rgba(152, 162, 177, 0.26)',
  nestActive: 'rgba(194, 160, 88, 0.8)',
  gradeVector: 'rgba(194, 160, 88, 0.6)',
};
