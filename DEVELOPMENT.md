# Development notes

What this scaffold is, what it deliberately isn't, and what to build next.

Every TODO in the source is tagged and points here. To see the backlog:

```bash
grep -rn "TODO(" apps/pds/src
```

## What is real, and what is staged

Being precise about this matters, because a scaffold that looks finished is a
trap. Nothing here fakes a result: unimplemented conversions throw, unbuilt
tools render disabled, and mock data is labelled at the top of its file.

| Area | State |
| --- | --- |
| Shell, workspaces, selection, command palette | Real |
| Pattern document model (`pattern/`) | Real |
| Canvas rendering, pan/zoom, picking, tool layer | Real |
| Measurement evaluation | Real — derived from geometry |
| DXF export validation | Real and useful today |
| Seam allowance rendering | **Fake** — a widened stroke, not an offset |
| Grading | **Fake** — a per-point translation, not a solver |
| DXF import/export | **Not implemented** — throws |
| Undo/redo | **Not implemented** — stub store |
| Persistence | **Not implemented** — in-memory only |
| AI recommendations | **Mock** — hand-written, no model |
| Fit, Prepare, Review workspaces | **Stubs** |

## Recommended implementation order

The ordering is driven by what unblocks what, not by what is most visible.

### 1. Document persistence and the command stack

**Do this first.** Every editing feature depends on it, and retrofitting undo
onto tools that already mutate state directly is a rewrite.

- `store/historyStore.ts` is a stub. Implement it as an **inverse-command
  stack**, not document snapshots — the document holds every piece, so
  snapshotting per keystroke will not hold up under a drag.
- Route every mutation through a command object that can undo itself. Today
  `documentStore` mutates directly; that is fine for a scaffold and wrong for an
  editor.
- Persistence itself is nearly free once commands exist: `io/json.ts` already
  round-trips the document losslessly and is versioned. Wire autosave to
  IndexedDB, then decide on the file story.

Watch for: the document is deeply immutable, which makes structural sharing easy
but means a careless command clones more than it should.

### 2. Geometry editing tools

Now that edits are undoable, the drafting tools become mechanical.

- `canvas/tools/` is designed for this: write a `CanvasTool`, call
  `registerTool`, and neither the canvas host nor the workspace modules change.
  Start by making `selectTool` return a drag gesture that moves points.
- **Polygon offset is the hard part.** Seam allowance is currently a widened
  canvas stroke, which is not an offset: it does not mitre corners, cope with
  self-intersection on concave curves, or produce a cut line that can be
  exported. Budget real time here, and treat it as a geometry library problem
  rather than a rendering one.
- `pattern/curve.ts` flattens at a fixed 16 samples per segment. Make it
  flatness-adaptive before the tools land — it over-samples short segments and
  visibly facets long ones, and it is on the hit-test path.
- Notches attach to a segment by parameter `t`, so they survive reshaping for
  free. Keep that property.

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
