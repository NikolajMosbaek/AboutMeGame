# Performance budget

- **Issue:** #13 — Define the performance budget
- **Epic:** #1 — Tech Foundation & Platform
- **Enforced in code:** `src/perf/perfBudget.ts` (`PERF_BUDGET`, `checkFrame`)
- **Surfaced live:** the runtime stats overlay (`src/perf/StatsOverlay.tsx`, #14)

The bar from the charter and Epic 6 is **"runs on a mid-range phone."** The
budget below makes that concrete so it can be measured, shown live while
playing, and asserted in tests — not left as a vibe. Numbers live in
`PERF_BUDGET`; this doc records the rationale.

## Target device

A mid-range phone roughly equivalent to an iPhone SE (2nd/3rd gen) / a
mid-tier Android (Adreno 6xx-class GPU) on mobile Safari/Chrome over a 4G
connection. If it is smooth there, desktop is comfortable.

## The budget

| Metric | Budget | Why |
|--------|--------|-----|
| Frame rate (mobile) | **≥ 30 fps** (33.3 ms/frame) | The floor for a smooth-feeling driving/flying camera on the target device. Below it, the quality scaler (Epic 6, #47) steps down. |
| Frame rate (desktop) | **60 fps** | Headroom is expected on desktop. |
| Draw calls / frame | **≤ 150** | Three.js does not batch across materials; draw-call count is the first thing that blows up as the world grows, so it is watched first. |
| Triangles / frame | **≤ 500 k** | Comfortable for the target GPU with low-poly terrain + landmarks. |
| JS shipped (gzip) | **≤ 400 KB** | `three` is ~155 KB gz; this leaves room for game code without hurting time-to-interactive. (M1 baseline: **165 KB gz**.) |
| Total initial download | **≤ 6 MB** | Textures + models + audio before the world is interactive, over 4G. |
| Time to interactive | **≤ 4 s** on 4G | The "just a link" promise dies if the first load drags. |

## Quality tiers (Epic 6, #47/#48)

The quality scaler resolves an effective render config from the player's
`quality` setting and a detected device tier (`src/perf/deviceCapability.ts` →
`src/perf/quality.ts`). `"auto"` follows the device; `"low"`/`"high"` force a
tier. The detected tier is conservative: missing signals land on `medium`, and
any touch/coarse-pointer device caps at `medium` no matter how many cores it
reports. The table is the single source of truth (`QUALITY_TIERS`), asserted in
`src/perf/quality.test.ts`.

| Knob | low | medium | high | Why it scales |
|------|-----|--------|------|---------------|
| `maxPixelRatio` | **1** | 1.5 | 2 | Fill rate is the dominant mobile cost; capping DPR at 1 is the single biggest lever for the target phone. |
| `shadows` | **off** | on | on | The shadow map is the costliest single feature; off on low. |
| `shadowMapSize` | 1024 | 1024 | 2048 | Smaller map ⇒ cheaper shadow pass on medium. |
| `propDensity` | **0.4** | 0.7 | 1.0 | Multiplier on the 540 trees / 150 rocks — fewer instances ⇒ fewer triangles. |
| `fog` | **off** | on | on | Cheap, but low drops it so the shorter draw distance reads cleanly. |

**Low tier vs the mobile budget.** Low is tuned to comfortably clear the
mid-range-phone bar: pixelRatio 1 (no super-sampling), no real-time shadows, and
~40% of the set dressing. Props are `InstancedMesh` (3 draw calls regardless of
count), so the draw-call budget is unaffected by density; the win is in
triangles and the dropped shadow pass. The cheap knobs (`maxPixelRatio`,
`shadows`) re-apply live when the setting changes in the pause menu
(`applyRendererQuality`); the build-time knobs (`propDensity`, `shadowMapSize`,
`fog`) bake at mount, so the menu notes "Detail level applies on reload."

**Bundle impact.** Epic 6 added the scaler, the text view, the a11y announcer
and the responsive/reduced-motion CSS without regressing the budget. Latest
`vite build` (gzip): main JS **66.7 KB**, `three` vendor chunk **120.1 KB**
(split, unchanged) ⇒ **~187 KB** total JS, well inside the 400 KB cap; CSS
**3.0 KB**.

## How it is enforced

- **Live:** `StatsOverlay` polls `Engine.getState()` and runs `checkFrame`
  against `PERF_BUDGET` every 250 ms, turning red the instant fps drops or draw
  calls/triangles exceed budget. Toggle-on in dev by default.
- **Tests:** `checkFrame` is unit-tested; perf-tuning work (Epic 6, #48) asserts
  headroom against these constants so a regression fails CI.
- **Bundle:** the gzip size is visible in every `vite build`; the cap is a
  review gate, and `three` is split into its own chunk for caching.

These are living numbers: Epic 6 (#48 perf tuning, #47 quality scaling) tightens
or relaxes them against real device measurement, changing `PERF_BUDGET` in one
place.
