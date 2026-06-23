# G4 — Landmark silhouette & material upgrade (T14: running-build visual verify)

**Date:** 2026-06-23
**Phase:** Verify (T14)
**Owner (UX/visual verification):** lead-ui-ux-designer
**Branch:** `feat/g4-landmark-meshcount-t2`
**Scope:** verification tooling + the one automation seam it needs — no change to
the landmark geometry/material implementation (T9), the UI shell, the text view,
or anything under `.claude/`.

> This is **T14** of the G4 slice — the "verify the running build via the
> Playwright smoke verifier" task. The implementation (T2–T13) landed on the
> branch; this run is the independent UX pass over the rendered result. It proves
> on a real WebGL build that all 8 procedural archetypes read as **clearly more
> characterful, flat-shaded silhouettes with a signature-hued accent glow that
> catches the G2 bloom** — no GLTF/textures, no animation/rigging, no interiors,
> no new asset bytes.

## What T14 needed and why a tiny seam was added

The acceptance criterion is explicitly a *running-build* check ("verified
visually on the running build via the Playwright smoke verifier"). The existing
verifier (`scripts/verify-game.mjs`) drives the world only by **keyboard** (the
day-cycle mode flies up with `f`/`Space`). Keyboard steering cannot
**deterministically frame 8 specific landmarks** across a 520-unit, densely
forested island — the gate would be flaky and slow. The only stable automation
contract on `window` was `advanceTime` / `render_game_to_text` / `__ENGINE_STATE__`,
none of which moves the camera.

**Decision (in-scope, minimal):** add ONE camera-framing automation seam, the
same develop-web-game convention as `advanceTime`:

- `Engine.renderFromView(eye, target)` — halts the live loop, aims the camera at
  `target` from `eye`, and presents exactly ONE frame **without ticking any
  system**, so the `CameraRigSystem` cannot overwrite the framed view before the
  screenshot. It changes no simulation state and adds no per-frame cost (it runs
  only when the harness calls it).
- `window.__frameView__(eye, target)` — wired in `GameCanvas` next to the
  existing hooks and **removed on unmount** (mount-scoped, like the others).

This is product code (a verification seam), not a harness/process change, and is
covered headlessly (below). It does **not** touch the T9 landmark geometry or
the two shared materials — the thing under test is rendered exactly as shipped.

## New verifier mode — `--landmark-tour`

`node scripts/verify-game.mjs <url> --landmark-tour --out-dir <dir>`:

1. Enters the world, dismisses onboarding, and steps the day cycle to a bright
   daytime keyframe (`advanceTime(45_000)`) so the flat-shaded facets and the
   accent glow read (the dim dawn spawn is muddy).
2. Hides the React HUD/overlay chrome via an injected stylesheet **on the
   verifier's page only** (no product change), so nav markers / the speed pill
   don't sit over the structure and pollute the pixel sample.
3. For each of the 8 archetypes (one representative POI anchor each — repeats are
   geometrically identical), frames an elevated 3/4 view that clears the
   foreground trees (`eye` 34u out and 28u up, looking at the structure's
   upper-middle `y=11`), renders one still via `__frameView__`, and screenshots
   it to `landmark-<archetype>.png`.
4. Decodes each PNG in-page and asserts, per archetype:
   - **engine health** — positive fps (an EMA, untouched by the deliberate loop
     halt) and the full **13**-landmark count (`beacons.poiCount` /
     `discovery.total`); `state.running` is intentionally false (the still is
     held), so it is NOT asserted.
   - **a built structure is framed** — central-band coverage of non-grass,
     non-sky pixels ≥ 2% (else it's an empty meadow / nothing rendered).
   - **a signature-hued accent glow is present** — bright pixels whose HUE
     matches the anchor's signature colour ≥ 0.5% (the emissive accent + beacon
     the bloom catches; the assertion is hue-specific, not mere brightness).
   - **the 8 silhouettes are distinct** — structure-coverage spread across the
     archetypes ≥ 2% (not all the same blob).
   - **no console / WebGL / three errors** the whole tour.

## Result — VERIFY OK (exit 0)

Run against `vite preview` (the production build) at
`http://localhost:4318/AboutMeGame/`, headless Chromium with
`--use-gl=angle --use-angle=swiftshader` (software WebGL, GPU-free):

```
LANDMARK TOUR (8 procedural archetypes, framed one still each):
  gate      #ffcb47 structure=16.64% accent(hued)=2.338% accent(any)=12.241% fps=29.66 landmarks=13
  monolith  #7ad1ff structure=19.21% accent(hued)=10.393% accent(any)=12.436% fps=29.66 landmarks=13
  foundry   #ff8a5c structure=27.96% accent(hued)=1.362% accent(any)=9.673% fps=29.66 landmarks=13
  tower     #ffe066 structure=11.21% accent(hued)=1.356% accent(any)=9.315% fps=29.66 landmarks=13
  dam       #5cc8ff structure=18.92% accent(hued)=9.854% accent(any)=12.329% fps=29.66 landmarks=13
  station   #8affc1 structure=15.16% accent(hued)=2.517% accent(any)=12.234% fps=29.66 landmarks=13
  ring      #ffa3d1 structure=17.72% accent(hued)=1.282% accent(any)=11.274% fps=29.66 landmarks=13
  mirror    #d9e3ff structure=18.87% accent(hued)=9.113% accent(any)=12.335% fps=29.66 landmarks=13
  structure-coverage spread across the 8 = 16.75% (>=2% ⇒ distinct silhouettes)
VERIFY OK
```

Committed screenshots (the screenshot is the source of truth):
`docs/team/runs/assets/2026-06-23-g4-landmark-tour-verify/landmark-<archetype>.png`.

## Per-archetype UX verdict (eyeballed against the committed shots)

- **gate** (#ffcb47) — two **stepped pylons** (base → narrower shaft → cap)
  carrying a **crowned golden lintel**; the lintel + the gold beacon plume glow
  the signature gold. Reads as an arch, not a pair of boxes.
- **monolith** (#7ad1ff) — a thin **tapered obelisk** that steps in three stages
  to a **canted signature cap**; cool-blue accent + beacon. Distinct slab.
- **foundry** (#ff8a5c) — a blocky **industrial hall** with a parapet course, a
  raised clerestory and a **tapered orange chimney stack** (the accent). Reads
  industrial.
- **tower** (#ffe066) — a **tapered drum + corbelled gallery ring + crown of
  merlons**, topped by the bright **emissive lamp** (the second genuine bloom
  source, its own discrete mesh, glowing the signature yellow). Reads as a
  lighthouse-tower.
- **dam** (#5cc8ff) — a long **buttressed wall** with a crest walkway and a
  bright **cyan central sluice gate** (the accent that replaced the deleted
  glass plate's role of "the bright bit"). Reads as a dam.
- **station** (#8affc1) — a **low platform** on posts with a **pitched roof** and
  a green **canopy fascia** accent. Reads as a low shelter/platform.
- **ring** (#ffa3d1) — **eight capped stelae on a circle joined by lintels**,
  the alternating caps/lintels carrying the pink signature accent. Reads as a
  henge/yard, not a single block.
- **mirror** (#d9e3ff) — a **bezelled frame** (dark stone bars around a backing
  plate) with a bright **cool reflective face** (the merged accent that replaced
  the bespoke metalness glass plate). Reads as a framed mirror/wall.

All silhouettes are **flat-shaded** (visible hard-edged facets on every drum,
buttress and obelisk — no smooth Gouraud gradients), confirming the no-`mergeVertices`
merge kept hard normals through the per-landmark stone/accent merge. No textures,
no GLTF, no animation, no interior — purely procedural geometry, exactly as T9.

## Negative checks

- **No new asset bytes** — the tour imports nothing into the world; the build is
  the same production bundle T13 measured.
- **No console / WebGL / three errors** at any of the 8 framings.
- **Bloom catches the accent** — every archetype's signature-hued accent + beacon
  reads as a bright glow (the `accent(hued)` and `accent(any)` columns), i.e. the
  emissive accent material modulated by the per-vertex signature colour is
  clearing the tuned-high bloom threshold from one shared material, as designed.

## Gates (all green, cited)

**Full Vitest suite — `npm test` → exit 0**

```
 Test Files  68 passed (68)
      Tests  603 passed (603)
```

The net-new headless tests added with the framing seam:
- `src/engine/Engine.test.ts` — `renderFromView` aims the camera at a view and
  renders one frame **without ticking systems**, **halts the live loop** so the
  framed view persists, and presents **through the compositor** when injected.
- `src/engine/GameCanvas.test.tsx` — `__frameView__` is installed on mount,
  **forwards** `(eye, target)` to the engine seam, and is **removed on unmount**.

**Production build — `npm run build` (`tsc --noEmit && vite build`) → exit 0**

```
✓ 110 modules transformed.
dist/index.html                   2.05 kB │ gzip:   0.84 kB
dist/assets/index-D4SG0bZ9.css   16.30 kB │ gzip:   3.54 kB
dist/assets/index-CDvBh_OH.js   229.00 kB │ gzip:  75.77 kB
dist/assets/three-COLka6mN.js   500.28 kB │ gzip: 125.83 kB
✓ built in 688ms
```

The entry chunk is **75.77 kB gzip** — +0.08 kB vs T13's 75.69 kB (the tiny
`__frameView__` closure + the `renderFromView` method), well inside the G4 < 2 KB
gzip-delta budget. The 500 kB warning is the pre-existing `three` vendor chunk.

## Scope — `git diff --name-only`

- `scripts/verify-game.mjs` — the `--landmark-tour` mode (verification tooling).
- `src/engine/Engine.ts` — `renderFromView` automation/verification seam.
- `src/engine/Engine.test.ts` — its headless coverage.
- `src/engine/GameCanvas.tsx` — wires/teardowns `window.__frameView__`.
- `src/engine/GameCanvas.test.tsx`, `GameCanvas.journal.test.tsx` — hook coverage
  + engine-stub shape.
- `src/engine/globals.d.ts` — the `__frameView__` window declaration.
- `docs/team/runs/2026-06-23-g4-landmark-tour-verify.md` + assets — this log.

No change to `src/world/landmarks.ts` (the thing under test), the React UI shell,
the TextView / no-WebGL path, or anything under `.claude/`.
