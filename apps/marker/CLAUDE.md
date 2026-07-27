# NestIQ Marker — Claude Code Instructions

This file is the single source of truth for this project.
Read it fully before writing any code. Never deviate from
the build order. Complete each step fully before moving to
the next. When a step is done, say "Step [N] complete ✓"
and wait for my confirmation before proceeding.

---

## Monorepo Context

This app lives inside an existing monorepo at the repo root.
The sibling app `apps/pds` is a Pattern Design Studio — do NOT
modify it. Study its patterns and follow them.

### What PDS already has (reuse these patterns, do not copy files):

| Module | Location | Reuse strategy |
|---|---|---|
| Geometry | `apps/pds/src/geometry/` | Import types (`Vec2`, `Bounds`) directly via relative path until packages/ are extracted |
| Canvas core | `apps/pds/src/canvas/` | Study the camera/grid pattern; write a fresh marker canvas following the same shape |
| Design tokens | `apps/pds/src/styles/` | Import the tokens CSS file directly |
| Zustand stores | `apps/pds/src/store/` | Follow the same store shape — one concern per file |
| Command registry | `apps/pds/src/commands/` | Follow the same plain-TS pattern |

### Pinned versions (exact, no ^ or ~):

| Package | Version | Note |
|---|---|---|
| react | 19.2.0 | per spec |
| react-dom | 19.2.0 | per spec |
| zustand | 5.0.8 | per spec |
| konva | 9.3.18 | per spec |
| dexie | 4.0.11 | per spec |
| vite | 7.3.6 | 7.1.0 has high-severity CVEs (path traversal, server.fs.deny bypass); 7.3.6 is the fixed resolved version |
| typescript | 5.9.3 | 5.9.0 was never published stable; 5.9.3 is the first stable 5.9.x |
| @vitejs/plugin-react | 5.0.0 | per spec |
| vitest | 3.2.7 | devDependency, add in Step 1. Below 3.2.6 is GHSA-5xrq-8626-4rwp (critical), which fails the Step 1 audit gate |

All packages in the `dependencies` block must be pinned exact — no `^` or `~`.
`devDependencies` may use `~` for patch-level flexibility only.

### Two hard rules from PDS that carry into ALL new code:

1. **Features never draw.** They mutate the store; `canvas/`
   renders whatever the store holds.
2. **Nothing calls a model or file format directly.** `io/` and
   `ai/` are interfaces with swappable adapters behind them.

---

## What We Are Building

`apps/marker/` — a standalone Vite + React 19 + TypeScript app
inside the same monorepo. It is a production marker-making tool
for apparel factories, modelled on Gerber AccuMark Easy Marking
but built as a modern local-first PWA.

The marker app must:
- Run entirely in the browser (no server required for core work)
- Save all customer data locally (IndexedDB via Dexie.js)
- Work fully offline via Service Worker
- Be installable as a PWA (desktop icon, standalone window)
- Export files Gerber AccuMark can open (AAMA DXF + RUL, HPGL)

---

## Target Folder Structure

```
apps/marker/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── CLAUDE.md                    ← this file
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── marker/                  ← Document model (no React, no side effects)
    │   ├── schema.ts            ← All TypeScript types
    │   ├── selectors.ts         ← Pure read helpers (utilization, etc.)
    │   └── migrations.ts        ← Schema versioning
    ├── store/
    │   ├── markerStore.ts       ← Document state
    │   ├── viewportStore.ts     ← Camera: zoom, panX, panY, scale
    │   └── uiStore.ts           ← Active tool, selection, dock visibility
    ├── canvas/
    │   ├── MarkerCanvas.ts      ← Konva stage manager (imperative, no React)
    │   ├── layers/
    │   │   ├── FabricLayer.ts   ← Static bg (Konva.FastLayer)
    │   │   ├── PieceLayer.ts    ← Interactive pieces (Konva.Layer)
    │   │   ├── OverlayLayer.ts  ← Defect zones, splice lines, violations
    │   │   └── UILayer.ts       ← Rulers, labels, cursor readout
    │   ├── tools/
    │   │   ├── DragTool.ts      ← Drag with collision bounce-back
    │   │   ├── SelectTool.ts    ← Click + marquee selection
    │   │   └── ButtSlideTool.ts ← Binary-search slide to collision
    │   └── collision/
    │       ├── aabb.ts          ← Broad phase (fast rectangle overlap)
    │       └── sat.ts           ← Narrow phase (SAT polygon + MTV)
    ├── features/
    │   ├── placement/           ← Interactive placement workspace
    │   ├── cutplan/             ← Cut Plan: demand → spreads
    │   └── cutsequence/         ← Cut sequencing + knife path
    ├── commands/                ← Marker command registry (plain TS, no React)
    ├── nest/
    │   ├── heuristic.ts         ← Bottom-Left Fill (runs in Web Worker)
    │   └── aiClient.ts          ← Stub for Phase 5 AI nesting API
    ├── io/
    │   ├── dxfImporter.ts       ← AAMA DXF + RUL parser
    │   ├── dxfExporter.ts       ← AAMA ZIP export
    │   ├── hpglExporter.ts      ← HPGL .plt cut data
    │   ├── markerJson.ts        ← Native .marker.json save/open
    │   └── workers/
    │       └── dxfWorker.ts     ← Web Worker for DXF parsing
    ├── db/
    │   └── database.ts          ← Dexie.js IndexedDB setup
    └── styles/
        └── marker.css           ← Imports PDS tokens + marker overrides
```

