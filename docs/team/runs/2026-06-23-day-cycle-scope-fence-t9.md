# Run: G3 "Living sky" — T9 scope-fence confirmation + run log

> **Feature:** G3 "Living sky" — a thin `DayCycleSystem` per-frame writer that
> connects the already-shipped pure `dayPalette(t)` math to the live
> `sky.sun` / `sky.dome` / `sky.fog` handles, so the world gently loops
> dawn → noon → golden dusk → soft evening → dawn at zero new geometry, draw
> calls, or asset bytes.
>
> **This task — T9:** confirm the **scope fence** holds (TextView / no-WebGL
> path untouched, **zero** audio coupling, **no** new UI control), pin it with a
> guard test, and write this run log. T9 changes no runtime behaviour; it adds
> one meta-test (`src/world/dayCycle.scope.test.ts`) that fails red if a future
> edit widens the blast radius, and records the artifact-cited verification.
>
> **Branch:** `feat/g3-day-cycle-system` (commits below). Implementation
> (T1–T8) had already landed; T9 is the independent scope gate over it.

## What T9 verifies (the three fence claims)

### 1. TextView / no-WebGL path is untouched

`DayCycleSystem` is constructed in **exactly one place** — `buildWorld()`
(`src/world/buildWorld.ts:104`) — which is reached **only** by the WebGL path:

```
App.tsx                       (switch on screen.kind)
 ├─ case "playing"  → GameCanvas → buildGame → buildWorld → new DayCycleSystem(…)
 └─ case "textView" → TextView                          (never mounts GameCanvas)
```

- `App.tsx` renders `<TextView>` and `<GameCanvas>` as **mutually exclusive**
  branches of one `switch` (conditional, not CSS-hidden), so the text view never
  mounts the canvas. `GameCanvas` is the **only** caller of `buildGame` (the
  only caller of `buildWorld`), and it is WebGL-gated: a device with no usable
  context sets `webglError` and renders the `.webgl-fallback` message pointing
  at the text view (`GameCanvas.tsx:112–122, 293`). So `DayCycleSystem` exists
  **only** when a live WebGL world is built — never on the TextView / no-WebGL
  path.
- **Cited:** `grep "buildWorld("` → one production call site, `buildGame.ts:66`.
  `grep "buildGame("` → one production caller, `GameCanvas.tsx:81`. The diff
  touches **no** file under `src/ui/`.
- **Existing TextView tests run unchanged and GREEN** — `src/ui/TextView.test.tsx`
  (3 tests) passes with no edits.

### 2. Zero audio coupling

The day cycle and the audio bed are **independent live snapshots** that never
read each other:

- `DayCycleSystem` imports only `three`, `engine/types`, `buildWorld`'s
  `ReducedMotionSource` type, `dayCycle` (`dayPalette` / `GOLDEN_T`), and
  `worldConfig`. It imports **nothing** from `src/audio/`. (`grep` over
  `src/audio/` for `dayCycle` / `DayCycle` / `sunElevation` / `domeTop` /
  `PERIOD_SECONDS` / `GOLDEN_T` → **no matches**.)
- `AudioSystem` is constructed **separately** in `buildGame.ts` and keyed off
  `discovery.store` (discovered-count → SFX) and a `MutedSource`
  (`getSnapshot().muted`) only. Its `update(_ctx)` **ignores the frame context**
  — the ambient bed starts once when the world first runs and is **not re-keyed
  off `t`** (the day-cycle clock). There is no cue on cycle position.
- The two gates stay distinct: the day cycle reads the **visual** reduced-motion
  snapshot (`getSnapshot().reducedMotion`); the audio engine reads the **audio**
  mute snapshot (`getSnapshot().muted`). Neither is derived from the other.
- The diff touches **no** file under `src/audio/`. **Existing audio tests run
  unchanged and GREEN** — `AudioSystem.test.ts` (6) + `AudioEngine.test.ts` (11)
  pass with no edits.

### 3. No new UI control — rides the existing Reduced Motion switch

- The feature exposes **no new pause-menu control, toggle, or setting**. It
  consumes the **existing** `ReducedMotionSource` (the same one the beacon pulse
  and water swell already read), injected into the constructor. When the player
  flips the existing **Reduced Motion** switch, `DayCycleSystem.update` reads
  the snapshot **live each frame**, so the change takes effect on the next frame
  with no rebuild.
- The diff touches **no** UI file. (`grep` over `src/ui/` for `dayCycle` /
  `DayCycle` → **no matches**.)

### 4. No `.claude/` / harness change

The diff touches **no** file under `.claude/`. The G3 slice is product code,
tests, the running-build verifier, and this run log only.

## The guard test (the "first test to write")

`src/world/dayCycle.scope.test.ts` (new) **pins** the fence so a future edit
can't quietly widen it. It asks git for the files changed since the merge-base
with `main` and asserts the touched set is a **subset of the agreed allowlist**
with **no** `.claude/`, `src/ui/`, or `src/audio/` file in it:

- **Allowlist** (the only files G3 may touch): `dayCycleSystem.ts`,
  `buildWorld.ts`, `dayCycle.ts`, `dayCycleSystem.test.ts`,
  `buildWorld.dayCycle.test.ts`, `dayCycle.test.ts`, `dayCycle.scope.test.ts`
  (this file), `scripts/verify-game.mjs`.
- **Forbidden prefixes** (hard "never"): `.claude/`, `src/ui/`, `src/audio/`.
- It is a meta-test (reads git, not the runtime), so it **`skipIf`s cleanly**
  when run outside a git checkout rather than failing for an environment reason.
