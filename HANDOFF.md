# Handoff — resume here

State as of the last session. Delete this file once it stops being true.

```bash
cd "/Users/raveenl/Documents/Claude Code/pds with perplexity/.claude/worktrees/new-session-bc600c"
git branch --show-current    # expect: claude/new-session-bc600c
git status                   # expect: clean
npm run check --workspace=apps/pds   # expect: 591 assertions, all pass
```

Everything is committed and pushed. Nothing is half-finished.

## What exists now

Eleven commits on `claude/new-session-bc600c`, in order:

| | |
| --- | --- |
| `a7eabe7` | Exact merge/split geometry — merge is exact for line+line, same-circle arc+arc, collinear cubic+cubic |
| `a524ae0` | Real grading engine — named sizes, shared rule table, per-point propagation, undoable CRUD |
| `98582aa` | DXF import, fixture 1 (5109S) |
| `9de992d` | Fixture 2 (TSHIRT-DEMO) — found a SEQEND parser desync |
| `4b697d8` | Import as a reviewed workflow — session, review dialog, apply/discard |
| `ef18ed9` | Fixture 3 (8178V AccuMark) — chained outlines, POINT markers, `.RUL` grading |
| `c0310a2` | Curves — bulge, ARC, SPLINE |
| `f528fb6` | Reader/importer split, LWPOLYLINE |
| `2a3b581` | INSERT scale and rotation as a real affine |
| `a14731e` | DXF writer + file download (DXF and JSON) |
| `ee25f35` | Notch export on layer 4 |
| `270e789` | `$EXTMIN`/`$EXTMAX` drawing extents |

**Import** reads real vendor DXF: BLOCK/INSERT with transforms, boundary
polylines including outlines split into head-to-tail chains, units from
`$INSUNITS` / `Units:` (METRIC, IMPERIAL, ENGLISH), self-labelled `Key:Value`
metadata, POINT entities as notches and turn/curve markers, LINE as unclaimed
construction geometry, curves via bulge/ARC/SPLINE, and the companion `.RUL`
grade table.

**Export** writes deterministic R12 ASCII: header with `$INSUNITS` and extents,
one BLOCK and closed POLYLINE per piece, notch POINTs on layer 4, one INSERT
each. Arcs survive as bulges — round-trip proven exact against all three real
fixtures. Downloads from the palette, as does the lossless PDS JSON.

**Three real fixtures** live in `apps/pds/scripts/fixtures/dxf/`, from three
different CAD vendors. The synthetic curve fixtures are labelled as such in
`synthetic-curves.dxf.md`, and the reason is in there too.

## The one thing blocking almost everything else

`io/dxf/layerMapping.ts` holds twelve bindings and **none is verified against
the ASTM D6673 text**. Six have real-file evidence, four are actively
contradicted by a real file, two are untested. `npm run report:dxf` prints the
current state.

Import can afford to read a contradicted layer and warn. Export cannot, so the
writer emits only the two concepts real files evidence: `piece-boundary`
(layer 1, three files agree) and `notch` (layer 4, one file, confirmed by
geometry — its points land exactly on the outline).

The sharpest case is **grain**. Two files put a LINE on layer 7, matching the
table. The same file puts an equally grain-shaped LINE on layer 5. Nothing
available distinguishes them, and a piece cut off-grain is scrap. That is why
the importer imports both as unclaimed construction geometry and the writer
emits neither.

**This is a data problem. No amount of code moves it.**

## Next steps, honestly ranked

1. **Get the ASTM D6673 text**, or a file that disambiguates layer 5 from
   layer 7. This unblocks grain, then seam allowance, then most of the rest —
   each becomes a few lines against machinery that already exists. Highest
   value by a distance.
2. **A real curve-bearing or LWPOLYLINE-bearing file.** Both paths are
   spec-built rather than evidence-built; 125 files were scanned and not one
   apparel export contains a curve entity (they pre-flatten). The likeliest
   source is a file exported *for* apparel from general CAD — Illustrator,
   Rhino, AutoCAD.
3. **An export review dialog**, mirroring the import one. The writer already
   produces structured diagnostics that currently surface only as a one-line
   notification. This is UI work rather than format work — genuinely useful,
   and the only substantial item not blocked on data.
4. **Merge to `main`.** The branch is 14 commits ahead of `origin/main` and
   nothing has been merged. Worth deciding deliberately rather than letting it
   drift further.

Smaller, if you want something contained: a file picker for `.RUL` on its own
(currently only paired with a DXF), or `$LIMMIN`/`$LIMMAX` in the header.

## What to be careful about

`CLAUDE.md` in this directory has the traps in full — read it, it is short.
The two that have cost real time:

- Scripted edits containing `\x` escapes can write literal control bytes into
  source. It compiles and tests pass. Check with the snippet in `CLAUDE.md`.
- `git checkout <path>` reverts to HEAD and has already destroyed uncommitted
  work once in this project. Copy to `/tmp` and restore from there instead.

And the habit worth keeping: after writing a regression test, break the code on
purpose and confirm the test fails. It has caught vacuous tests twice here,
including one that could not detect a mirrored arc because it only checked
magnitudes.