---

## Core Data Model

File: `apps/marker/src/marker/schema.ts`

**All coordinates are in CENTIMETRES.**
Origin 0,0 = bottom-left corner of fabric.
Width runs across (+Y), length runs along (+X).

```typescript
export interface MarkerDocument {
  id: string
  schemaVersion: 2
  name: string
  fabricWidth: number           // cm
  endAllowance: number          // cm, default 4
  rotationRule: 'strict' | '90ok' | 'free'
  cutterBuffer: 0 | 0.3 | 0.5 | 1  // cm
  pieces: PlacedPiece[]
  trayPieces: TrayPiece[]
  defectZones: DefectZone[]
  spliceLines: SpliceLine[]
  order: MarkerOrder
  approvalState: 'draft' | 'needs_approval' | 'approved'
  comparison?: ComparisonLayer
  createdAt: string             // ISO 8601
  updatedAt: string
}

export interface Point { x: number; y: number }

export interface PlacedPiece {
  id: string
  pieceDefId: string            // references TrayPiece.id
  name: string
  size: string
  bundle: string
  fabricCode: string            // max 4 chars, default 'A'
  geometry: Point[]             // polygon boundary in marker space (cm)
  position: Point               // translation applied to geometry
  rotation: number              // degrees, positive = CCW
  flipped: boolean              // horizontal flip
  placed: true
  cutSequence?: number
  bufferOverride?: number
  blocked: boolean              // whole bbox treated as solid obstacle
}

export interface TrayPiece {
  id: string
  name: string
  size: string
  bundle: string
  fabricCode: string
  geometry: Point[]             // polygon at origin, unplaced
  layDirection: '2way' | '4way' | 'free'
  quantity: number
  placed: number                // how many are currently on the marker
}

export interface MarkerOrder {
  model: string
  sizes: SizeEntry[]
}

export interface SizeEntry {
  size: string
  quantity: number
  fabricCode: string
}

export interface DefectZone {
  id: string
  x: number
  y: number
  width: number
  height: number
}

export interface SpliceLine {
  id: string
  x: number                     // position along marker length (cm)
}

export interface ComparisonLayer {
  markerName: string
  pieces: PlacedPiece[]
  opacity: number               // 0–1
  offsetX: number
  offsetY: number
  visible: boolean
}
```

---

## Key Computed Selectors

File: `apps/marker/src/marker/selectors.ts`

All pure functions — zero React imports, zero side effects,
zero Zustand access. Inputs are always a `MarkerDocument`.

```
markerLength(doc): number
  → max (piece.position.x + piece bounding box width) across
    all placed pieces, in cm

markerArea(doc): number
  → fabricWidth × markerLength

placedPieceArea(doc): number
  → sum of polygon areas via shoelace formula for all placed pieces

utilization(doc): number
  → (placedPieceArea / markerArea) × 100  — as a percentage

consumption(doc): number
  → (markerLength + endAllowance) / garmentCount  — in m/garment

garmentCount(doc): number
  → count of complete bundles where all TrayPiece quantities are placed

markerStatus(doc): 'MADE' | 'PARTIAL' | 'UNMADE'
  → MADE if all order pieces are placed
  → UNMADE if zero pieces placed
  → PARTIAL otherwise
```

