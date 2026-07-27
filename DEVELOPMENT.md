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
| Insert / delete outline point | Real — split is always exact; merge is exact for line+line, same-circle arc+arc, and collinear cubic+cubic (an undone split), an honest tangent-preserving approximation otherwise |
| Add / remove notch | Real — alt-double-click an edge, or remove from the inspector |
| Arc length + closest point | Exact — adaptive quadrature, multi-basin Newton solve |
| Circular arcs | Real — exact length, split, closest point; Line/Curve/Arc in the inspector |
| Point role (smooth / corner) | Real — inspector control, enforced on handles, shown on canvas |
| Numeric point + edge editing | Real — inspector writes through commands |
| Grading | Real — named sizes, a shared grade-rule table, per-point propagation, full rule/assignment CRUD as undoable commands, real diagnostics. See below; a real *solver* (construction-line-aware, seam-length-preserving) is still future work |
| DXF import | Real for what two production files prove — boundary polylines via BLOCK/INSERT, straight-line geometry, units from `$INSUNITS` or a `Units:` field, self-labelled `Key:Value` metadata, `LINE` kept as unclaimed construction geometry. Notches, drill holes, curves: not read, warned and skipped. Grain deliberately *not* claimed. Reachable from the UI: `Import DXF (AAMA/ASTM)…` picks a file, a review dialog shows the full account (per-layer treatment, table conflicts, diagnostics) before anything replaces the open document, and the session stays inspectable afterwards via `Show last DXF import report` |
| DXF export | **Not implemented** — throws |
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

`npm run check` runs all five self-check suites — curve, offset, round-trip,
grading and DXF import, 329 assertions. They are not a test framework and are
not an argument for adding one; they exist because this is the code whose
mistakes look plausible on screen and only show up in someone's cut file.
`scripts/` carries a small Node resolver hook so the checks can import the
app's aliased, extensionless source without a bundler or any dependency.
`check-dxf-import.ts` is the one suite that reads external files
(`scripts/fixtures/dxf/`) rather than building its fixture inline — two real
production DXFs, not synthetic ones, because parser correctness here means
"agrees with what a real exporter actually writes," which a hand-built fixture
cannot prove either way. The second file earned its place immediately by
exposing a `SEQEND` desync the first one structurally could not. `check-grading.ts` is the one suite that also
exercises the Zustand stores directly (not just pure
`pattern/` functions) — undo/redo exactness for a command is only provable by
running the real command through the real history stack.

Still open here:

- **The offset returns one ring.** Outward offset of a simple closed outline
  stays connected, which is the seam-allowance case. Inward offset can split a
  shape into several rings; it returns `[]` instead. Anything needing true
  inward offset (facings, inner cut lines) needs the ring-splitting case.
- **Joins are mitre/bevel, never round.** Below plotting tolerance on flattened
  curves, visible only on a very sharp hard corner.
- **The cut line is a polyline, not curves.** Fine to draw and to cut; a DXF
  writer emitting curve entities would need Béziers re-fitted through it.
- **Merging two edges is exact whenever the pair admits an exact merge.**
  `removePoint` checks three cases before falling back: two lines merge to a
  line; two arcs on the same circle (matching centre, radius, direction) merge
  to one arc spanning both sweeps; two cubics merge to one cubic when their
  shared handles are exactly collinear through the joint — the signature de
  Casteljau subdivision leaves behind, and the check that tells an undone split
  apart from two cubics that were drawn independently and merely happen to
  meet (a bare ratio-in-range check used to accept those too, which is a
  correctness bug, not just an approximation — a false claim of exactness).
  Anything else merges to an approximate cubic whose handles follow the *true
  tangent* of whatever was actually there (a line's own direction, an arc's
  exact tangent), never the chord between the two surviving points — arcs
  used to silently collapse straight to a `LINE` here, discarding real
  curvature rather than approximating it. Notches ride the same share as the
  geometry (the split ratio when exact, arc-length share otherwise — which is
  *itself* exact for lines and arcs, only cubics need the split ratio), so a
  notch no longer quietly drifts on an otherwise-exact merge. `npm run
  check:roundtrip` proves the exact cases bit-for-bit (segment geometry and
  notch parameter both) and the two traps (a non-collinear cubic pair, two
  arcs on different circles) that would fool a check that only tested ratios
  or geometry kind. Undo is the only exact way back from the approximate case.
