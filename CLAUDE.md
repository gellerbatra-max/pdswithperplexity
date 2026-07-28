# Working in this repo

Canvas-first apparel Pattern Design System. React 19, TypeScript strict, Vite,
Zustand, HTML Canvas 2D, npm workspaces. The app is `apps/pds`.

`DEVELOPMENT.md` is the real map — what is built, what is staged, and why, in
implementation order. Read it before planning anything substantial. This file
is the short version: where the work lives, how to check it, and the traps
that have actually cost time.

## Where the work is

**Active branch `claude/new-session-bc600c`, in a git worktree**, not in the
main checkout:

```bash
cd "/Users/raveenl/Documents/Claude Code/pds with perplexity/.claude/worktrees/new-session-bc600c"
```

Open a terminal in the main repo directory and you will be on `main`, which is
14 commits behind and has none of this work. Check with `git branch --show-current`
before doing anything.

## Verifying

```bash
npm run check --workspace=apps/pds
```

591 assertions across eight suites (curve, offset, round-trip, grading, DXF
import, DXF export, DXF rule table, DXF curves). Run `npm run typecheck` and
`npm run build` too before calling anything done. There is no test framework
and adding one is not the goal — these are hand-rolled `check(name, ok, detail)`
scripts under `apps/pds/scripts/`, run through Node's `--experimental-strip-types`.

```bash
npm run report:dxf --workspace=apps/pds
```

Descriptive, not enforcing: runs the importer over every fixture and prints the
support matrix plus the layer table's evidence state. **Run this first when a
new DXF file arrives** — it tells you what the importer makes of it before you
write a line.

## The standard this codebase holds itself to

The DXF work is evidence-driven, and that is the whole character of it. The
rules, in order of how much trouble breaking them causes:

1. **Never invent geometry.** If the file does not say it, do not write it.
   Refuse, or warn and skip — never guess and stay quiet. A wrong import is
   recoverable; a wrong *export* ends up in someone's cutting room.
2. **Build from evidence, not from the spec alone.** Nearly every capability
   here was added only after a real file proved what it looks like. The two
   exceptions (curve support, LWPOLYLINE) are labelled as spec-built in their
   own module docs, and their fixtures are marked synthetic.
3. **Say what you did not do.** Every skipped entity, dropped concept and
   approximation is a named diagnostic. Silence is the failure mode.
4. **`verified` means checked against the ASTM D6673 text.** No binding is.
   `observedInFixtures` (a real file agrees) and `conflictingEvidence` (a real
   file disagrees) are separate, weaker fields. Do not conflate them, and do
   not renumber the layer table to match whichever file arrived last.

## Traps that have actually bitten

- **`python -c` heredocs collapse escape sequences into real bytes.** Writing
  `\x00` in a scripted edit can put a literal NUL in the source. It compiles,
  the tests pass, and the Read tool renders it as a blank — the only signal is
  `git diff --stat` reporting `Bin`. This happened twice. Prefer the Edit tool
  for anything containing escapes; if you must script it, check afterwards:

  ```bash
  python3 -c "
  import glob
  bad=[p for p in glob.glob('apps/pds/src/**/*.ts',recursive=True) if any(b<9 or 11<=b<=12 or 14<=b<=31 for b in open(p,'rb').read())]
  print(bad or 'clean')"
  ```

- **Never `git checkout <path>` to undo a scratch edit.** It reverts to HEAD,
  not to your last good state, and will silently destroy uncommitted work.
  Copy the file to `/tmp` first and restore from there.

- **Y-flip handedness.** DXF is y-up; piece space is y-down. `ArcGeometry.clockwise`
  is read in the frame its endpoints are in, so the reflection and the frame
  change *cancel* — do not "compensate" by flipping the flag. Getting it wrong
  leaves radius, chord and sagitta all correct while mirroring the curve, so it
  survives any test that checks only magnitudes. Pin an absolute apex position.

- **Dev server name collisions.** `preview_start({name:'pds'})` can attach to a
  stale server from a different worktree. Start vite on a distinct port and
  pass a `url` instead.

## Working style that has paid off here

- **Verify the premise before building on it.** More than one task in this
  project described behaviour that did not exist. Check `git log` and read the
  files before accepting a brief's framing.
- **Prove tests are load-bearing.** After writing a regression test, break the
  code deliberately and confirm the test catches it. This has caught genuinely
  vacuous tests twice, including one where a magnitude check could not detect a
  mirrored arc.
- **Prefer measurement to assertion.** "Byte-identical" claims in this repo are
  made by hashing output against the previous commit, not by reasoning.