Every function in this file must have a Vitest unit test.

---

## Canvas Architecture

**Use Konva.js DIRECTLY — not react-konva.**
React manages the UI shell. Konva manages the canvas imperatively.
This is non-negotiable: react-konva drops to ~9 FPS with 200+
pieces; direct Konva sustains 31+ FPS.

### Layer stack (bottom to top):

Konva 9.3 deprecates `FastLayer`; the non-interactive layers use
`new Konva.Layer({ listening: false })`, which is the same
optimisation without the console warning.

1. `FabricLayer` (`Layer`, listening off) — fabric rect, width guide
   lines, ruler ticks. Redrawn only on fabricWidth/zoom change.
2. `PieceLayer` (Konva.Layer) — one Konva.Group per placed piece
   containing polygon shape + label text. All drag events here.
3. `OverlayLayer` (`Layer`, listening off) — defect zones (red rect),
   splice lines (dashed vertical), violation outlines (red dash).
4. `UILayer` (`Layer`, listening off) — cursor coordinates, selection
   handles, marquee rectangle during drag-select.

### Performance rules — enforce always:

- **Viewport culling**: skip rendering pieces whose bounding box
  falls entirely outside the current camera view
- `piece.cache()` after placement; `piece.clearCache()` before drag
- `shadowForStrokeEnabled: false` on ALL shapes without exception
- `transformsEnabled: 'position'` on pieces that never rotate
- `stage.batchDraw()` after bulk operations (auto-nest, undo/redo)
- Never call `stage.draw()` inside a `requestAnimationFrame` loop —
  Konva's own animation system handles this

### Coordinate system bridge:

Marker space: origin 0,0 = bottom-left, Y increases upward (cm).
Konva space: origin 0,0 = top-left, Y increases downward (px).

`MarkerCanvas.ts` owns the transform — nowhere else:
```
konvaX = piece.position.x * scale + panX
konvaY = (fabricWidth - piece.position.y) * scale + panY
```

Features and tools always work in marker space (cm).
The renderer converts to Konva space. Never mix units.

### Piece transform order (canonical):

Horizontal flip first, then rotate counter-clockwise by
`piece.rotation`, then translate by `piece.position`.

Rendering, collision and nesting must all apply this order. Any
divergence puts a piece somewhere other than where it collides, and
the symptom — pieces overlapping only when flipped — reads as a
collision bug rather than a transform bug. `marker/selectors.ts`
already implements it.

---

## Collision Detection

File: `apps/marker/src/canvas/collision/`

Two-phase system, both operating in marker coordinates (cm):

### Phase 1 — AABB broad phase (`aabb.ts`):

Fast axis-aligned rectangle overlap. Expand each AABB by
`piece.bufferOverride ?? doc.cutterBuffer` on all sides.
If AABBs don't overlap → skip. Cost: O(n) per drag event.

### Phase 2 — SAT narrow phase (`sat.ts`):

Separating Axis Theorem on the actual polygon pairs.
Only runs when AABB reports overlap. Returns:
```typescript
interface CollisionResult {
  collides: boolean
  mtv?: { x: number; y: number }  // Minimum Translation Vector
}
```

During drag: apply the inverse MTV to snap the dragged piece to
just outside the collision boundary. Snap must feel instant —
no animation, no easing.

Check against: all other placed pieces + defect zones + fabric
boundary (x < 0, x > markerLength, y < 0, y > fabricWidth) +
splice lines (treated as full-height vertical walls).

---

## Heuristic Auto-Nest

File: `apps/marker/src/nest/heuristic.ts`

Runs inside a **Web Worker** — never on the main thread.
The UI posts a message and receives progress + result.

### Worker message protocol:
```
Main → Worker: { type: 'NEST', input: NestInput }
Worker → Main: { type: 'PROGRESS', percent: number }
Worker → Main: { type: 'RESULT', result: NestResult }
Worker → Main: { type: 'ERROR', message: string }
```

### Types:
```typescript
interface NestInput {
  pieces: TrayPiece[]
  fabricWidth: number
  placed: PlacedPiece[]     // existing pieces = obstacles
  defectZones: DefectZone[]
  spliceLines: SpliceLine[]
  effort: 1 | 2 | 3 | 4 | 5
}

interface NestResult {
  placements: Array<{
    pieceDefId: string
    position: Point
    rotation: number
    flipped: boolean
  }>
  utilization: number
  markerLength: number
}
```

