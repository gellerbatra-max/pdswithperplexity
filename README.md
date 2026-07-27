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
│ top bar                                 52px │  product · workspace switcher ·
├──────┬─────────┬──────────────┬──────────────┤  title · save state · ⌘K ·
│ rail │ context │    stage     │  inspector   │  undo/redo · comments · avatar
│ 60px │ 200-420 │   flexible   │    282px     │
├──────┴─────────┴──────────────┴──────────────┤
│ status bar                              30px │  tool · counts · cursor · zoom
└──────────────────────────────────────────────┘

Geometry comes from `styles/tokens.css`; those figures are its current values.
```

Each workspace supplies `Context` (left: what is in the document), `Stage`
(centre: what this mode draws over the document) and `Panel` (right: what is
selected), plus its tool set — and optionally a `Drawer`, a bottom strip under
the stage for workspaces needing a wide, table-shaped surface the inspector
column cannot hold. Grade uses one; the others do not, and the floating stage
chrome lifts clear only when a drawer is present.

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
├── diagnostics.ts  Shared severity + finding vocabulary
├── commands/     Command registry — plain TS, no React, no UI knowledge
├── store/        Zustand stores — live document, viewport, UI state
├── canvas/       Camera, grid, hit testing, renderer, surface hook
├── geometry/     Vectors, bounds, unit conversion (mm is canonical)
├── io/           Format adapters — native JSON today, DXF scaffolded (see io/README.md)
├── ai/           Assistant layer — local-first provider boundary (see ai/README.md)
└── styles/       Design tokens and application CSS
```

Two rules keep this clean as it grows:

1. **Features never draw.** They mutate the store; `canvas/` renders whatever the
   store holds.
2. **Nothing calls a model or a file format directly.** `ai/` and `io/` are
   interfaces with swappable adapters behind them.

## Building on this

`DEVELOPMENT.md` records what is real, what is staged, and a recommended
implementation order. Every `TODO(...)` in the source points there:

```bash
grep -rn "TODO(" apps/pds/src
```

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

Shell complete. **Design** is the first built-out workspace; Grade is partly
built; Fit, Prepare and Review are stubs. `DEVELOPMENT.md` has the full
real-versus-staged breakdown.

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

## Canvas interaction

The canvas host (`components/CanvasStage.tsx`) owns the surface, the render loop
and pointer plumbing — nothing else. Interaction behaviour lives in
`canvas/tools/`, where a `CanvasTool` is a plain object of optional handlers:
no React, no store access, no DOM. Everything it needs arrives in a
`ToolContext`; everything it changes goes through `ToolActions`.

A drag returns a `ToolGesture` from `onPointerDown`, so drag state lives in the
gesture's closure rather than as refs in the host. Adding a drafting tool means
writing a tool and calling `registerTool` — the host, the tool dock and the
workspace modules stay untouched.

What each workspace lets you pick is declared as `selectableKinds`, so Grade
picks grade points before the piece beneath them without the tool knowing which
workspace is active.

## Grading

`pattern/nest.ts` derives the size range by applying each point's grade rule as
a plain translation. This is deliberately **not** correct grading — a real
grader moves points along construction lines, keeps curves smooth through the
nest and preserves seam lengths between mating pieces. What it provides is a
nest with the right shape of data, so the overlay, the inspector binding and the
drawer can be built and exercised before a solver exists.

The Grade workspace nests only the selected piece, which is both how graders
work and what keeps the per-frame cost bounded. Nested outlines draw dashed
behind the base pattern, grade points draw as square markers, and movement
arrows run smallest size to largest. The bottom drawer carries the size
progression and anomaly chips, both following the shared selection; clicking a
size there sets the active size, which the stage highlights — so the drawer
drives the canvas as well as reflecting it.

Anomaly chips are hand-written placeholders, not derived from the nest.

## Selection

Selection is shared state in its own store, not a field on the document — it is
view state, every workspace uses it, and it must survive document edits. A
`SelectionRef` is a discriminated union (`piece`, `point`) always rooted at a
piece, so adding `segment` or `notch` later means adding a union member and a
resolution case, with no existing member changing.