- **The offset was O(n²); it is now a uniform spatial grid.** Both the
  self-intersection trim and the leftover-proximity filter used to compare
  every edge against every earlier one. `geometry/offset.ts` now indexes
  edges in a `SegmentGrid` sized to the locality of the problem — the offset
  distance for the proximity filter, average point spacing for the trim — so
  each edge only queries nearby cells. A 120-segment, 1087-point outline
  dropped from ~57 ms to ~3.5 ms, and `npm run check:offset` pins both a
  timing budget and sub-quadratic scaling so this cannot regress silently.
  Verified bit-identical against the old algorithm on every fixture plus dense
  stress shapes before the rewrite landed.
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

Two consumers had quietly missed this audit and were caught while hardening
`removePoint`: merging two arcs fell back to a straight `LINE` (see above), and
the notch renderer drew its inward tick perpendicular to the segment's *chord*
rather than the tangent at the notch's own `t` — invisible on a gentle curve,
wrong on a sharp one. Both now go through `tangentOnSegment`/`resolveArc` like
everything else here.

### 3. Grading — done, except the solver math itself

Grading is a real subsystem now: a named size range with a base size
(`SizeRange`), a shared grade-rule table (`GradeRule` — code, label, a
dx/dy `GradeIncrement` per size), and `PiecePoint.gradeRuleId` associating a
point to a rule. That model was already sound before this pass — it is the
industry-standard "X/Y grading" technique, not a placeholder — what was
missing was propagation correctness, a command layer, and real diagnostics.
All three are done:

- **Propagation** (`pattern/nest.ts`, `buildGraded`). Cubic handles move by
  *their own anchor's* delta — `control1` with `from`, `control2` with `to`,
  exactly like `pattern/edit.ts`'s `moveGeometry` — not the average of both
  endpoints, which used to pivot a curve toward whichever end graded less.
  Arc segments hold their radius constant while their endpoints move, which
  is a legitimate, deliberate policy (a bow keeping its own shape rather than
  scaling with the body), stated in the module doc and covered by
  `gradeDiagnostics` for when it stretches an arc past what its radius can
  reach. Notches need no special handling: they already ride a segment by
  parameter, so they survive a regrade the same way they survive a manual
  reshape.
- **Commands** (`store/gradeCommands.ts`). `createGradeRule`,
  `renameGradeRule`, `deleteGradeRule` (cascades — un-assigns the rule from
  every point on every piece that carried it, one document snapshot for
  undo since this is the one grading edit that can touch many pieces at
  once), `setGradeIncrement` (refuses to write a non-zero value at the base
  size — it is zero by definition), `setPointsGradeRule` (one or many points
  at once — assigning "shoulder width" to the same anatomical point across
  every piece in one action is the ordinary way a grader works). All go
  through `historyStore`, same as every other edit in this app.
- **Diagnostics** (`gradeDiagnostics` in `pattern/nest.ts`, replacing the
  hand-written list in the now-deleted `features/grade/mockData.ts`). Two
  real, exact checks, emitted as the shared `Diagnostic` from
  `@/diagnostics`: an arc whose graded chord opens past twice its radius
  (the one way the "hold the radius constant" policy can visibly fail), and
  a `mateSegmentId` pair whose graded lengths diverge past 1mm. Both are
  computed from the actual graded geometry, sized per size, not guessed.
- **UI**. `GradeContext`'s rule library is a real editor — inline code/label
  fields, add, delete. `GradePanel`'s point view assigns or clears a rule via
  a dropdown and edits that rule's per-size increments directly; the base
  row is fixed at zero. The dock lists only `Select`, because nothing here
  needed a distinct canvas tool — see `GradeWorkspace.ts`'s comment.

**What is still approximate, stated rather than hidden:**

- Grading is still per-point X/Y, not construction-line-aware. A point moves
  by its rule's raw offset; nothing here understands "this point stays on
  the centre-front line" or "this dart apex tracks the bust point." That is
  the real solver work — moving points along construction lines, re-fitting
  curves through the nest instead of translating handles — and it is a
  materially different, larger project than what shipped here.
- Nothing *enforces* equal mating-seam lengths across the range;
  `gradeDiagnostics` reports the mismatch, it does not correct it. Two
  independently-ruled pieces will not usually mate exactly at every size,
  which is the actual state of grading everywhere until a solver ties rules
  together.
- The size range itself (adding, removing, reordering sizes, changing the
  base) has no editor. `SizeRange`/`SizeDefinition` are plain data and a
  command would follow the same shape as `gradeCommands.ts`, but it does not
  exist yet — a real gap, not an oversight, and the smallest reason none of
  the above claims "done" without qualification.

### 4. Fit workspace

The cheapest of the remaining workspaces, and a good one to do while grading
settles.

