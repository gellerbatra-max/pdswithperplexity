# `io` — file format adapters

Everything that reads or writes a pattern file lives here. The rest of the app
never touches a file format directly: it calls `exportDocument` /
`importDocument` and lets the registry pick an adapter.

```
io/
├── index.ts        Format registry + facade. Add a format by adding an adapter.
├── types.ts        FormatAdapter, FormatDescriptor, FormatId
├── errors.ts       FormatNotImplementedError, FormatParseError
├── json.ts         Native .pds.json — the only fully round-tripped format
└── dxf/            AAMA / ASTM DXF — import is real for what real files prove
    ├── index.ts        Adapters for both flavours
    ├── types.ts        Flavour, options, entity kinds, ConversionIssue
    ├── tokenizer.ts     ASCII group-code tokeniser (code/value pairs)
    ├── reader.ts        Format layer: token stream → raw entity records, no semantics
    ├── layerMapping.ts  Pattern concept ↔ DXF layer number, + fixture evidence
    ├── curves.ts        bulge / ARC / SPLINE → SegmentGeometry (spec-driven)
    ├── ruleTable.ts     Companion .RUL grade rule table → SizeRange/GradeRule
    ├── import.ts        Parser + topology rebuild — real; see scope below
    ├── export.ts        Writer — piece boundaries, real; + describeExportPlan
    └── validation.ts    Pre-flight checks — implemented, both directions
```

## What is and is not implemented

| Piece | State |
| --- | --- |
| Format registry, adapter interface | Implemented |
| Native JSON round-trip | Implemented |
| DXF layer mapping table | Written, **numbers unverified against ASTM D6673**; 6 bindings confirmed against real files, 4 **actively contradicted**, 2 untested. `npm run report:dxf` prints the current state |
| DXF export validation | Implemented and useful today |
| LWPOLYLINE | **Real** — read in the reader layer into the same `RawPolyline` record POLYLINE feeds (inline 10/20/42 vertex groups, closed flag, bulge on any vertex including the closing one), so chaining, cleaning and curve resolution are shared, not duplicated. Still synthetic-tested only: no vendor export on hand uses it |
| DXF reader/importer split | `reader.ts` knows the container format and entity group codes, nothing else — no layers, no units, no flips. `import.ts` owns every interpretation. Reader bugs are desyncs; interpretation bugs are wrong meaning; the split keeps a fix in one from quietly changing the other |
| DXF import (tokenizer, BLOCK/INSERT resolution, topology rebuild) | **Real**, scoped to what three real fixtures prove: boundary polylines including outlines split into head-to-tail chains, units from `$INSUNITS` / `Units:` (METRIC, IMPERIAL, ENGLISH), self-labelled `Key:Value` metadata, LINE kept as unclaimed construction geometry, and POINT entities read as notches and turn/curve markers |
| Companion `.RUL` grade rule table | **Real** — parsed into `SizeRange` + `GradeRule[]`, attached to points via the DXF's `# N` marks. Optional: absent, the geometry imports identically |
| DXF curve entities | **Real, but spec-driven rather than evidence-driven** — bulge and `ARC` reconstruct exactly, a degree-3 four-point `SPLINE` becomes an exact cubic, any other `SPLINE` is chorded to `FLATTEN_TOLERANCE_MM` and reported as approximated. Fixtures are synthetic; see below |
| DXF writer | **Real, for the piece boundary only.** R12 ASCII: HEADER/`$INSUNITS`, one BLOCK + POLYLINE per piece, one INSERT each. Arcs written as vertex bulges (exact, round-trip proven); cubics flattened to `FLATTEN_TOLERANCE_MM` and reported. Deterministic — byte-identical for the same document. Every concept it declines to write is reported per piece |

### The three fixtures, and what each one broke

`5109s-sp27-pattern.dxf` — 5 blocks, INSERT placement, `$INSUNITS` in inches,
boundary polylines and nothing else.

`tshirt-demo-aama.dxf` — 20 blocks (5 pieces × 3 sizes, a marker layout),
written by a different tool, declaring `ASTM/D13Proposal 1 Version:D 6673-04`.
It differs from the first in every way that exercises the parser: no
`$INSUNITS` at all, a `Units:METRIC` text field instead, `Key:Value` metadata
at both style and piece scope, LINE entities on two layers, TEXT on two more,
and `SEQEND` entities that carry trailing group codes.

