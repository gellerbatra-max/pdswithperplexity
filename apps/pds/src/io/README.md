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
    ├── layerMapping.ts  Pattern concept ↔ DXF layer number
    ├── import.ts        Parser + topology rebuild — real; see scope below
    ├── export.ts        Writer (not implemented) + describeExportPlan
    └── validation.ts    Pre-flight checks — implemented, both directions
```

## What is and is not implemented

| Piece | State |
| --- | --- |
| Format registry, adapter interface | Implemented |
| Native JSON round-trip | Implemented |
| DXF layer mapping table | Written, **numbers unverified against ASTM D6673**; `piece-boundary` additionally confirmed empirically against one real file (`observedInFixtures`) |
| DXF export validation | Implemented and useful today |
| DXF import (tokenizer, BLOCK/INSERT resolution, topology rebuild) | **Real**, scoped to what `scripts/fixtures/dxf/5109s-sp27-pattern.dxf` proves: closed boundary polylines, straight-line geometry, unit conversion via `$INSUNITS`. Notches, grain, internal lines, curves and every other layer concept still produce an explicit warning and are skipped — no real file has exercised them yet |
| DXF writer | **Not implemented** — throws |

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
that flag means "confirmed against the standard," and one real file is not
that, however real. What one real file *did* confirm: `piece-boundary` (layer
1, `POLYLINE`) matches what `layerMapping.ts` already claimed, which is now
recorded in that binding's `observedInFixtures`, a separate and weaker form of
evidence kept deliberately apart from `verified` rather than folded into it.
The other ten concepts — turn points, notches, grain, internal lines, drill
holes, mirror line, grade reference, annotation, stripe reference, sew line —
remain unconfirmed by *either* the standard or a real file, because the one
file available so far is a plain boundary-only export that doesn't use them.
`validateForExport` still treats any unverified binding as a blocking error
for export, unchanged.

## The hard part, when someone picks this up

Export is still the easier half, still unstarted: we own the topology, so
there is nothing to infer. The work is emitting blocks, choosing a chord
tolerance for flattening curves, and unit conversion.

Import's hard part — inferring topology DXF doesn't carry — turned out to be
smaller than the docs here used to suggest, for the specific case a real file
proves: a `BLOCK` *is* one piece, its `POLYLINE` *is* the boundary, and with no
curve entities in the file, "every vertex is a corner joined by a straight
line" isn't an inference at all, it's the file's literal content. The genuinely
hard part is everything import.ts's module doc calls out as still missing:
notches, grain, internal lines and curves each need a real file that actually
contains them before anything is built for them — guessing at their entity
shape from the ASTM text alone is exactly the "silently wrong in someone else's
CAD" failure this module exists to avoid.

**The next file to get would ideally *not* look like this one.** A file that
uses more than one layer, carries notches, a grain line, or an actual curve
entity would immediately prove (or disprove) the next slice of
`layerMapping.ts` and extend `check-dxf-import.ts` past a regression set of
one. A second copy of a similarly boundary-only export would not move this
forward much.

## Trying it now

The command palette has `Import DXF (AAMA/ASTM)` and `Export DXF (AAMA)`. Both
are still marked `mock`, for the same reason on both sides but not the same
one: export has no writer yet, and import has a real parser but no file
picker wired up to hand it a payload. Both report their real plan/blockers —
export runs the real validator against the open document; import reports
`describeImportPlan`, which no longer claims there's no parser — rather than
doing anything, which keeps the wiring exercised and the actual gap visible.
`check-dxf-import.ts` is where the parser is actually exercised, against a
real file, until it's reachable from the UI.