### Algorithm — Bottom-Left Fill:

1. Sort pieces: largest bounding-box area first
2. For each piece, collect allowed rotations from `layDirection`
   (see the locked decision below)
3. Scan placement grid at step `= 1.0 / effort` cm, left-to-right
   then bottom-to-top, trying each rotation
4. First valid position (passes AABB + SAT vs all obstacles) = placed
5. Add placed piece to obstacle list and continue

### Locked decision — free rotation and effort

`× effort` subdivides the circle; it does not repeat the same angles.
Grain-constrained pieces ignore effort entirely: no amount of searching
makes it acceptable to cut a two-way piece off-grain.

| layDirection | Angles |
|---|---|
| `'2way'` | [0, 180] at every effort |
| `'4way'` | [0, 90, 180, 270] at every effort |
| `'free'` | `8 × effort` angles, evenly spaced from 0 |

So a free piece gets 8 angles at 45° (effort 1), 16 at 22.5°, 24 at 15°,
32 at 11.25°, and 40 at 9° (effort 5).

Effort therefore costs twice over — it subdivides the placement grid
*and* the angle set — so run time grows far faster than the number
suggests. `rotationsFor` in `nest/heuristic.ts` is the implementation.

---

## UI Layout

```
┌─────────────────────────────────────────────────────────┐
│  TOP BAR  52px                                          │
│  logo · workspace tabs · ⌘K · save indicator · undo    │
├──────┬──────────────────────────────────┬───────────────┤
│TRAY  │                                  │  RIGHT DOCK   │
│220px │         CANVAS                   │    282px      │
│      │  (Konva stage, full flex)        │               │
│pieces│                                  │  tabs:        │
│grouped                                  │  Piece        │
│by    │                                  │  Order        │
│size ×│                                  │  Options      │
│fabric│                                  │  Keys         │
├──────┴──────────────────────────────────┴───────────────┤
│  BOTTOM RIBBON  48px                                    │
│  fabric name · order chip · width field · length ·     │
│  utilization · consumption · status chip (MADE etc.)   │
├─────────────────────────────────────────────────────────┤
│  STATUS BAR  30px                                       │
│  colour-coded messages: info/ok/warn/error              │
│  warn + error persist until replaced — never auto-dim  │
└─────────────────────────────────────────────────────────┘
```

Tray: pieces grouped by name × size × fabric code. Each row shows
quantity badge (placed / total). Click to place at origin; drag
directly from tray to canvas position.

Right Dock:
- **Piece tab**: selected piece properties — name, size, bundle,
  fabric code, position (editable), rotation, flip state
- **Order tab**: order model, size/qty table, MADE/PARTIAL chip
- **Options tab**: fabric width, end allowance, cutter buffer,
  rotation rule, ply direction
- **Keys tab**: keyboard shortcut reference

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `R` / `Shift+R` | Rotate CW / CCW (respects lay direction) |
| `F` / `Shift+F` | Flip horizontal / vertical |
| `Arrow keys` | Nudge selected piece 1 cm |
| `Shift+Arrow` | Nudge selected piece 1 mm |
| `L` | Butt-slide left until collision |
| `U` | Butt-slide up until collision |
| `Delete` | Return selected piece to tray |
| `Shift+click` | Add/remove from selection |
| `Alt+click` | Select entire bundle |
| `Esc` | Cancel drag / deselect all |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `+` / `-` / `0` | Zoom in / out / fit marker to view |
| `N` | New marker dialog |
| `Ctrl+K` / `⌘K` | Command palette |
| `?` | Toggle Keys panel |

---

## DXF Import

File: `apps/marker/src/io/dxfImporter.ts`
Worker: `apps/marker/src/io/workers/dxfWorker.ts`

The importer MUST run inside a Web Worker — never on the main
thread. Large factory DXF files exceed 50 MB.

### Required capabilities:

