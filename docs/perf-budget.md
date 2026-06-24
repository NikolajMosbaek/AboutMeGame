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
| `waterDisplacement` | **off** | on | on | Vertex displacement + grid subdivision on the full-screen water plane; off on low to protect mobile fill rate. Applies on reload. |
| `bloom` | **off** | on | on | Threshold post-processing pass that makes emissive landmarks (beacons, tower lamp) glow; fill-rate spend, not draw/triangle; off on low to protect mobile fill rate. **Shipped** behind the renderer seam (a tuned `UnrealBloomPass` in `src/engine/createCompositor.ts`); applies on reload. |

**Low tier vs the mobile budget.** Low is tuned to comfortably clear the
mid-range-phone bar: pixelRatio 1 (no super-sampling), no real-time shadows, and
~40% of the set dressing. Props are `InstancedMesh` (3 draw calls regardless of
count), so the draw-call budget is unaffected by density; the win is in
triangles and the dropped shadow pass. The cheap knobs (`maxPixelRatio`,
`shadows`) re-apply live when the setting changes in the pause menu
(`applyRendererQuality`); the build-time knobs (`propDensity`, `shadowMapSize`,
`fog`, `waterDisplacement`, `bloom`) bake at mount, so the menu notes "Detail
level applies on reload." `bloom` is a renderer-seam post-pass: the compositor's
existence _is_ its configuration, so it follows the bake-at-mount path with the
other detail knobs and re-applies on reload — the live `applyRendererQuality`
path (`maxPixelRatio` + shadows) does not tear down or rebuild the composer.

**Bundle impact.** Epic 6 added the scaler, the text view, the a11y announcer
and the responsive/reduced-motion CSS without regressing the budget. The bloom
slice (G2) wires the `EffectComposer` + `UnrealBloomPass` post-pass behind the
renderer seam and widens `vite.config.ts` `manualChunks` to an id-based matcher
(`/node_modules\/three\//`) so `three/examples/jsm/postprocessing/*` folds into
the `three` vendor chunk instead of leaking into the entry chunk. Measured
branch-vs-`main` `vite build` (gzip), confirmed against the actual dist chunk
listing (T9): `GameCanvas` reaches `createCompositor`, so the four postprocessing
passes (`EffectComposer` + `RenderPass` + `UnrealBloomPass` + `OutputPass`) are
in the import graph and the id-based matcher folds them into the **`three`** vendor
chunk — which grows **120.7 → 124.9 KB** (**+4.1 KB**, the postprocessing passes)
and stays a separate, cacheable vendor chunk. The entry chunk grew only
**73.9 → 74.2 KB** (**+0.3 KB** — the compositor wrapper + landmark emissive
tweaks + seam glue, **no three internals**, proving the matcher kept the
postprocessing out of the entry chunk); modules 95 → 106. Total first-load JS
**~194.6 → ~199.1 KB** (**+4.5 KB**), well inside the 400 KB cap; CSS **3.5 KB**.

## How it is enforced

- **Live:** `StatsOverlay` polls `Engine.getState()` and runs `checkFrame`
  against `PERF_BUDGET` every 250 ms, turning red the instant fps drops or draw
  calls/triangles exceed budget. Toggle-on in dev by default.
- **Tests:** `checkFrame` is unit-tested; perf-tuning work (Epic 6, #48) asserts
  headroom against these constants so a regression fails CI.
- **Bundle:** `npm run check:bundle` (= `vite-node scripts/check-bundle-size.mjs`)
  measures the built `dist/` after `npm run build`, exits non-zero when a cap is
  exceeded, and fails the PR — it is the `Check bundle size` step that runs after
  Build in `.github/workflows/ci.yml`. Two caps are measured, both sourced solely
  from `PERF_BUDGET` (`src/perf/perfBudget.ts`, via `src/perf/bundleBudget.ts`) so
  no threshold is restated here:
  - **JS-gzip cap** — the summed gzip size of the JS chunks (the `kind === 'js'`
    artifacts) vs `maxJsGzipKb`.
  - **Total cap** — every shipped `dist/` artifact vs `maxInitialDownloadKb`,
    where JS/CSS/text count at their gzip size and already-compressed binaries
    (the `'other'` kind: models, textures, audio, fonts) count at their **raw**
    bytes. Counting binaries raw is conservative-by-design — it over-counts a
    hypothetical compressible binary so the gate fails sooner, which a future
    asset/audio slice should budget against rather than treat as a bug.

  The gzip size is also visible in every `vite build`, and `three` is split into
  its own chunk for caching.

### Supply-chain audit

- **Audit:** `npm run audit:ci` (single-sourced in `package.json` as
  `npm audit --omit=dev --audit-level=high`) runs in CI right after `npm ci`,
  before Lint/Build/Test (`.github/workflows/ci.yml`, SEC1 slice 4, #138). It
  is a hard gate: a non-zero exit fails the PR and is never swallowed with
  `|| true` or `continue-on-error`.

  **What blocks.** A **high or critical** advisory in a **shipped** dependency —
  the production closure `react`, `react-dom`, `three`. `--audit-level=high`
  covers **both high and critical**; **moderate and low** advisories in shipped
  deps **do not block** — a deliberate threshold choice, so "audit passes" must
  never be read as "zero advisories."

  **What is knowingly out of scope.** **Dev-only** tooling advisories (the
  `esbuild` / `vite` / `vitest` family) are deliberately excluded: that code
  runs only on the build machine and never reaches a user's browser. They are
  not ignored — they are deferred to H2 and tracked by Dependabot (#137).

  **How the carve-out line is drawn.** `--omit=dev` scopes the audit by
  **dependency-graph membership** — `dependencies` are in, `devDependencies`
  are out — **not** a hardcoded package allowlist. So moving a package into
  `dependencies` predictably **extends** the gate's scope (it becomes shipped,
  and its advisories now block), and that is the intended, legible consequence.

  **Advisory-DB-time-sensitivity.** The gate consults the **live GitHub Advisory
  DB** at run time, so it is not lockfile-deterministic: a brand-new upstream
  advisory can turn a **previously-green PR red with no code change in that PR**.
  That is the gate working as intended. Triage it — infrastructure outage vs. a
  real advisory — and route a real one to Dependabot / H2; **never** silence it
  with `|| true` or `continue-on-error`.

These are living numbers: Epic 6 (#48 perf tuning, #47 quality scaling) tightens
or relaxes them against real device measurement, changing `PERF_BUDGET` in one
place.