That last one found a real bug. The polyline reader consumed `SEQEND`'s `0`
marker but not its fields, leaving a stray group code in the stream that the
block reader then read as an entity marker — reporting `entity "1" is not
supported` twenty times over. Fixture 1's `SEQEND` carries no trailing fields,
so a suite of one file could never have caught it. It is now
`check-dxf-import.ts` § 21, verified to fail against the pre-fix parser.

`8178v-accumark.dxf` + `8178v-accumark.rul` — Gerber AccuMark 12.0.0, 3 pieces,
8 sizes, shipped as a **pair**. It broke the biggest remaining assumption:
that a piece's outline is one polyline. Here each outline is a *chain* of 7–14
layer-1 polylines laid head-to-tail with zero gap, plus zero-length markers at
the junctions. Taking the first one — which is what the importer did — gave a
5-point piece where the file describes 41, and dropped a third piece entirely
when its first run was a 2-point stub. It also declares `Units: ENGLISH`
(inches, which fell through to millimetres and scaled everything by 1/25.4),
puts POINTs on layers 2/3/4, and names a grade rule at each graded point that
only the `.RUL` can resolve. All four are fixed and covered in §§ 24–29.

Import no longer throws unconditionally — see `importDxf` / `importDxfWithDiagnostics`
in `import.ts`. It still refuses rather than guessing: an entity kind it
doesn't recognise gets a warning naming it (or an error, under
`options.strict`) and is skipped, never silently dropped or reinterpreted.
Export is untouched and still throws `FormatNotImplementedError` — nothing
here may return invented geometry, in either direction.

LWPOLYLINE malformations are reported precisely rather than absorbed: vertex
fields arriving before any `10` opened a vertex are dropped and counted
(`lwpolyline-orphaned-fields` — inventing a vertex for them would be
fabricating geometry), a declared count (`90`) that disagrees with the data is
named (`lwpolyline-vertex-count-mismatch`), and an empty one is skipped
(`lwpolyline-empty`) so it cannot break the boundary chain behind it.

Three safety rules round out the reader (all synthetic-tested, § 30, since no
real file on hand misbehaves in these ways):

- **A boundary the file never closed is reported when the importer closes
  it.** Closure needs a source — a repeated end vertex (5109S, the AccuMark
  chains) or the polyline's closed flag (the TSHIRT writer sets the flag and
  does not repeat the vertex; group 70 is now read). A ring with neither
  still imports closed, because the model has no open pieces, but the closing
  edge is then the importer's invention and `boundary-closed-by-importer`
  says so, with the edge's length.
- **An INSERT's scale and rotation are applied** as a real affine transform —
  scale then rotate about the base point, then translate to the insertion
  point, which is DXF's own composition order. A negative scale is a mirror
  and reverses every sweep with it (bulge sign, arc handedness). Rotation is
  rigid, tested by every edge length surviving it. The transform is reported
  (`insert-transform-applied`), and z-scale is noted as dropped since this
  importer reads flat 2D.

  One case is still refused: a **non-uniform** scale over a block carrying
  circular-arc geometry. `ArcGeometry` holds a radius, and a non-uniform scale
  turns circles into ellipses, so importing it would mean faking the radius or
  silently chording the curve. `insert-transform-unrepresentable` drops that
  piece instead. On straight-line blocks a non-uniform scale is fine and is
  applied — lines and cubics map cleanly under any affine.
- **Self-contradicting metadata is called ambiguous.** A field stated twice
  with different values gets `metadata-field-conflict` naming both; an exact
  repeat stays silent. First statement still wins, as before.

### Curves: the one capability not built from a real file

Every other thing here was built after a real file proved what it looks like.
Curve support was not, and the reason is itself a finding: **125 real DXF
files were scanned — every apparel export on hand, across three CAD vendors —
and between them they contain zero `ARC` entities, zero `SPLINE` entities, and
not one non-zero bulge on a pattern polyline.** Apparel CAD pre-flattens. It
ships densely-sampled straight lines and leaves the receiving system to re-fit
curves if it wants them.

(Scanning for group code 42 alone is misleading, incidentally: it means bulge
on a `VERTEX`, view height on a `VPORT` and width factor on a `STYLE`. A naive
scan "finds" bulges in files that have none.)

So `curves.ts` is written against the DXF specification, its fixtures are
synthetic and labelled as such (`synthetic-curves.dxf.md`), and its tests check
against geometric definitions computed independently of the implementation —
a bulge arc's height against `sagitta = |bulge| × chord/2`, an arc's length
against `r·θ`, a tessellation's error by re-evaluating the curve it replaced.

