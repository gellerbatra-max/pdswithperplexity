# PDS — Pattern Design Studio

A modern, canvas-first apparel Pattern Design System for the browser.

## Product direction

PDS is a **new product**, not a port. The reference point for *what* a pattern
system must do is Gerber AccuMark's PDS (and the Seamline research derived from it) —
but the reference stops at feature coverage. The interaction model is built fresh:

| Legacy desktop PDS | PDS |
| --- | --- |
| Ribbon tabs owning the screen | Thin chrome; the canvas owns the screen |
| Tools grouped by menu taxonomy | Tools grouped by **workspace** — the job you're doing |
| Modal dialogs for every operation | Direct manipulation on canvas, inspector for parameters |
| Desktop install, per-seat | Browser-native, desktop-first layout |
| Files on a local share | A versioned document model, format adapters at the edges |

### The five workspaces

The canvas never changes; only the tools around it do.

| Workspace | Purpose |
| --- | --- |
| **Design** | Draft and shape pieces — outlines, seam allowance, notches, grain, annotation |
| **Grade** | Develop the size range — grade points, grade rules, size charts, nested sizes |
| **Fit** | Measure and evaluate — points of measure, walk seams, ease analysis |
| **Prepare** | Production readiness — cut parts, piece data, marker handoff, export |
| **Review** | Verify and sign off — checks, comments, revisions, audit report |

## Stack

React 19 · TypeScript (strict) · Vite · Zustand · HTML Canvas 2D

No rendering framework is layered over the canvas. The renderer is a small,
stateless function over document state, which keeps the door open for a WebGL or
WebGPU backend later without rewriting the feature layer.

## Shell

Six regions around one dominant stage. Only the stage flexes, so proportions hold at
any window size.

```
┌──────────────────────────────────────────────┐
│ top bar                                 56px │  product · workspace switcher ·
├──────┬─────────┬──────────────┬──────────────┤  title · save state · ⌘K ·
│ rail │ context │    stage     │  inspector   │  undo/redo · comments · avatar
│ 64px │ 200-420 │   flexible   │    288px     │
├──────┴─────────┴──────────────┴──────────────┤
│ status bar                              32px │  tool · counts · cursor · zoom
└──────────────────────────────────────────────┘
```

Each workspace supplies three components — `Context` (left: what is in the document),
`Stage` (centre: what this mode draws over the document) and `Panel` (right: what is
selected) — plus its tool set. Switching workspace swaps all four.

The shared canvas under the stage layer is deliberately *not* per-workspace: it stays
mounted across switches so the camera, selection and document view survive. Workspaces
layer onto it rather than replacing it, and the layer is click-through so canvas input
is never blocked.

## Layout

```
apps/pds/src/
├── components/   App shell — top bar, rail, context, stage, inspector, status bar
├── features/     One folder per workspace; each owns its tools + context + inspector
│   ├── design/
│   ├── grade/
│   ├── fit/
│   ├── prepare/
│   └── review/
├── store/        Zustand stores — document, viewport, UI — and domain types
├── canvas/       Camera, grid, hit testing, renderer, surface hook
├── geometry/     Vectors, bounds, unit conversion (mm is canonical)
├── io/           Format adapters — native JSON today, DXF/AAMA/ASTM/SVG/PDF next
├── ai/           Provider boundary for AI-assisted drafting, grading, audits
└── styles/       Design tokens and application CSS
```

Two rules keep this clean as it grows:

1. **Features never draw.** They mutate the store; `canvas/` renders whatever the
   store holds.
2. **Nothing calls a model or a file format directly.** `ai/` and `io/` are
   interfaces with swappable adapters behind them.

## Getting started

```bash
npm install
```

```bash
npm run dev
```

Then `npm run build` to produce a production bundle, and `npm run typecheck` to
run TypeScript without emitting.

## Status

Shell complete, workspaces empty. The six regions are built and wired: the stage
renders, pans, zooms and selects; the context panel resizes (drag or arrow keys); the
workspace switcher, panel toggles and grid/zoom controls work; ⌘K opens the command
surface.

Placeholders, deliberately: undo/redo render disabled against a stub history store,
the command palette has no index behind it, and comments/profile are non-functional.
Unbuilt tools appear disabled in the dock so feature coverage stays visible. No
pattern-engineering logic (offsetting, grading, verification) exists yet.