- `MeasurementLink` and `evaluateMeasurements` already exist and work. Fit mostly
  needs a UI over them plus a body-measurement table to compare against.
- Ease analysis is then arithmetic: finished measurement minus body measurement,
  per size.
- Walk-seam needs `segmentLength` (exists) plus mating-segment references —
  `PieceSegment.mateSegmentId` is in the model; `gradeDiagnostics` now reads it
  to flag a length mismatch across the size range, but nothing yet visualises
  a walk seam-to-seam the way a Fit walk tool would.

### 5. DXF — import is real for two files' worth of production data; export is not

Two real production DXFs are the truth source for what this importer claims to
handle, replacing the "throws unconditionally" scaffold:

| Fixture | What it is | What it proves |
| --- | --- | --- |
| `5109s-sp27-pattern.dxf` | 5 pieces, BLOCK/INSERT, `$INSUNITS` in inches | Boundary polylines, placement, unit conversion, vertex-noise cleanup |
| `tshirt-demo-aama.dxf` | 20 blocks (5 pieces × 3 sizes), different writer, declares ASTM D6673-04 | No `$INSUNITS` (uses a `Units:` field), `Key:Value` metadata, `LINE` and `TEXT` entities, `SEQEND` with trailing fields |

What changed and what didn't:

- **`io/dxf/tokenizer.ts` (new) + `import.ts` (real).** ASCII group-code
  tokeniser, then a section/block/entity walker: `BLOCK`→candidate piece,
  `POLYLINE`/`VERTEX`/`SEQEND`→boundary, `INSERT`→placement, `$INSUNITS`→scale.
  Any entity kind the walker doesn't have a reader for is skipped safely (every
  DXF entity is delimited the same way, known or not) and produces a warning
  naming it — never a silent drop, never a crash. `options.strict` promotes
  those warnings to blocking errors.
- **The topology "inference" this section used to warn about turned out to be
  none, for this file.** A DXF `BLOCK` already *is* one piece; its `POLYLINE`
  already *is* the boundary. The file carries no curve entities at all — every
  edge is a densely-sampled straight-line polyline — so "every vertex is a
  corner joined by a line" is a transcription of the file's actual content, not
  a guess. What real vertex noise looked like: a consecutive duplicate point
  (zero-length segment, collapsed with a diagnostic) and, in two of the five
  pieces, a *non-adjacent* repeated vertex — a genuinely self-overlapping
  boundary, imported as-is and flagged by a new `validateImportedDocument`
  check (`self-overlapping-boundary`) rather than silently accepted or
  silently "fixed."
- **The layer table gained real evidence, not a rewrite.** `piece-boundary`
  (layer 1, `POLYLINE`) matches what `layerMapping.ts` already claimed. That is
  recorded in a new `observedInFixtures` field — deliberately *not* the same
  as flipping `verified: true`, which stays reserved for "checked against the
  ASTM D6673 text itself," which still has not happened for any binding.
- **Export is untouched.** Still `FormatNotImplementedError`, still gated on
  the (still unverified) layer table via `validateForExport`. Nothing about
  import proves export is safe to write — reading someone else's file and
  producing one a cutting room will trust are different risks.
- **`check-dxf-import.ts`** verifies every piece's geometry against a second,
  independent transcription of each file's raw group codes — not by calling
  back into the importer — plus determinism, a lossless round trip through
  the app's own JSON format, malformed-input handling, and a synthetic
  unsupported-entity case (a spliced-in `CIRCLE`, since neither real file
  contains one).

#### The second fixture, and what it changed

`scripts/fixtures/dxf/tshirt-demo-aama.dxf` — 20 blocks (5 pieces × 3 sizes, a
marker layout) from a different writer, declaring `ASTM/D13Proposal 1
Version:D 6673-04`. Chosen precisely because it is *not* another boundary-only
export. It differs on every axis that exercises the parser: no `$INSUNITS`, a
`Units:METRIC` text field instead, self-labelled `Key:Value` metadata at two
scopes, `LINE` on two layers, `TEXT` on two more, and `SEQEND` entities
carrying trailing group codes.

- **It found a real parser bug.** `readPolyline` consumed `SEQEND`'s `0`
  marker but not its fields, leaving a stray group code that the block reader
  then took for an entity marker — reporting `entity "1" is not supported`
  once per block. Fixture 1's `SEQEND` carries no trailing fields, so a
  one-file suite could never have caught it. Fixed by consuming the fields
  (same for `ENDBLK`), and `skipEntity` now names a stray group code as such
  instead of dressing it up as an entity. Regression-tested, and verified to
  fail against the pre-fix parser.