1. AAMA/ASTM DXF + `.rul` grade-rule table parsing
2. `BLOCK`+`INSERT` recursive resolution (translate, rotate, mirror)
3. Chain-stitch: open `LINE`/`LWPOLYLINE` segments → closed loops
4. Duplicate layer deduplication (full geometry comparison)
5. Bulge arc tessellation (DXF bulge value → arc points)
6. Unit heuristic: if largest contour dimension < 25 → inches,
   else cm. Convert everything to cm on output.
7. `ATTRIB` metadata extraction: piece name, size, bundle code
8. Error resilience: missing block / circular reference →
   skip that piece + add to warnings array, continue parsing

### Worker message protocol:
```
Main → Worker:  { type: 'PARSE_DXF', dxfText: string, rulText?: string }
Worker → Main:  { type: 'PROGRESS', percent: number }
Worker → Main:  { type: 'RESULT', pieces: TrayPiece[], warnings: string[] }
Worker → Main:  { type: 'ERROR', message: string }
```

---

## Local Persistence

File: `apps/marker/src/db/database.ts`

All customer data stays on the user's machine. No backend
required for core functionality.

```typescript
import Dexie, { Table } from 'dexie'
import type { MarkerDocument } from '../marker/schema'

interface RestorePoint {
  id: string
  markerId: string
  label: string
  snapshot: MarkerDocument
  createdAt: string
}

class MarkerDatabase extends Dexie {
  markers!: Table<MarkerDocument>
  restorePoints!: Table<RestorePoint>

  constructor() {
    super('nestiq-marker')
    this.version(1).stores({
      markers: 'id, name, updatedAt',
      restorePoints: 'id, markerId, createdAt'
    })
  }
}

export const db = new MarkerDatabase()
```

Auto-save strategy:
- Debounce 2 seconds after any store mutation
- Save full `MarkerDocument` as JSON to IndexedDB
- Fire-and-forget — never block the UI for save
- Save a restore point before every Auto-Nest run
- Maximum 20 restore points per marker (delete oldest first)

---

## Security Rules (non-negotiable)

1. **Pattern geometry NEVER sent to any server.** If AI nesting
   is ever called, send ONLY bounding boxes `{x, y, w, h}` and
   rotation rules — never polygon points.

2. No secrets or API keys in the frontend bundle. Use
   `import.meta.env.VITE_*` environment variables only.

3. All production dependencies pinned with exact versions
   (no `^` or `~` in `dependencies` block of `package.json`).

---

## Coding Standards

- TypeScript strict mode. **No `any`**. No type assertions without
  an explanatory comment.
- Modules in `marker/`, `nest/`, `canvas/collision/` are **pure**:
  zero React imports, zero Zustand imports, zero side effects.
  Input in → output out. These are unit-testable without a DOM.
- React components are thin: read from store, render, dispatch
  commands. Zero business logic inside JSX files.
- One primary export per file. No barrel `index.ts` re-exports
  inside `src/` (only acceptable in `packages/`).
- Comments explain **why**, not what. Assume the reader knows
  TypeScript.
- Mark incomplete work with `// TODO(phase-N): description` —
  never silent stubs.
- Every selector in `marker/selectors.ts` and every algorithm in
  `nest/heuristic.ts` must have a Vitest unit test before that
  step is considered complete.

---

## Git Commit Rule (mandatory after every step)

After ALL verify checks for a step pass, run this exact command
before saying "Step [N] complete ✓":

```bash
git add apps/marker package-lock.json
git commit -m "feat(marker): step [N] — [short description]"
```

`package-lock.json` lives at the repo root but records marker's
dependency tree — stage it with every step, or a clean clone
cannot build.

Work each step on a branch (`feat/marker-step-N-...`). Once I
confirm the step, fast-forward `main` onto it and delete the branch.

Commit message format: `feat(marker): step N — description`
Examples:
- `feat(marker): step 1 — scaffold, vite+react+ts+konva+dexie`
- `feat(marker): step 2 — document model, selectors, migrations, tests`
- `feat(marker): step 3 — zustand stores (marker, viewport, ui)`

**Never leave a completed step uncommitted.**
If a verify check fails, fix it first — do not commit broken state.
Do NOT push unless I ask. Commit locally only.

---

## Build Order

Execute these steps in strict sequence. Do not start a step
until the previous one passes its verification check AND is committed.

### Step 1 — Scaffold
Create: `package.json`, `vite.config.ts`, `tsconfig.json`,
`tsconfig.app.json`, `tsconfig.node.json`, `index.html`,
`src/main.tsx`, `src/App.tsx` (empty div, no logic).

