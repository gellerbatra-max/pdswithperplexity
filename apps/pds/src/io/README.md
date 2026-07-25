# `io` — file format adapters

Everything that reads or writes a pattern file lives here. The rest of the app
never touches a file format directly: it calls `exportDocument` /
`importDocument` and lets the registry pick an adapter.

```
io/
├── index.ts        Format registry + facade. Add a format by adding an adapter.
├── types.ts        FormatAdapter, FormatDescriptor, FormatId
├── errors.ts       FormatNotImplementedError, FormatParseError
├── json.ts         Native .pds.json — the only implemented format
└── dxf/            AAMA / ASTM DXF — scaffolded, not implemented
    ├── index.ts        Adapters for both flavours
    ├── types.ts        Flavour, options, entity kinds, ConversionIssue
    ├── layerMapping.ts Pattern concept ↔ DXF layer number
    ├── import.ts       Parser (not implemented) + describeImportPlan
    ├── export.ts       Writer (not implemented) + describeExportPlan
    └── validation.ts   Pre-flight checks — implemented
```

## What is and is not implemented

| Piece | State |
| --- | --- |
| Format registry, adapter interface | Implemented |
| Native JSON round-trip | Implemented |
| DXF layer mapping table | Written, **numbers unverified** |
| DXF export validation | Implemented and useful today |
| DXF group-code parser | **Not implemented** — throws |
| DXF writer | **Not implemented** — throws |

The two conversions throw `FormatNotImplementedError` rather than returning
something plausible. This is deliberate: a converter that half-works corrupts
patterns silently, and silent corruption in a cutting room is expensive. Nothing
here may return invented geometry.

## Why layer mapping is the centre of it

Apparel DXF — AAMA's convention and the ASTM D6673 standard that grew from it —
carries pattern *meaning* in the layer number, not the entity type. The same
polyline is a piece boundary on layer 1 and an internal line on layer 11. Both
directions therefore reduce to translating between our domain concepts and those
numbers, so the table lives in one place that import and export share.

**The layer numbers in `layerMapping.ts` are provisional.** They reflect common
industry practice but have not been checked against the ASTM text, and vendors
differ in the optional ranges. Every binding carries `verified: false`. Before
any real conversion ships, each must be confirmed against the standard and
against files exported by AccuMark, Optitex and Lectra, then flipped one by one.
`validateForExport` treats unverified bindings as a blocking error, so the
scaffolding refuses to pretend it is ready.

## The hard part, when someone picks this up

Export is the easier half: we own the topology, so there is nothing to infer.
The work is emitting blocks, choosing a chord tolerance for flattening curves,
and unit conversion.

Import is genuinely hard. DXF hands you a flat bag of geometry with no topology
— no notion that these points belong to that outline, that this point is a
corner rather than a curve control, or which segment a notch sits on. All of
that has to be inferred by proximity, and getting it subtly wrong is the failure
mode that matters. `describeImportPlan` lays out the seven steps; step 5, the
topology rebuild, is where the difficulty lives.

## Trying it now

The command palette has `Import DXF (AAMA/ASTM)` and `Export DXF (AAMA)`. Both
are marked `mock`. They walk the real scaffolding — the export one runs the real
validator against the open document — and report the current blockers rather
than doing anything. That keeps the wiring exercised and the gap visible.
