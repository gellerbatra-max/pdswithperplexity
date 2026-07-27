# Development notes

What this scaffold is, what it deliberately isn't, and what to build next.

Every TODO in the source is tagged and points here. To see the backlog:

```bash
grep -rn "TODO(" apps/pds/src
```

## What is real, and what is staged

Being precise about this matters, because a scaffold that looks finished is a
trap. Nothing here fakes a result: unimplemented conversions throw and mock data
is labelled at the top of its file.

Unbuilt tools used to render *disabled*, which turned out to be its own kind of
lie — a dock of seven dead buttons reads as a broken app, not an honest one. The
Design workspace now lists only tools that work; what is missing is recorded
here instead. The other four workspaces are wholesale stubs and still show their
intended tool sets, because there the list is the only statement of coverage.

| Area | State |
| --- | --- |
| Shell, workspaces, selection, command palette | Real |
| Pattern document model (`pattern/`) | Real |
| Canvas rendering, pan/zoom, picking, tool layer | Real |
| Measurement evaluation | Real — derived from geometry |
| DXF export validation | Real and useful today |
| Seam allowance | Real — a true polygon offset, per-edge widths, `npm run check:offset` |
| Point / segment / piece move | Real — drag with preview, one undoable command per gesture |
| Curve shaping (control handles) | Real — drag handles; smooth/corner is user-controlled |
| Insert / delete outline point | Real — split is exact; merge is exact only when undoing a split |
| Add / remove notch | Real — alt-double-click an edge, or remove from the inspector |
| Arc length + closest point | Exact — adaptive quadrature, multi-basin Newton solve |
| Circular arcs | Real — exact length, split, closest point; Line/Curve/Arc in the inspector |
| Point role (smooth / corner) | Real — inspector control, enforced on handles, shown on canvas |
| Numeric point + edge editing | Real — inspector writes through commands |
| Grading | **Fake** — a per-point translation, not a solver |
| DXF import/export | **Not implemented** — throws |
| Undo/redo | Real — inverse-command stack (`historyStore.ts` + `documentCommands.ts`) |
| Persistence | Real, partially — autosave to IndexedDB; **no file story yet** (no download/upload) |
| Piece editing (name, code, fabric, qty, allowance, fold, mirror) | Real — command-driven and undoable |
| Duplicate / remove piece | Real — command-driven and undoable |
| Design history panel | Real — reads the command stack; undone entries shown dimmed |
| AI recommendations | **Mock** — hand-written, no model |
| Fit, Prepare, Review workspaces | **Stubs** |

## Recommended implementation order

The ordering is driven by what unblocks what, not by what is most visible.

### 1. Document persistence and the command stack — done

`historyStore.ts` is an inverse-command stack: a `DocumentCommand` is a pure
`(document) => document` pair (`do`/`undo`), built by `documentCommands.ts` from
live store state and executed through `historyStore.execute`. `documentStore`
no longer mutates directly — `renameDocument`/`addPiece`/`updatePiece`/
`removePiece` in `documentCommands.ts` are the one path a mutation takes, and
`documentStore.applyDocument` is the one path a command's result takes back
into the store. `documentStore.setDocument` (full replace, for new/open/hydrate)
stays a separate, non-undoable path — callers reset history themselves
(`useHistoryStore.getState().reset()`) since a swapped-in document has nothing
to undo into.

Consecutive commands sharing a `coalesceKey` merge into one undo step if
they land within a second of each other (`COALESCE_WINDOW_MS`) — otherwise
renaming the document via the title field would push one undo entry per
keystroke. The same mechanism is there for a future drag tool to coalesce
pointermove commands into one step per gesture.