Use the exact versions from the "Pinned versions" table above.

✓ Verify: `npm run dev --workspace=apps/marker` serves a blank page
with no TypeScript errors.
✓ Verify: `npm run typecheck --workspace=apps/marker` exits 0.
✓ Verify: `npm audit --workspace=apps/marker` reports 0 vulnerabilities.
→ Commit: `feat(marker): step 1 — scaffold, vite+react+ts+konva+dexie`

---

### Step 2 — Document Model
Create: `src/marker/schema.ts` with all types from the
"Core Data Model" section above — fully typed, no stubs.
Create: `src/marker/selectors.ts` with all pure functions
from the "Key Computed Selectors" section above.
Create: `src/marker/migrations.ts` with a `migrate(raw: unknown)`
function that returns a `MarkerDocument` at schemaVersion 2.

✓ Verify: `npm run typecheck --workspace=apps/marker` passes.
✓ Verify: Vitest unit tests for all selectors pass.
→ Commit: `feat(marker): step 2 — document model, selectors, migrations, tests`

---

### Step 3 — Stores
Create: `src/store/markerStore.ts`
- State: `MarkerDocument | null` (null = no marker open)
- Actions: `loadMarker`, `updatePiece`, `addPiece`, `removePiece`,
  `setFabricWidth`, `addDefectZone`, `addSpliceLine`, `undo`, `redo`
- Undo/redo: command pattern, keep last 50 snapshots in memory

Create: `src/store/viewportStore.ts`
- State: `zoom: number, panX: number, panY: number`
- Actions: `setZoom`, `setPan`, `zoomToFit(markerLength, fabricWidth)`

Create: `src/store/uiStore.ts`
- State: `activeTool`, `selection: string[]`, `dockTab`, `statusMessage`
- Actions: `setTool`, `setSelection`, `addToSelection`,
  `clearSelection`, `setStatus`

✓ Verify: stores import without circular dependencies.
→ Commit: `feat(marker): step 3 — zustand stores (marker, viewport, ui)`

---

### Step 4 — Canvas Foundation
Create: `src/canvas/MarkerCanvas.ts`
- Class that accepts a container `HTMLDivElement`
- Creates a `Konva.Stage` with 4 layers in correct order
- Exposes `update(doc, viewport)` method called by React on store change
- Owns the cm→px coordinate transform (defined in "Canvas Architecture")

Create: `src/canvas/layers/FabricLayer.ts`
- Renders fabric rectangle (light grey fill)
- Renders dashed vertical line at `fabricWidth`
- Renders horizontal ruler ticks every 10 cm

✓ Verify: A hardcoded 150cm × 500cm fabric renders on screen.
✓ Verify: Zoom in/out with `+`/`-` keys works. Pan with middle-mouse works.
→ Commit: `feat(marker): step 4 — canvas foundation, fabric layer, zoom+pan`

---

### Step 5 — Piece Rendering + Drag
Create: `src/canvas/layers/PieceLayer.ts`
- One `Konva.Group` per `PlacedPiece`
- Group contains: `Konva.Line` (polygon), `Konva.Text` (name + size)
- Apply `piece.cache()` after first render
- Viewport culling: skip groups outside camera bounds

Create: `src/canvas/collision/aabb.ts`
Create: `src/canvas/collision/sat.ts`
Create: `src/canvas/tools/DragTool.ts`
- On drag: collision check vs all other pieces + fabric bounds
- On collision: apply inverse MTV (instant snap, no animation)
- On drag end: dispatch `updatePiece` to markerStore

✓ Verify: Seed the markerStore with 3 hardcoded test pieces.
✓ Verify: Drag a piece — it snaps correctly off other pieces and walls.
✓ Verify: No visible frame drops during drag.
→ Commit: `feat(marker): step 5 — piece layer, drag tool, AABB+SAT collision`

---

### Step 6 — UI Shell
Create all components in `src/components/`:
- `TopBar.tsx` — logo, undo/redo buttons, save indicator, ⌘K trigger
- `PieceTray.tsx` — scrollable list grouped by piece × size × fabric
- `BottomRibbon.tsx` — live utilization, length, consumption, status chip
- `RightDock.tsx` — tabbed: Piece / Order / Options / Keys
- `StatusBar.tsx` — colour-coded persistent message bar
- `App.tsx` — assembles layout per the spec in "UI Layout" section