- **Metadata is now read where the file labels it.** `Piece Name:`, `Quantity:`,
  `Size Name:`, `Style Name:`, `Units:` and friends are parsed from `TEXT`
  entities of the form `Key:Value`. This is *reading*, not layer-semantics
  inference — the file names its own fields in English — but it is still a
  writer convention, so every value read this way is reported via
  `metadata-read-from-text` rather than presented as guaranteed. Unknown keys
  are left alone. `Quantity:1,0` is genuinely ambiguous (decimal comma, or a
  pair?) so only the first field is taken, which means 1 under both readings,
  and the rest is reported.
- **Units now have a ranked source**: `$INSUNITS`, else the file's own
  `Units:` field, else `options.assumeUnit`. The file's own statement beats
  the caller's assumption, which is tested.
- **`LINE` entities are kept as geometry with no meaning claimed.** They become
  `InternalLine`s with role `'construction'` and `cut: false`. This is the
  central judgement call of this slice: the table says layer 7 is the grain
  line and the entity kind agrees, but the same file puts an equally
  grain-shaped `LINE` on layer 5, and nothing available distinguishes them. A
  piece cut off-grain is scrap, so the geometry is preserved exactly and
  `piece.grainLine` is left undefined. Asserted in the tests, so a later
  change that starts claiming grain has to do it deliberately.
- **The layer table is now measurably wrong in three places**, not just
  suspected: layer 5 holds `LINE` (table says `POINT`), layer 15 holds `TEXT`
  (table says a polyline), and layer 1 holds metadata `TEXT` as well as the
  boundary. Recorded in a new `conflictingEvidence` field and reported per
  import as `layer-entity-conflict`. The numbers were **not** changed — one
  writer's habits are not the standard, and a table edited to match whichever
  file arrived last is worse than one honestly wrong in a documented way.
- **Layer reporting is now three-state.** Every (layer, entity) pair the file
  uses is reported as supported (and how it was treated: outline, construction
  geometry, or metadata), unsupported, or conflicting with the table.
- **A marker's repeated sizes are stated, not flattened.** The same piece
  recurs once per size; each placement imports as its own piece, and
  `sizes-imported-flat` says so. No graded size range is inferred — that would
  be grading, which this module does not invent.
- **What would unblock the next slice**: a file with a **notch** in it.
  Notches drive seam matching, the `Notch` model is already there, and neither
  fixture contains one, so the layer-4 binding is untested by anything. A file
  with a real curve entity (`ARC`, `SPLINE`, or `POLYLINE` bulge factors) is
  next most useful — both fixtures are densely-sampled straight lines, so the
  curve path has never run on real data. Failing either, the ASTM D6673 text
  would settle the three conflicts above, which no quantity of vendor files
  can.

#### The import workflow (how the parser is reached from the app)

Import is a reviewed workflow, not a document swap. `Import DXF (AAMA/ASTM)…`
in the palette opens a file picker; the chosen file parses into a *session*
(`store/importStore.ts`) that holds the document, every diagnostic, and the
structured per-layer account (`DxfImportResult.layers` — treatment plus
whether the layer table agrees, so the UI never re-parses diagnostic message
strings). The review dialog (`components/ImportReviewDialog.tsx`) shows all
of it — what would be imported, how each layer was treated, table conflicts,
diagnostics by severity — and only its Apply button touches the document
store (then resets history and fits the view). Blocking errors disable Apply
with the same rule `importDxf`'s throwing contract uses (`blocksConversion`).
A structurally unparseable file gets a failed session showing the parser's
own error; nothing is imported.

The session outlives the apply: `Show last DXF import report` reopens the
same dialog, because "what did that import skip?" usually gets asked later,
when a piece looks wrong on the stage. Closing the dialog keeps the session;
Discard drops it.

`npm run report:dxf` is the batch form of the same account: it runs the
importer over every fixture in `scripts/fixtures/dxf/` and prints the
per-file support matrix plus the layer table's evidence state (verified /
observed / contradicted / untested per concept). It is a report, not a check
— drop a new real file into the fixtures directory and run it to see exactly
what the importer makes of the file before writing a single assertion.

### 6. Review diffs

Depends on persistence, because there is nothing to diff against until documents
have versions.

- Diff at the model level, not the pixel level: compare points, segments,
  notches and metadata by id, and render the result on the canvas as an overlay.
- Findings from grading, DXF validation and review checks should all surface as
  the shared `Diagnostic` in `@/diagnostics` so one UI renders all three —
  `gradeDiagnostics` already does this for grading; DXF validation and review
  checks are the two still to bring in line.

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