What that buys: an importer that meets a curve reconstructs it exactly where
the model can hold it, chords it to a stated tolerance where it cannot, and
says which of the two happened. What it does not buy is the confidence the
rest of this module has. **When a real curve-bearing file turns up, treat it
as a test of this code rather than as routine input** — run `npm run
report:dxf` on it first.

The work also exposed a real bug in the straight-line path: a boundary of two
points was rejected as degenerate, which is right for chords and wrong the
moment a curve is involved — two points joined by a curve enclose area (a
lens; a circle written as two semicircular arcs). Fixed, and regression-tested.

### The writer writes one layer, and says why

`layerMapping.ts` holds twelve bindings, none verified against ASTM D6673: six
have real-file evidence, four are *contradicted* by a real file, two are
untested. Import can afford to read a contradicted layer and warn. Export
cannot — a wrong layer number leaves the mistake in someone else's cutting
room, and there is no diagnostic there to read it.

So the writer emits exactly one concept: `piece-boundary`, layer 1 — the only
binding with three independent vendor files agreeing on both the number and
the entity kind. Notches, grain, internal lines, construction points and
annotation are **not written**, and each is reported per piece
(`export-concept-not-written`) rather than a piece arriving silently stripped.
`includeSeamAllowance` and `includeGradedSizes` are refused the same way,
naming the contradicted binding that blocks each.

`validateForExport` now takes the set of concepts a write will actually use,
and the gate is scoped to those with two levels: a written concept with *no*
evidence is an error, a written concept observed in real files but unverified
against the standard is a warning on every export. Blocking a boundary export
because `drill-hole` is unverified would refuse a file for a risk it does not
carry.

Widening this is a data problem, not a code one — verify a binding, and the
concept it names is a few lines away.

## Why layer mapping is the centre of it

Apparel DXF — AAMA's convention and the ASTM D6673 standard that grew from it —
carries pattern *meaning* in the layer number, not the entity type. The same
polyline is a piece boundary on layer 1 and an internal line on layer 11. Both
directions therefore reduce to translating between our domain concepts and those
numbers, so the table lives in one place that import and export share.

**The layer numbers in `layerMapping.ts` are still provisional against the
standard.** `verified` stays `false` on every binding, including
`piece-boundary`, until each is checked against the ASTM D6673 text itself —
that flag means "confirmed against the standard," and two agreeing files are
not that, however real. Evidence is tracked in two weaker fields kept
deliberately apart from `verified`:

- `observedInFixtures` — a real file uses this layer for this entity kind.
  Six bindings now carry it: `piece-boundary` (three files), `grain-line`
  (two), and `turn-point`, `curve-point`, `notch` and `mirror-line` (one each,
  all from the AccuMark file).
- `conflictingEvidence` — a real file uses this layer for an entity kind the
  binding does not list. Four bindings carry it: `grade-reference` (layer 5
  holds `LINE`, not `POINT` — in **two unrelated files**, which is the
  strongest disconfirmation here), `drill-hole` (layer 8 holds everything
  except `POINT`), `stripe-reference` (layer 14 holds `POLYLINE`/`TEXT`), and
  `sew-line` (layer 15 holds `TEXT`). `piece-boundary` is on both lists: layer
  1 carries the boundary *and* one writer's metadata text.

Recorded, not acted on — a table rewritten to match whichever file arrived
last is worse than one that is honestly wrong in a documented way.
`importDxf` reports each conflict as a `layer-entity-conflict` warning, and
`npm run report:dxf` prints the whole evidence table.

**Notches are the one concept confirmed by geometry rather than entity kind.**
Layer-4 POINTs in the AccuMark file land *exactly* on the outline — 0.000mm —
which is what a notch is. They arrive paired with a second POINT a constant
7.00mm inside; that is what a notch *depth* marker looks like, but the file
never says so, so the on-seam point becomes the notch (at this app's own
default depth) and the inner one is reported with its measured offset rather
than read as a depth.

**Why the importer still won't read a grain line.** Layer 7 is the one place
the table and a real file agree on entity kind, and it is *still* not enough.
That same file puts an equally grain-shaped LINE on layer 5 — one full-width,
one inset, both horizontal, one per piece — and nothing available says which
is the grain. So both are imported as `InternalLine`s with role
`'construction'` and `cut: false`: geometry preserved exactly, meaning not
claimed. A piece cut off-grain is scrap, which makes this the one place where
guessing costs more than waiting.