✓ Verify: Full layout renders with tray, canvas, dock, ribbon, status bar.
✓ Verify: All ribbon values update live when a piece is dragged.
→ Commit: `feat(marker): step 6 — UI shell (topbar, tray, ribbon, dock, statusbar)`

---

### Step 7 — DXF Import
Create: `src/io/workers/dxfWorker.ts`
Create: `src/io/dxfImporter.ts` (orchestrates the worker)

Implement all 8 capabilities listed in the "DXF Import" section.
Use drag-and-drop onto the canvas as the entry point.

✓ Verify: A basic AAMA DXF file loads and all pieces appear in the tray.
✓ Verify: UI remains responsive during parse (worker is off main thread).
→ Commit: `feat(marker): step 7 — DXF import worker, AAMA parser`

---

### Step 8 — Save / Load
Create: `src/db/database.ts` (Dexie setup)
Create: `src/io/markerJson.ts` (serialise/deserialise MarkerDocument)

Wire auto-save: subscribe to markerStore changes, debounce 2s,
write to IndexedDB. On app load, show the last-opened marker.

✓ Verify: Place pieces → close tab → reopen → all pieces are restored.
✓ Verify: Save indicator in top bar reflects saved/unsaved state.
→ Commit: `feat(marker): step 8 — IndexedDB persistence, auto-save, restore points`

---

### Step 9 — Auto-Nest
Create: `src/nest/heuristic.ts` (algorithm)
Create a `NestWorker` that wraps it with the message protocol.
Wire to an "Auto-Nest" button in the top bar with a progress bar.

✓ Verify: Auto-nest places a 10-piece order onto the fabric.
✓ Verify: Utilization reported in ribbon is > 60%.
✓ Verify: UI does not freeze during nesting.
→ Commit: `feat(marker): step 9 — bottom-left fill auto-nest worker`

---

### Step 10 — Export
Create: `src/io/dxfExporter.ts` — AAMA DXF R12 export
Create: `src/io/hpglExporter.ts` — HPGL `.plt` cut data

Wire to export buttons in the right dock Options tab.

✓ Verify: Exported DXF opens correctly in any DXF viewer.
✓ Verify: HPGL file contains correct PU/PD commands at 1 plu = 0.025mm.
→ Commit: `feat(marker): step 10 — AAMA DXF + HPGL export`

---

### Step 11 — Tools + PWA

The folder structure names `SelectTool` and `ButtSlideTool` and the
Keys tab lists shortcuts, but no step built them. The PWA requirements
at the top of this file had no step either. This closes both.

**Part A — tools and shortcuts**

Create: `src/canvas/tools/SelectTool.ts`
- Marquee drag-select, rubber-band rectangle drawn on the UILayer
- Shift+click adds to / removes from the selection
- Alt+click selects the whole bundle

Create: `src/canvas/tools/ButtSlideTool.ts`
- `L` slides the selected piece left until it collides
- `U` slides it up until it collides
- Binary search, bisecting to 0.1 mm

Wire every shortcut in the Keys tab that is not yet implemented.

**Part B — PWA**

- `vite-plugin-pwa` with Workbox, precaching all build assets
- Web app manifest: name, icons (at least 192×192 and 512×512),
  `display: standalone`, background and theme colour from the design
  tokens
- The app must open in a standalone window and work fully offline

✓ Verify: every keyboard shortcut in the Keys tab works.
✓ Verify: Lighthouse PWA score ≥ 90.
✓ Verify: 267+ tests still pass.
→ Commit: `feat(marker): step 11 — SelectTool, ButtSlideTool, keyboard shortcuts, PWA`

---

## Replying to Claude After Each Step

After Claude says "Step [N] complete ✓", reply with:

```
Step [N] confirmed. Continue to Step [N+1].
```

If there are issues, describe them and Claude will fix before committing.

---

## When Resuming After a Context Reset

When starting a new Claude Code conversation on this project,
always begin with:

> "Read apps/marker/CLAUDE.md fully. I am continuing from Step [N].
> Here is the current directory listing: [paste `find apps/marker/src -type f`].
> The last git commit was: [paste `git log --oneline -5`].
> Continue from where we left off."

The architecture lives in this file — not in chat history.