- **It has teeth:** the assertion logic was confirmed to flag a forbidden /
  unexpected file (a simulated diff of `src/ui/TextView.tsx`,
  `.claude/agents/x.md`, `src/audio/AudioSystem.ts` produces non-empty
  `forbidden` and `unexpected` lists, failing the `toEqual([])` checks).

## Verification method + results (all cited)

- **Scope test (new):** `vitest run src/world/dayCycle.scope.test.ts` →
  **1 passed**. The live branch diff is within the allowlist with no forbidden
  paths.
- **Existing TextView + audio tests, unchanged:**
  `vitest run src/ui/TextView.test.tsx src/audio/AudioSystem.test.ts src/audio/AudioEngine.test.ts`
  → **20 passed (3 + 6 + 11)**. (Confirms T9 added no edits to those files and
  they still pass.)
- **Full build:** `npm run build` (`tsc --noEmit && vite build`) → **GREEN**,
  109 modules transformed.
- **Full suite:** `npm test` → **585 passed across 68 files**.

### Diff (files changed vs `main`)

```
$ git diff --name-only $(git merge-base main HEAD) HEAD
scripts/verify-game.mjs
src/world/buildWorld.dayCycle.test.ts
src/world/buildWorld.ts
src/world/dayCycle.test.ts
src/world/dayCycle.ts
src/world/dayCycleSystem.test.ts
src/world/dayCycleSystem.ts
```

Plus T9's own additions, all within the allowlist:

```
src/world/dayCycle.scope.test.ts      (new — this guard)
docs/team/runs/2026-06-23-day-cycle-scope-fence-t9.md  (this log)
```

No `.claude/`, no `src/ui/`, no `src/audio/` file is present. **Scope fence
confirmed.**

### Build / bundle bytes (no new asset cost — measured)

```
$ npm run build
dist/assets/index-C9YYKwY1.js   227.64 kB │ gzip:  75.17 kB
dist/assets/three-nW9rggtn.js   496.49 kB │ gzip: 124.86 kB
```

- App + three gz total ≈ **199.3 KB**, well under the **400 KB** budget.
- The `three` chunk is byte-for-byte the **same** content-hashed file as the
  pre-G3 baseline (`three-nW9rggtn.js`, 124,164 bytes gz) — **zero new Three.js
  surface**.
- The app chunk moved ~**+0.9 KB gz** (74.23 → 75.17 KB) — this is the
  `DayCycleSystem` writer **plus** `dayCycle.ts`'s palette math now being pulled
  into the bundle. That is **by design**: G3's whole point is the
  `buildWorld → dayCycleSystem → dayCycle` import chain that **defeats the
  tree-shaking** of `dayCycle.ts` (the flipped guard at `dayCycle.test.ts`
  locks it in). The total stays ~199 KB.

### Cited command output

`vitest run` — scope + TextView + audio (T9-relevant subset):

```
✓ src/world/dayCycle.scope.test.ts (1 test)
✓ src/audio/AudioSystem.test.ts (6 tests)
✓ src/audio/AudioEngine.test.ts (11 tests)
✓ src/ui/TextView.test.tsx (3 tests)
```

`npm run build`:

```
✓ 109 modules transformed.
✓ built in 641ms
```

`npm test` — full suite:

```
 Test Files  68 passed (68)
      Tests  585 passed (585)
```

`grep` of `src/audio/` and `src/ui/` for day-cycle coupling (both expect no
matches):

```
$ grep -rn "dayCycle\|DayCycle\|sunElevation\|domeTop\|PERIOD_SECONDS\|GOLDEN_T" src/audio/
(no matches)
$ grep -rn "dayCycle\|DayCycle" src/ui/
(no matches)
```

Importer of the `DayCycleSystem` class (single production importer):

```
$ grep -rn "import.*DayCycleSystem\|from \".*dayCycleSystem" src --include="*.ts" --include="*.tsx"
src/world/buildWorld.ts:10:import { DayCycleSystem } from "./dayCycleSystem.ts";
src/world/dayCycleSystem.test.ts:6:import { DayCycleSystem, PERIOD_SECONDS, SUN_DISTANCE } from "./dayCycleSystem.ts";
```

## Branch commits (implementation T1–T8 + T9)

```
f2ebb65 test(world): verify the living-sky day cycle on the running build (G3, T8)
040ff5e test(world): cover unconditional DayCycleSystem registration in buildWorld (G3, T4)
84228c7 feat(world): living-sky day cycle writer DayCycleSystem (G3)
b3a895f test(world): flip dayCycle tree-shaking guard to a positive importer assertion (#116)
+ (T9) test(world): pin the G3 scope fence + run log
```

## Residual risk / follow-ups (honest exit)

- **The scope guard is diff-based, against the `main` merge-base.** It proves
  *this branch* stays in-scope; it cannot catch a hypothetical edit that lands
  on `main` first. That is the right granularity for a per-slice fence and
  matches the auditable-trail intent.
- **The fence is a path-and-import argument, not a runtime trace.** The TextView
  "untouched" claim rests on `DayCycleSystem` being constructed only in
  `buildWorld` (the WebGL path) and `App.tsx`'s mutually-exclusive switch — both
  cited above and covered by the existing (unchanged, GREEN) `App.test.tsx` and
  `TextView.test.tsx`. No new runtime path was introduced for T9 to trace.
- **Shadow frustum at low sun** (carried from the design, owned by graphics-3d
  at verify): keyframe elevations 0.12–0.20 rad rake the radius-200 island past
  the fixed ±220 ortho half-size, so dawn/dusk/evening shadows will be partially
  clipped. Accepted as a stylistic trade under the "no separate shadow-camera
  code" AC; the remedy, if any extreme is unacceptable, is a keyframe
  elevation-floor edit in `dayCycle.ts` (art tune), **never** system-side shadow
  code. Out of T9's scope; flagged for the running-build legibility check.
