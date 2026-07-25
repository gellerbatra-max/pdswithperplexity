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
├── pattern/      Pattern document model — schema + pure read helpers
├── commands/     Command registry — plain TS, no React, no UI knowledge
├── store/        Zustand stores — live document, viewport, UI state
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

Shell complete. **Design** is the first built-out workspace; Grade, Fit, Prepare and
Review are still stubs.

The app opens on a seed pattern — SH-2041, a ten-piece classic shirt in
`store/seedDocument.ts` — so every panel reads from real geometry rather than
parallel fixtures.

## Document model

`pattern/` owns the schema and pure read helpers; nothing in it knows about
React, state or rendering. The shape is topological rather than coordinate-first:

- **Points** are the single source of truth for position. Segments, notches,
  internal lines, grain and grade rules all reference points by id, so moving a
  point propagates everywhere instead of needing to be copied.
- **Segments** are directed edges with a `SegmentGeometry` discriminated union
  (`line`, `cubic`, `arc`) — new curve families slot in without touching
  existing members.
- **Pieces** hold a point pool, a segment pool and an ordered `boundary` of
  segment ids. The indirection is what lets multi-loop pieces (a panel with a
  cut-out) arrive later as an optional `holes` field rather than a breaking
  change.
- **Grading** separates the size range, reusable grade rules, and the
  point-to-rule association — one rule is shared by many points across many
  pieces, which is how pattern makers actually work.
- **Measurement links** bind a spec-sheet point of measure to the geometry that
  produces it, so measurements are derived from the pattern rather than typed in
  beside it.

`resolve.ts` and `measure.ts` hide the indirection — consumers ask for
`outlinePoints`, `pieceBounds`, `segmentLength` or `evaluateMeasurements` and
never walk the pools themselves. Every document carries a `schemaVersion` so
migrations have something to branch on.

**Design workspace**

| Region | Contents |
| --- | --- |
| Left | Piece tree (grouped by cut category), block library with search, draft layers, edit history |
| Stage | Camera-driven rulers, selection context toolbar, minimap, zoom cluster |
| Right | Selection · Geometry · Piece · Construction · Measure · AI Suggestions |

Real behaviour: selection syncs across tree, canvas, minimap and inspector; the
Selection and Geometry tabs compute live from the document (bounds, perimeter, area,
node breakdown); the first four draft layers drive the renderer; block search filters;
zoom controls and zoom-to-fit are wired to the camera.

Mock data, clearly marked: block library, history log, points of measure and AI
suggestions. Placeholders: undo/redo (stub history store) and every drawing tool —
the tool dock and context toolbar render them disabled. No pattern-engineering logic
(offsetting, notching, grading, verification) exists yet.

**Command palette** — ⌘K / Ctrl+K, or the top-bar trigger. 29 commands in four
groups (Navigation, Design, Grading, File). The registry in `commands/` is plain
TypeScript with no React and no knowledge of the palette, so a menu or keybinding
table could render the same list. Commands marked `mock` report into the status bar
instead of pretending to work; commands whose preconditions fail are listed but
greyed and skipped by arrow navigation. Search is plain substring matching over
titles and keywords — deliberately not a scoring engine yet.