Only `internal-line` (layer 11) and `annotation` (layer 13) remain untouched
by any real file. `validateForExport` still treats every unverified binding as
a blocking error for export, unchanged.

## The hard part, when someone picks this up

Export is still the easier half, still unstarted: we own the topology, so
there is nothing to infer. The work is emitting blocks, choosing a chord
tolerance for flattening curves, and unit conversion.

Import's hard part — inferring topology DXF doesn't carry — is smaller than
these docs once suggested, but not as small as two fixtures made it look. A
`BLOCK` is one piece and no fixture yet carries a curve entity, so "every
vertex is a corner joined by a straight line" is still the file's literal
content rather than an inference. But "its `POLYLINE` is the boundary" turned
out to be false: the AccuMark file writes each outline as a chain of 7–14
polylines, and the assumption cost a piece and 90% of another before a third
file exposed it.

The genuinely hard part is not parsing. It is knowing what a layer number
means, and each new file has made that picture sharper in both directions:
six bindings now have real-file backing, four are contradicted, and layer 5 is
contradicted *twice over by unrelated writers*. "Unverified" was a suspicion
two files ago; it is a measurement now.

**The next file should still have a curve in it** — but the question has
changed. Curve *support* now exists and is exercised by synthetic fixtures;
what is missing is a real file to confirm the spec reading matches what a
vendor actually writes. Since no apparel export on hand contains one, the
likeliest source is a file exported *for* apparel from general CAD
(Illustrator, Rhino, AutoCAD) rather than from a pattern system.

After that: a file that uses layer 11 or 13 (the last two untested bindings),
and a second `.RUL`-bearing style from a *different* CAD system, to show
whether the rule-table format is as stable as it looks. None of that replaces
the ASTM D6673 text, which is the only thing that can settle the four
contradictions — no quantity of vendor files can.

## Trying it now

**Import is a real workflow.** `Import DXF (AAMA/ASTM)…` in the command
palette opens a file picker and parses the chosen file into a review session
(`store/importStore.ts`): a dialog shows what would be imported, how every
layer was treated (imported / kept-unclaimed / metadata / skipped, plus where
the file contradicts the layer table), and the full diagnostic list — and
only its Apply button replaces the open document. The session survives the
apply; `Show last DXF import report` reopens it. The dialog renders from
`DxfImportResult.layers`, the structured per-layer account the importer
returns, not from re-parsing diagnostic strings.

**Export downloads a real file.** `Export DXF (AAMA) — piece boundaries`
writes the document and hands it to the browser as a download;
`Export PDS JSON` does the same through the app's own lossless format. Both
go through `store/exportCommands.ts`, which is where the one bit of download
DOM lives — `io/` stays pure so the Node check scripts can import it. The
filename is deterministic (style code, else document name, sanitised), so a
second export overwrites the first instead of accumulating `style (3).dxf`.
`Show what a DXF export would contain` reports the plan without writing.

A DXF export refuses exactly when the writer refuses; it does not
re-implement the gate, it asks it.

Two commands exercise the importer from the terminal:

```bash
npm run check:dxf --workspace=apps/pds
```

177 assertions across the three real fixtures (plus synthetic probes for the
safety rules no real file triggers). Expected values are
transcribed by hand from each fixture's raw group codes and re-derived
independently of `import.ts`, so a bug shared between the importer and its
test still fails.

```bash
npm run check:rul --workspace=apps/pds
```

24 assertions on the companion rule-table parser, kept separate because the
`.RUL` format is its own thing with its own failure modes. The load-bearing
one is the base-size column: a grade rule is displacement *relative to* the
sample size, so a non-zero there means misaligned columns or a wrong
`SAMPLE SIZE` header, and grading from it would move every point of every
piece — including the size that was meant to be the reference.

```bash
npm run check:curves --workspace=apps/pds
```

58 assertions on curve import — the only suite here running against synthetic
fixtures, for the reason given above. It also asserts the three real fixtures
still import with every segment straight and every point a corner, so curve
support stays provably inert on files that have no curves.

```bash
npm run report:dxf --workspace=apps/pds
```

The support matrix, live: per-fixture pieces/points/diagnostics, per-layer
treatment with table agreement, and the layer table's evidence state per
concept (verified / observed / contradicted / untested). Descriptive, not
enforcing — the place to look first when a new real file arrives.