`store/persistence.ts` wires autosave: every document change debounces a
write to IndexedDB (`io/json.ts`'s existing `pds-json` format), and
`hydrateFromAutosave` restores it on boot, ahead of the seed document.
`file.save` (⌘S) now flushes that write immediately instead of just flipping
the save-state flag. **What's still missing:** a real file story — download-
as-file, upload-a-file, cloud sync. `file.export.json` / `file.import.dxf`
in the command registry are still `mock` on purpose; IndexedDB is not a
substitute for a file the user can hand to someone else.

Watch for: the document is deeply immutable, which makes structural sharing easy
but means a careless command clones more than it should. Every `DocumentCommand`
in `documentCommands.ts` replaces whole pieces, never patches one in place —
`pattern/resolve.ts` and `pattern/nest.ts` cache on piece object identity, so a
mutated-in-place piece would go stale silently.

### 2. Geometry editing tools — first pass done

Moving geometry works. `selectTool` returns a drag gesture; the drag writes a
draft piece into `store/previewStore.ts` and the document is not touched until
pointerup, when one command lands on the stack. Points, segments and whole
pieces all move through the same path, and the inspector edits point X/Y, edge
line-vs-curve and per-edge allowance numerically through the same commands
(`store/geometryCommands.ts`).

**Shape editing works too.** Dragging a control handle on a selected edge
reshapes it (`setSegmentHandle`); double-clicking an edge splits it where you
click, alt-double-click drops a notch there, and a selected point can be
deleted, merging the edges that met there. An edge is Line, Curve or Arc; a
point is a corner or smooth, and that choice is the user's rather than a
property of how the seed happened to be built.

Three invariants hold the whole thing up, and all are cheap to break:

- **Handles travel with their points.** Cubic controls are absolute positions.
  `pattern/edit.ts` moves `control1` with `from` and `control2` with `to`;
  anything that skips this deforms the curve with no error. The test that
  catches it: a whole-piece move must leave every segment length *bit*-identical.
- **Pieces stay immutable.** Every helper in `pattern/edit.ts` returns a new
  piece, because `resolve.ts`, `nest.ts` and `seamAllowance.ts` all cache on the
  piece object.
- **Topology edits must carry their references.** Splitting or merging an edge
  changes which segment ids exist, and notches, measurements and the boundary
  all name them. `insertPointOnSegment` re-anchors notches onto whichever half
  now holds them; the commands rewrite `document.measurements` so a point of
  measure over a split seam still sums to the same length. Skip either and the
  breakage is silent — a measurement reads half a seam, or stops resolving.
- **Undo depends on the pure edits, not on the store.** Commands undo by
  restoring the piece captured before the edit, so an edit that mutated its
  input would make undo a no-op that *looks* like it worked. `npm run
  check:roundtrip` asserts immutability and determinism for every primitive in
  `pattern/edit.ts`, and checks the round trips that must be exact.
- **Arc length is not proportional to the curve parameter.** A notch at `t=0.5`
  is not halfway along the seam on anything but a straight edge. Converting
  between the two goes through `lengthAlongSegment` / `parameterAtLength`;
  multiplying by `segmentLength` is wrong and was wrong in a draft of the
  round-trip check before it was caught.

**Seam allowance is now a real offset.** `geometry/offset.ts` pushes each edge
along its outward normal, joins with a mitre (bevelling past the limit), trims
the loops that reflex corners create, and drops leftovers that end up too close
to the source. It takes per-edge distances, so `PieceSegment.seamAllowance`
overrides work. `npm run check:offset` verifies it against hand-derivable
answers — squares, an L, a slot narrower than twice the offset, and a circle.

`npm run check` runs all three self-check suites — curve, offset and
round-trip, 128 assertions. They are not a test framework and are not an
argument for adding one; they exist because this is the code whose mistakes look
plausible on screen and only show up in someone's cut file. `scripts/` carries a
small Node resolver hook so the checks can import the app's aliased,
extensionless source without a bundler or any dependency.

Still open here:

- **The offset returns one ring.** Outward offset of a simple closed outline
  stays connected, which is the seam-allowance case. Inward offset can split a
  shape into several rings; it returns `[]` instead. Anything needing true
  inward offset (facings, inner cut lines) needs the ring-splitting case.
- **Joins are mitre/bevel, never round.** Below plotting tolerance on flattened
  curves, visible only on a very sharp hard corner.
- **The cut line is a polyline, not curves.** Fine to draw and to cut; a DXF
  writer emitting curve entities would need Béziers re-fitted through it.
- **Merging two edges is exact only when it undoes a split.** `removePoint`
  recovers the split parameter from the join geometry (at a split, the two inner
  handles and the joint are collinear) and rescales the surviving handles by it,
  so insert-then-delete round-trips to floating-point noise. Merging two edges
  that were never halves of one curve falls back to arc-length share and is a
  genuine approximation — two cubics are generally not one cubic. Undo is the
  only exact way back.
- **The offset is O(n²) and it is now the bottleneck.** Trimming
  self-intersections compares every offset edge against every earlier one. On a
  seed piece (4–64 ring points) it is sub-millisecond; on a 120-segment outline
  with 1087 ring points it takes **~57 ms**. It is cached per piece object, so
  static viewing is fine — but a drag builds a new piece every frame, so
  reshaping a dense piece with the seam-allowance layer on will not hold 60 fps.
  A sweep-line or a uniform grid over the offset edges is the fix; nothing else
  in the kernel is close to this cost.
- Notches attach to a segment by parameter `t`, so they survive reshaping for
  free. Keep that property.
- Geometry near the top of the stage sits under the ruler overlay, which
  intercepts the pointer — a control handle up there cannot be grabbed until you
  pan. Pre-existing, but handles made it noticeable.
- Still missing from Design: drawing a piece from nothing, rotate, mirror, darts
  and grain editing. Those affordances have been **removed** from the tool dock
  and the selection toolbar rather than shown disabled — this list is where they
  are tracked now.

**Measurement accuracy is no longer tied to sampling.** Three things changed
together, and `npm run check:curve` pins all of them:

- `segmentLength` integrates |B'(t)| by composite Gauss–Legendre instead of
  summing flattened chords. Chords always cut corners, so the old value drifted
  with the sample count: splitting an edge made it *report* ~0.003 mm more even
  though the geometry had not moved, and every point of measure over that seam
  inherited it. Splitting now changes the reported length by ~2e-11 mm.
- Flattening is flatness-adaptive to `FLATTEN_TOLERANCE_MM` (0.1 mm). A gentle
  40 mm edge costs one sample where the fixed 16 steps spent sixteen; a quarter
  circle gets thirty-two. Seed outlines shrank by roughly 40% while getting
  *more* accurate on the curved parts, which also makes the O(n²) offset cheaper.
  **Samples are no longer evenly spaced in `t` — never infer a parameter from a
  sample index.**
- `nearestOnSegment` solves the closest point with a bracketing scan plus Newton
  on d/dt |B(t) − p|², so a click yields the true `t`. Picking, splitting and
  notch placement all read it, and all used to inherit the flattening's error.

**Nothing in the kernel now samples a fixed number of times.** The three
constants that used to are gone: quadrature doubles its interval count until two
estimates agree, flattening subdivides on flatness, and the nearest-point scan
sizes itself from the control polygon and refines *every* local minimum rather
than the deepest sample — a curve that doubles back has several, and the sampled
winner is not always the true nearest. Verified against a 400,000-sample brute
force on a hooked cubic, and on a 120-segment piece the solver is never worse
than brute force.

**Arcs are real.** `ArcGeometry` was in the union but every consumer fell
through to the chord: an arc *rendered as a straight line*, split into two
lines, and measured as its chord. Now length is `r·Δθ` exactly, the closest
point is an angle clamp, splitting keeps both halves arcs, and flattening honours
the sagitta. Line/Curve/Arc is a control on the selected edge. This matters
beyond tidiness — DXF, the format pattern CAD actually exchanges, expresses most
curved seams as arcs, so import would have hit this immediately.

### 3. Grading math

- `pattern/nest.ts` translates each point by its rule. A real solver moves points
  along construction lines, re-fits curves through the nest instead of dragging
  control handles, and keeps mating seam lengths equal across sizes.
- Keep the public surface — `gradePiece`, `nestPiece`, `gradeVectors` — so the
  overlay, drawer and inspector keep working while the internals change.
- The grade-rule model (rules shared across many points) is already the shape
  graders expect; it should not need changing.
- Once real, the mock anomalies in `features/grade/mockData.ts` become derived
  checks. Emit them as `Diagnostic` from `@/diagnostics`.

### 4. Fit workspace

The cheapest of the remaining workspaces, and a good one to do while grading
settles.

- `MeasurementLink` and `evaluateMeasurements` already exist and work. Fit mostly
  needs a UI over them plus a body-measurement table to compare against.
- Ease analysis is then arithmetic: finished measurement minus body measurement,
  per size.
- Walk-seam needs `segmentLength` (exists) plus mating-segment references —
  `PieceSegment.mateSegmentId` is already in the model and unused.

### 5. DXF parsing

- **Start by verifying the layer table.** `io/dxf/layerMapping.ts` ships with
  every binding marked `verified: false`, and `validateForExport` treats that as
  a blocking error. Check each against ASTM D6673 and against files exported by
  AccuMark, Optitex and Lectra. Do not skip this: wrong layer numbers are
  silently wrong in someone else's CAD.
- Export before import. We own the topology, so export is mostly emitting blocks
  and choosing a chord tolerance.
- Import is genuinely hard: DXF is a flat bag of geometry with no topology. Which
  points belong to which outline, which are corners versus curve controls, and
  which segment a notch sits on all have to be inferred by proximity.
  `describeImportPlan` lays out the seven steps; step 5 is where the difficulty
  lives. A converter that mis-attaches a notch is worse than no converter.

### 6. Review diffs

Depends on persistence, because there is nothing to diff against until documents
have versions.

- Diff at the model level, not the pixel level: compare points, segments,
  notches and metadata by id, and render the result on the canvas as an overlay.
- Findings from grading, DXF validation and review checks should all surface as
  the shared `Diagnostic` in `@/diagnostics` so one UI renders all three.

### 7. Local AI integration

Deliberately last: it is the only item that improves nothing structurally.

- Most recommendations are **not** model work. Seam-allowance mismatch, ease
  progression and notch-pairing are deterministic checks — write them as plain
  analysers first. They will be more accurate than a model and they can explain
  themselves.
- Reserve inference for judgement calls, and keep it local. `setAiProvider`
  throws on a remote provider unless `allowRemoteProviders(true)` is called
  first; that is the one place to audit before answering "can this app upload my
  patterns".
- `useRecommendations` is already async and discards stale responses, so real
  latency needs no UI change.

## Conventions

- **Workspaces** each own a folder under `features/` with a `<Name>Workspace.ts`
  module (the composition root) and an `index.ts` that only re-exports. They
  contribute `Context` / `Stage` / `Panel`, and optionally `Drawer`.
- **The model owns meaning, the canvas owns pixels.** Features mutate stores;
  `canvas/` renders whatever the stores hold. Features never draw.
- **Nothing calls a model or a file format directly.** `ai/` and `io/` are
  interfaces with swappable adapters.
- **Mock data lives in files named `mock.ts` or `mockData.ts`** and says so in a
  header comment. If it is not in one of those, it is real.
- Geometry is millimetres everywhere; unit conversion happens at the edges.
- Ids are opaque. Never parse them.

## Module map

```
apps/pds/src/
├── pattern/      Document model — schema + pure read helpers. No React.
├── diagnostics.ts  Shared severity/finding vocabulary.
├── canvas/       Camera, renderer, hit testing, tool layer.
├── commands/     Command registry. Plain TS, no UI knowledge.
├── store/        Zustand stores: document, selection, viewport, grade, UI.
├── features/     One folder per workspace.
├── components/   App shell and shared UI primitives.
├── io/           Format adapters. See io/README.md.
├── ai/           Assistant layer. See ai/README.md.
├── geometry/     Vectors, bounds, polygons, units.
└── styles/       Tokens and CSS.
```

## Things that will bite

- `pattern/resolve.ts` and `pattern/nest.ts` cache on piece identity via
  `WeakMap`. That is correct only while pieces are immutable. If an edit ever
  mutates a piece in place, both caches go stale silently.
- The nest overlay is built in `CanvasStage` behind a `workspace === 'grade'`
  check. That is the seam to generalise into an overlay registry if a second
  workspace needs to paint on the stage.
- `store/types.ts` imports `IconName` from `components/` — a type-only import, so
  no runtime edge, but the dependency points the wrong way. Worth moving
  `ToolDescriptor` into `features/` if the store grows.
- Every measurement, grade rule and anomaly in the seed refers to piece ids from
  `store/seedDocument.ts`. Replacing the seed breaks those references; they are
  not validated at build time.