Each workspace binds its inspector to the same selection: Design shows piece
properties, Grade shows the selected point's grade rule and per-size movement.
A selection made in one workspace survives switching to another. Refs are pruned
automatically when the document changes, so a selection can never outlive the
geometry it points at.

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

The Piece tab is a real editor. Name, code, fabric, cut quantity, seam
allowance, cut-on-fold and mirrored-pair all write through commands, so every
edit is undoable and propagates live to the tree, canvas and status bar. Text
and number fields coalesce per piece and per field, so a typing burst is one
undo step. Category stays read-only — it has no editor yet. The selection
toolbar's **Duplicate** and **Remove** are likewise real; both act on a single
piece and disable themselves on a multi-selection rather than guessing.

Geometry can be moved and shaped. Design picks the smallest thing under the
cursor — a point, then the edge it lies on, then the piece beneath both — and
dragging any of them moves it. A selected curved edge shows its control handles
as diamonds; dragging one reshapes the edge without moving its endpoints.
Double-clicking an edge splits it where you click, and a selected point can be
deleted, merging the two edges that met there. A drag paints a dashed draft and
leaves the document alone until the pointer comes up, at which point one command
lands on the undo stack; abandoning a drag therefore needs no rollback.

Alt-double-click places a notch instead of a point; the selected edge lists its
notches with their distance along the seam, in millimetres, and removes them.

The splits are exact — de Casteljau subdivision, so adding a point does not move
the outline, and notches and points of measure are re-anchored onto the halves
rather than orphaned. Merging is exact when it undoes a split and approximate
otherwise, because two joined cubics are generally not one cubic. Dragging a
handle at a point marked `curve` swings its neighbour to stay opposite, so a
shared point does not kink; a `corner` point is left alone.

An edge is a line, a Bézier or a circular arc, chosen on the selected edge; a
point is a corner or smooth, and marking it smooth makes the two edges tangent
there rather than merely relabelling it. Notches list their type and their
distance along the seam in millimetres, both editable.

Lengths are integrated from the curves rather than summed off a flattened
polyline, so a measurement depends on the geometry and not on how finely it was
sampled — splitting an edge no longer nudges the number. Clicks resolve to a
true closest point, so a split or a notch lands where the pointer was. Rotate,
mirror, darts, grain editing and drawing a piece from scratch do not exist yet;
their controls have been removed rather than shown disabled, and what is missing
is listed in `DEVELOPMENT.md`.

The History panel reads the command stack directly — newest first, each row
carrying the command's label, its subject, and how long ago it ran. Entries
that have been undone stay listed but dimmed, since they are still redoable and
hiding them makes an undo feel like a delete; making a fresh edit discards that
branch and the rows go with it. A coalesced burst — a typing run, a drag — is
one row, because the stack merged it into one entry before the panel ever saw
it. There is no fabricated "document created" row: with an empty stack the
panel says so.

Mock data, clearly marked: block library, points of measure and AI suggestions.
Placeholders: every drawing tool, and the toolbar's Mirror / Rotate / Seam
allowance / Notch / Grain — all render disabled. No pattern-engineering logic
(notching, grading, verification) exists yet.

Undo/redo is a real inverse-command stack (`store/historyStore.ts` +
`store/documentCommands.ts`): every document edit builds a `DocumentCommand`
that can reverse itself and is executed through the stack, rather than
mutating `documentStore` directly. Persistence rides on the same path —
`store/persistence.ts` autosaves to IndexedDB on a debounce and restores on
load — though there is no file story yet (no download/upload).

**Command palette** — ⌘K / Ctrl+K, or the top-bar trigger. 29 commands in four
groups (Navigation, Design, Grading, File). The registry in `commands/` is plain
TypeScript with no React and no knowledge of the palette, so a menu or keybinding
table could render the same list. Commands marked `mock` report into the status bar
instead of pretending to work; commands whose preconditions fail are listed but
greyed and skipped by arrow navigation. Search is plain substring matching over
titles and keywords — deliberately not a scoring engine yet.
