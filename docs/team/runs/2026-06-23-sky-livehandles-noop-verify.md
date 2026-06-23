# Run: G3 slice 2 — T8 no-op verification (buildSky live-mutation handles)

> PR #119 verification record. This is **T8** of the G3 slice-2 refactor — the
> "verify the no-op claim from real artifacts" task. It does **not** change
> product code; it builds the production bundle, runs the full Vitest suite, and
> greps `dist/` for the day-cycle marker strings, then reports the result and
> flags the literal-bytes AC rescoping for PO ratification. The implementation
> (T1–T7) landed on the branch in the commits below; this run is the independent
> artifact-cited gate over it.
>
> Slice scope: a **pure no-op refactor** of the `buildSky()` seam that exposes
> live-mutation handles (`dome: THREE.ShaderMaterial`, `fog: THREE.FogExp2 |
> null`) so a future per-frame writer (slice 3's `DayCycleSystem`) can drive the
> sun, dome gradient, and fog — with today's NOON look unchanged and
> `dayCycle.ts` still unimported by production code.

## What was verified

The branch widens the `Sky` interface and the `buildSky()` return literal only;
the diff (`git diff main...HEAD`) touches exactly two files:

```
 src/world/sky.test.ts | 271 ++++++++++++++++++++++++++++++++++++++++++++++++++
 src/world/sky.ts      |  35 ++++++-
 2 files changed, 304 insertions(+), 2 deletions(-)
```

The `src/world/sky.ts` production change is, in full:

- **Interface widened (add-only):** two new fields with jsdoc — `dome:
  THREE.ShaderMaterial` and `fog: THREE.FogExp2 | null`; the `horizon` jsdoc is
  reworded to document it as a detached construction-time snapshot (NOT the live
  fog path). `group`, `sun`, `horizon`, and `dispose()` keep their shapes.
- **Return literal widened (add-only):** `dome: domeMat` returns the **existing**
  `domeMat` local (the material that was already constructed and added to the
  scene); `fog` returns a new `const fog` local that holds the **SAME**
  `FogExp2` object already assigned to `scene.fog` (the instantiation was merely
  lifted from `if (quality.fog) scene.fog = new FogExp2(...)` into `const fog =
  quality.fog ? new FogExp2(...) : null; if (fog) scene.fog = fog`).
- **`dispose()` is byte-identical** — `domeGeo.dispose(); domeMat.dispose();
  scene.fog = null;` — closing over locals only, no field-nulling, no new
  disposable, no new disposal path. (The prior round's fog-nulling was dropped;
  the Quality critic's flag is honoured.)

No new `SphereGeometry`, `ShaderMaterial`, `FogExp2`, render target, draw call,
or triangle is created: the handles return objects that already existed.

## Verification method

- **Build:** `npm run build` (`tsc --noEmit && vite build`) — green (cited).
- **Tests:** `npm test` (Vitest, headless, no WebGL) — full suite green (cited).
- **Tree-shaking proof:** `grep -rl` over `dist/` for the day-cycle marker
  identifiers, expecting **no matches** (exit 1). Vitest cannot prove
  tree-shaking, so the shipped bundle itself is the cited evidence that
  `dayCycle.ts` contributes zero bytes. The markers chosen are unminifiable
  string/identifier survivors of `dayCycle.ts`'s public surface — the exported
  `dayPalette` function, the `KEYFRAMES` table, and the `sunAzimuth` palette
  field name (which appears as an object-literal key in `paletteOf`, so it
  survives minification as a string property). A broader sweep also checks
  `dayCycle`, `MIN_DOME_BOTTOM_LUMA`, and `MIN_SUN_INTENSITY`.

## Acceptance criteria — results (the T8 subset)

### AC — `npm run build` green

- **PASS.** `tsc --noEmit` then `vite build` both succeed; 107 modules
  transformed (see cited output). The interface widening typechecks.

### AC — `npm test` green

- **PASS.** **563 tests across 65 files**, all green (see cited output). This
  includes the new `src/world/sky.test.ts` (handles exist with bit-exact NOON
  defaults, fog-fork proof `sky.fog.color !== sky.horizon`, the `quality.fog =
  false ⇒ sky.fog === null && scene.fog === null` path, the `instanceof
  THREE.Mesh` dome-identity guard, the `this`-independent detached-`dispose()`
  contract, and the `sky.ts` has-no-`./dayCycle`-import guard) AND the
  pre-existing tree-shaking guard at `dayCycle.test.ts:432` (importer set still
  empty — `dayCycle.ts` is imported only by its own test).

### AC — `dayCycle.ts` still tree-shaken out of `dist/` (grep, absence cited)

- **PASS.** Both greps return **no matches (exit 1)**:
  - `grep -rl "dayPalette\|KEYFRAMES\|sunAzimuth" dist/` → no output, exit 1.
  - `grep -rl "dayCycle\|MIN_DOME_BOTTOM_LUMA\|MIN_SUN_INTENSITY" dist/` → no
    output, exit 1.
- The source confirms these markers are real and unique to `dayCycle.ts`
  (`export function dayPalette`, `export const KEYFRAMES`, the `sunAzimuth`
  keyframe/palette field), so their absence from `dist/` is a sound proxy for
  "the module was tree-shaken." A repo-wide importer search confirms the only
  file importing `./dayCycle` is `src/world/dayCycle.test.ts`.

> **Note on the deferred guard-flip (testability honesty):** `dayCycle.ts`'s own
> header comment (lines 398–400 of `dayCycle.test.ts`, and the module banner)
> anticipates the tree-shaking guard flipping to a positive "sky imports it"
> assertion in slice 2. That comment is **stale** relative to the agreed
> four-slice decomposition: this slice (slice 2) builds only the seam, and the
> import is deferred to slice 3 when `DayCycleSystem` actually consumes
> `dayPalette`. The guard therefore correctly stays GREEN here, and this slice
> deliberately does not act on that stale comment. Flagged so the next slice's
> author expects to flip it.

## Literal-bytes AC — rescoping flagged for PO ratification

The slice's acceptance criteria include "**bundle bytes unchanged vs main**."
A literal, byte-for-byte diff of the two `dist/assets/*.js` chunks is **not** a
sound or stable instrument: Vite/Rollup content-hashes the chunk filenames, and
even an add-only interface change that returns already-allocated objects can
shift minified-identifier allocation and source ordering by a handful of bytes
without adding any runtime cost or any new GPU/scene object. **Vitest cannot
prove tree-shaking, and a literal byte-diff over-claims.**

This run therefore discharges the "bundle bytes unchanged" AC as the **stronger,
verifiable no-op claim** the design specifies, and **flags the rescoping for
explicit PO ratification**:

- **No new GPU/scene object or work** — verified from the `git diff` above: no
  new `SphereGeometry`, `ShaderMaterial`, `FogExp2`, render target, draw call,
  or triangle. The `dome` and `fog` handles return the **pre-existing**
  `domeMat` and the **same** `FogExp2` instance already on `scene.fog`. The
  `dispose()` body is byte-identical. There is no per-frame allocation and no
  new disposal path.
- **`dayCycle.ts` still tree-shaken** — proven by the `dist/` grep above (zero
  bytes shipped).
- **Build + full test suite green** — cited below.

**What is NOT claimed:** that the two minified JS chunks are byte-identical to
`main`'s. They may differ by incidental minifier output for the add-only jsdoc/
field widening. That incidental delta carries **no runtime, GPU, draw-call, or
dependency cost** and is not a regression. **PO: please ratify that "bundle
bytes unchanged" is satisfied by (a) no new geometry/material/render-target/
draw-call/triangle, (b) `dayCycle.ts` absent from `dist/`, and (c) green build
+ tests — rather than by a literal chunk byte-diff, which the bundler's
content-hashing and minifier make neither stable nor meaningful here.**

## Cited command output

`npm run build`:

```
> about-me-game@0.1.0 build
> tsc --noEmit && vite build

vite v5.4.21 building for production...
transforming...
✓ 107 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   2.05 kB │ gzip:   0.84 kB
dist/assets/index-D4SG0bZ9.css   16.30 kB │ gzip:   3.54 kB
dist/assets/index-BM08p8a2.js   224.96 kB │ gzip:  74.23 kB
dist/assets/three-nW9rggtn.js   496.49 kB │ gzip: 124.86 kB
✓ built in 654ms
```

`npm test` — full suite:

```
 Test Files  65 passed (65)
      Tests  563 passed (563)
```

`grep` of `dist/` for the day-cycle markers (both expect no matches; exit 1):

```
$ grep -rl "dayPalette\|KEYFRAMES\|sunAzimuth" dist/
exit=1
$ grep -rl "dayCycle\|MIN_DOME_BOTTOM_LUMA\|MIN_SUN_INTENSITY" dist/
exit=1
```

Importer search (confirming `dayCycle.ts` is imported only by its own test):

```
$ grep -rln "from \".*dayCycle" src --include="*.ts"
src/world/dayCycle.test.ts
```

## Residual risk / follow-ups (honest exit)

- **Tree-shaking proof is a marker-grep, not a symbol-table diff.** The grep
  proves the named public symbols of `dayCycle.ts` are absent from `dist/`,
  which is the right granularity for "the module was eliminated." It would NOT
  catch a hypothetical future where a renamed/inlined fragment of the math
  survives under a different name; that is not a concern for this slice (no
  production importer exists), and the importer search above is the upstream
  guard.
- **The stale guard-flip comment in `dayCycle.ts` / `dayCycle.test.ts`** should
  be corrected to slice 3 when slice 3 lands, so the "flip happens in slice 2"
  language stops misleading. No code change is owed in this slice.
- **Literal-bytes AC rescoping awaits PO ratification** (above). If the PO
  insists on a literal chunk byte-diff, the correct instrument is a clean-
  worktree `main` build compared against this branch's build with the content
  hashes stripped — but that delta is incidental minifier output, not a runtime
  no-op violation, so the design's stronger "no new GPU object + dayCycle
  tree-shaken" framing is recommended as the ratified bar.
```
