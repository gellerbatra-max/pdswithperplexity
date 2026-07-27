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
    ├── layerMapping.ts  Pattern concept ↔ DXF layer number, + fixture evidence
    ├── import.ts        Parser + topology rebuild — real; see scope below
    ├── export.ts        Writer (not implemented) + describeExportPlan
    └── validation.ts    Pre-flight checks — implemented, both directions
```

## What is and is not implemented

| Piece | State |
| --- | --- |
| Format registry, adapter interface | Implemented |
| Native JSON round-trip | Implemented |
| DXF layer mapping table | Written, **numbers unverified against ASTM D6673**; `piece-boundary` confirmed empirically against *two* real files, and three other bindings **actively contradicted** by a real file (`conflictingEvidence`) |
| DXF export validation | Implemented and useful today |
| DXF import (tokenizer, BLOCK/INSERT resolution, topology rebuild) | **Real**, scoped to what two real fixtures prove: closed boundary polylines, straight-line geometry, units from `$INSUNITS` *or* a `Units:` text field, self-labelled `Key:Value` metadata, and LINE entities kept as unclaimed construction geometry |
| DXF writer | **Not implemented** — throws |

### The two fixtures, and why the second one mattered

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

Import no longer throws unconditionally — see `importDxf` / `importDxfWithDiagnostics`
in `import.ts`. It still refuses rather than guessing: an entity kind it
doesn't recognise gets a warning naming it (or an error, under
`options.strict`) and is skipped, never silently dropped or reinterpreted.
Export is untouched and still throws `FormatNotImplementedError` — nothing
here may return invented geometry, in either direction.

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
  `piece-boundary` (layer 1, `POLYLINE`) now has two, from different writers.
  `grain-line` (layer 7, `LINE`) has one, and that is *entity-kind* agreement
  only; see below.
- `conflictingEvidence` — a real file uses this layer for an entity kind the
  binding does not list. Three bindings now carry this: `grade-reference`
  (layer 5 holds `LINE`, not `POINT`), `sew-line` (layer 15 holds `TEXT`, not
  a polyline), and `piece-boundary` (layer 1 holds metadata `TEXT` as well as
  the boundary). Recorded, not acted on — a table rewritten to match whichever
  file arrived last is worse than one that is honestly wrong in a documented
  way. `importDxf` reports each as a `layer-entity-conflict` warning.

**Why the importer still won't read a grain line.** Layer 7 is the one place
the table and a real file agree on entity kind, and it is *still* not enough.
That same file puts an equally grain-shaped LINE on layer 5 — one full-width,
one inset, both horizontal, one per piece — and nothing available says which
is the grain. So both are imported as `InternalLine`s with role
`'construction'` and `cut: false`: geometry preserved exactly, meaning not
claimed. A piece cut off-grain is scrap, which makes this the one place where
guessing costs more than waiting.

The remaining concepts — turn points, curve points, notches, drill holes,
mirror line, internal lines, annotation, stripe reference — are unconfirmed by
*either* the standard or a real file. `validateForExport` still treats any
unverified binding as a blocking error for export, unchanged.

## The hard part, when someone picks this up

Export is still the easier half, still unstarted: we own the topology, so
there is nothing to infer. The work is emitting blocks, choosing a chord
tolerance for flattening curves, and unit conversion.

Import's hard part — inferring topology DXF doesn't carry — turned out to be
smaller than the docs here used to suggest, for the specific case real files
prove: a `BLOCK` *is* one piece, its `POLYLINE` *is* the boundary, and with no
curve entities in either file, "every vertex is a corner joined by a straight
line" isn't an inference at all, it's the file's literal content.

The genuinely hard part is not parsing. It is knowing what a layer number
means — and the second fixture made that harder rather than easier, by
contradicting the table in three places. That is still progress: "unverified"
was a suspicion before and is now a measurement. But it means notch, drill and
internal-line *semantics* are further from settled than a one-file regression
set made them look.

**The next file should have a notch in it.** Notches are the highest-value
unbuilt concept — they drive seam matching, the `Notch` model is already there
waiting, and neither fixture contains a single one, so the layer-4 binding is
untested by anything. A file with a real curve entity (`ARC`, `SPLINE`, or a
`POLYLINE` carrying bulge factors) is the next most useful, since both
fixtures so far are densely-sampled straight lines and the curve path has
never run against real data. Failing either, the ASTM D6673 text itself would
settle the three conflicts above, which no quantity of vendor files can.

## Trying it now

The command palette has `Import DXF (AAMA/ASTM)` and `Export DXF (AAMA)`. Both
are still marked `mock`, for the same reason on both sides but not the same
one: export has no writer yet, and import has a real parser but no file
picker wired up to hand it a payload. Both report their real plan/blockers —
export runs the real validator against the open document; import reports
`describeImportPlan`, which no longer claims there's no parser — rather than
doing anything, which keeps the wiring exercised and the actual gap visible.
`check-dxf-import.ts` is where the parser is actually exercised, against two
real files, until it's reachable from the UI:

```bash
npm run check:dxf --workspace=apps/pds
```

126 assertions. Expected values are transcribed by hand from each fixture's
raw group codes and re-derived independently of `import.ts`, so a bug shared
between the importer and its test still fails.
