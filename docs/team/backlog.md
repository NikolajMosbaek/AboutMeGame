# AboutMeGame — Backlog

> Prioritized top-to-bottom. The Product Owner pulls the top unchecked item
> when `/team` is run with no explicit feature. When empty, the PO proposes
> the next most valuable item.

## Shipped

- [x] **Make `npm test` green on a clean `main` checkout (top priority — the green-only
      ship gate was blocked).** Fixed 2026-06-22:
      1. `src/ship.test.ts` + `src/ship.d.ts` removed. They were a one-shot pre-ship gate
         hardcoded to base branch `feat/agent-team-harness` (long since merged and deleted)
         and the already-shipped slice #56 — dead code that could never pass on `main` and
         couldn't serve future ships. The team harness now enforces branch isolation and
         Conventional Commits via the ship phase + the force-push PreToolUse hook.
      2. `vite.config.ts` now sets `test.exclude` = vitest defaults + `**/.claude/**` +
         `**/.worktrees/**`, and the stale `.claude/worktrees/vertical-slice` worktree
         (which carried a broken `node_modules`) was removed. Worktrees no longer pollute
         the suite.
- [x] First vertical game slice (local, single device): show one "about me"
      prompt, let the player type an answer, submit it, and see it echoed back
      on a reveal screen. Proves the prompt → answer → reveal loop (the core
      mechanic) before any lobby, networking, multiplayer, or scoring. The
      SPA shell from the bootstrap hosts it; the Lobby/Prompt/Guess/Scoreboard
      screen states are anticipated next.
- [x] Bootstrap: choose the stack, scaffold the project, write the charter.
- [x] Epics 1–7 (the 3D exploration engine): renderer, world (terrain/sky/water/
      boundaries/landmarks/props), discovery system, nav + HUD, game shell & UX,
      reach (quality scaling/responsive/accessibility/text fallback), and polish
      (procedural audio, VFX juice, personal brand). Shipped via PRs up to #69.

---

# Roadmap — Mechanics & Graphics Epics

> Added 2026-06-22. Mechanics epics (M*) owned by the Product Owner / frontend
> lane. Graphics epics (G*) are **owned and technically led by the graphics-3d
> agent** — it owns the rendering direction, scope, and approach for all of them.
> Each epic decomposes into AI-sized slices (one agent session each). Pull them
> top-to-bottom within each track; the two tracks are independent and can run in
> parallel (mechanics touch stores/React panels, graphics touch the canvas).

## Game Mechanics

The game today is a 3D exploration/discovery experience: roam an island, approach
13 landmarks, press **E** to reveal text about how Nikolaj works with Claude.
There is proximity discovery, persistence, an `N/13` progress badge, nav markers,
and screen-reader announce — but **no completion/end-state, no sense of journey,
no replay incentive, and the reveal is a passive wall of text**. These epics close
that gap. They build only on existing stores/systems and decompose into
headless-testable pure logic plus thin React panels — no rendering work.

### M1 — Journey & Completion Arc  *(highest priority)*

- **Goal / value:** The world has 13 landmarks but no beginning, middle, or end —
  players discover in random order and nothing happens at 13/13. Give the
  exploration a felt arc (a suggested first stop, momentum cues, a real payoff at
  completion) so "discover how I build software" reads as a journey, not a checklist.
- **Scope — in:** a `completion` discovery state when `discoveredCount === total`;
  a celebratory completion panel summarizing the journey (lists discovered
  landmarks; offers share / explore-freely / replay); a gentle "start here" cue
  steering new players to the order-1 spawn landmark (`poi-arrivals-gate`); a
  per-landmark "X to go" momentum line in the progress UI.
- **Scope — out:** scoring, timers, branching narrative, multiplayer, new 3D
  geometry (graphics owns visuals; reuse existing landmark colors/labels).
- **Acceptance criteria:**
  1. Reaching the last undiscovered landmark fires a completion state exactly once
     (rising edge); closing its reveal surfaces the completion panel.
  2. Completion panel lists all 13 titles in `order`, marks them discovered, and
     offers replay (via existing `DiscoverySystem.reset()`) and "keep exploring".
  3. A first-session player (0 discovered) sees a non-blocking "Start at the
     Arrivals Gate" cue; it disappears once that landmark is discovered.
  4. HUD progress shows remaining count (e.g. "3 to go") alongside "N / 13".
  5. Completion state reflected in the text view and survives reload.
  6. All new logic is pure/unit-tested headless (no WebGL).
- **AI-sized slices:**
  1. Add `completed` to the discovery snapshot (derived: `discoveredCount === total`)
     + unit tests; emit only on the rising edge.
  2. Extend `appState`/discovery flow with a completion-panel React component
     (titles list, replay / keep-exploring CTAs) wired to `reset()`.
  3. "Start here" first-session cue: pure selector for suggested next landmark +
     non-blocking HUD hint; hide once discovered.
  4. "N to go" remaining-count line in `Hud.tsx` + HUD store, throttled.
  5. Reflect completion + journey summary in `TextView.tsx` (non-WebGL path).
- **Dependencies / risks:** relies on `discoveryStore`, `DiscoverySystem.reset()`,
  the `appState` union, persistence — all exist. Risk: double-firing completion on
  reload — mitigated by rising-edge derivation (never on initial snapshot,
  mirroring `announcementFor`'s `prev === null` guard).

### M2 — Make the Reveal Interactive, Not a Wall of Text

- **Goal / value:** Every landmark resolves to "press E, read a paragraph" —
  passive and uniform. Turn each reveal into a small, varied interaction (a
  one-line guess/poll, a reveal-on-tap takeaway, an in-panel next-landmark link)
  so discovering *how I work* is an act, not a read.
- **Scope — in:** an optional per-POI `interaction` type in the content model
  (default = current plain body, so no content rewrite needed): (a) "guess then
  reveal" — one prompt + 2–3 options, body unlocks after a pick; (b) a "highlight"
  body emphasizing one takeaway sentence. In-reveal navigation: "Next landmark →"
  re-points the nav cue at the next-in-order undiscovered POI.
- **Scope — out:** free-text answers, server validation, cross-session persistence
  of individual guesses, new audio/VFX (existing burst/chime stay), content
  authoring beyond optional fields with safe defaults.
- **Acceptance criteria:**
  1. `PoiContent` gains an optional `interaction` field; `loadContent()` validates
     it and defaults missing/unknown to "plain" (test asserts current JSON still
     loads unchanged).
  2. A "guess" POI shows prompt + options first; selecting any option reveals the
     full body; body never shown before a pick.
  3. The reveal panel offers an in-panel "Next →" that closes the panel and points
     the nav cue at the next undiscovered landmark by `order`.
  4. Keyboard + screen-reader accessible: options are focusable buttons, selection
     announced politely (reuse the live-region pattern).
  5. At least 2 existing POIs authored with a "guess" interaction as reference; the
     rest remain plain.
  6. All interaction logic unit-tested headless.
- **AI-sized slices:**
  1. Extend `contentModel.ts` with optional `interaction` (discriminated union,
     default "plain") + validation + tests proving existing JSON loads unchanged.
  2. Discovery store/snapshot: carry interaction data into `OpenInfo`;
     "guess answered" session state (pure).
  3. `RevealPanel.tsx` guess-then-reveal UI + a11y (focusable options, polite announce).
  4. "Next →" in the reveal panel wired to a pure "next undiscovered by order" selector.
  5. Author 2–3 POIs with guess interactions in `content/working-with-claude.json`
     (+ PROVENANCE note) and a "highlight" takeaway for the plain ones.
- **Dependencies / risks:** depends on `contentModel`, `discoveryStore`,
  `RevealPanel`, nav store — all exist. Risk: scope creep into a full quiz/scoring
  system — explicitly capped at one-pick-then-reveal, no score. Content/code
  coupling mitigated by optional fields with a plain default (incremental authoring).

### M3 — Free-Roam Loop Polish: Recall, Re-read & Wayfinding

- **Goal / value:** Once a landmark is discovered its nav marker disappears
  (markers only show undiscovered POIs) and there's no way back to re-read it — the
  world gets harder to navigate the more you learn. Add a simple in-game
  journal/map to recall and re-open any discovered landmark, tightening the explore
  loop for curious and returning visitors.
- **Scope — in:** a toggleable journal overlay listing all landmarks (discovered =
  title + re-open; undiscovered = "?" silhouette by color/label); selecting a
  discovered entry re-opens its reveal without travel; an optional "show all
  markers" wayfinding toggle for discovered POIs.
- **Scope — out:** a rendered 2D terrain minimap (graphics lane), fast-travel /
  teleport movement, content editing. Keep it a list/panel, not a spatial map.
- **Acceptance criteria:**
  1. A journal button in the HUD opens a panel listing all 13 by `order`;
     discovered show title + teaser, undiscovered show a locked placeholder
     (color/label only — no body/teaser leak).
  2. Selecting a discovered entry opens its full reveal (reusing the existing
     reveal path) and pauses the sim like proximity reveal does.
  3. Opening/closing the journal pauses/resumes the sim consistently with the menu;
     keyboard + screen-reader accessible.
  4. A settings toggle makes nav markers for discovered landmarks reappear
     (default off, preserving the current "clear the map as you learn" feel).
  5. Journal reflects persisted progress on reload and updates live.
  6. Logic (unlocked entries, locked-content masking) unit-tested headless.
- **AI-sized slices:**
  1. Pure selector: build journal entries from content + discovery snapshot,
     masking undiscovered bodies/teasers (+ tests).
  2. Journal panel React component (list, locked placeholders) + HUD button, behind
     the existing pause seam.
  3. "Re-open from journal" path: route a discovered entry through
     `discoveryStore.openPoi`, verify sim pause/resume.
  4. Settings toggle + `NavSystem`/nav store change to optionally include discovered
     markers; persisted via `settingsStore`.
- **Dependencies / risks:** depends on `discoveryStore`, `DiscoverySystem`,
  `NavSystem`, `settingsStore`, the `gameSession` pause flag — all exist. Risk:
  overlap with M1's completion panel (both list landmarks) — share one list
  component; **sequence M3 after M1**. Guard `openPoi` to unlocked ids only.

**Mechanics sequencing:** M1 → M2 → M3. M1 closes the biggest payoff gap (no
ending); M2 has the highest "fun" upside; M3 is quality-of-life that shares a list
component with M1.

## Graphics  — *owned & led by the graphics-3d agent*

> graphics-3d owns rendering direction, scope, and technical approach for every
> epic below. **Budget held by all of them** (`docs/perf-budget.md`,
> `src/perf/perfBudget.ts`): ≥ 30 fps mobile / 60 desktop, ≤ 150 draw calls/frame,
> ≤ 500 k triangles/frame, ≤ 400 KB gzip JS (current ~187 KB), ≤ 6 MB total,
> ≤ 4 s TTI. Only G2 spends bytes; it must report the delta against the cap.
> Constraints being defended (`docs/art-direction.md`): low-poly, flat-shaded, no
> textures, tiny payload. The text/no-WebGL fallback (`TextView`) is unaffected by
> all four.

### G1 — Stylised animated water & shoreline  *(highest priority)*

- **Goal / value:** The island sits in a flat, lifeless translucent plane. Replace
  it with gently animated, depth-shaded stylised water and a soft shoreline so the
  world's single largest surface stops reading as dead and frames the island.
- **Scope — in:** replace `boundaries.ts` water with an animated water material
  (vertex ripple + fresnel-tinted depth-based color + a shoreline foam band) + a
  subtle sun glint; full reduced-motion + quality-tier behaviour.
- **Scope — out:** real reflections/refraction (`Water` from examples/jsm is too
  heavy — a full extra pass + bytes), buoyancy/physics, caustics, underwater camera.
- **Technical approach (graphics-3d's call):** keep it a single `PlaneGeometry` +
  `MeshStandardMaterial` patched via `onBeforeCompile` — **no hand-written
  `ShaderMaterial`, no EffectComposer.** Small vertex displacement (two summed sines
  on a `uTime` uniform) + a fragment tweak: blend two sRGB palette blues by
  view-space fresnel, add a foam term from `smoothstep` on scene depth near shore
  (or, cheaper/zero-pass, a distance-to-coastline approximation baked from
  `terrain.heightAt` into a vertex attribute at build). `mediump` on mobile,
  branch-free. Adds **0 draw calls, ~0 triangles** (same geometry), a few uniforms,
  a `System` advancing `uTime` by `dt`. < 1 KB gz. Low tier drops displacement
  (fill-rate dominates); medium/high get ripple; reduced-motion freezes `uTime`.
- **Acceptance criteria:**
  1. Water animates on medium/high; holds still on low and under reduced-motion
     (verified via the reduced-motion source already in `buildWorld`).
  2. Shoreline foam band reads where water meets land around the whole coast.
  3. Draw calls unchanged (water stays 1); triangles ±0; `StatsOverlay`/`checkFrame`
     green at the mobile floor (≥ 30 fps) on the target-device profile.
  4. Pure wave/foam/color math lives in a tested function in `src/world/` (headless);
     `System` wiring stays trivial.
  5. No per-frame allocation; material/geometry disposed.
- **AI-sized slices:**
  1. Pure `waterSurface.ts`: wave-height fn + foam/fresnel color ramp, unit-tested.
  2. `onBeforeCompile` patch wiring uniforms + reading slice-1 functions.
  3. `WaterSystem` advancing `uTime` by `dt`, gated by reduced-motion; register in `buildWorld`.
  4. Quality-tier branch (displacement off on low) + perf profile vs budget.
- **Dependencies / risks:** fill-rate on low-end (water covers most of the horizon)
  — mitigated by dropping displacement on low + light fragment branch. Depth-buffer
  foam needs `MeshDepthMaterial`/`depthTexture`; if costly on mobile, fall back to
  the baked distance-attribute (no extra pass).

### G2 — Bloom & atmosphere post-processing pass  *(high priority)*

- **Goal / value:** Beacons, the tower lamp, and snow caps look flat because nothing
  blooms. A single tuned post stack makes emissive elements glow and gives the warm
  palette the "wow" sheen a party game wants — the cheapest large perceived-quality
  jump available. **Unlocks the emissive treatments G3/G4 lean on.**
- **Scope — in:** an `EffectComposer` with `RenderPass` + a threshold
  `UnrealBloomPass`, tuned to the warm palette; beacon/emissive landmark materials
  promoted to read as bloom sources; full quality-tier gating (**off on low**,
  optional on medium, default-on high).
- **Scope — out:** SSAO, depth-of-field, motion blur, color-grading LUTs, film
  grain. One effect, tuned well.
- **Technical approach (graphics-3d's call):** introduce the composer **only inside
  the renderer path** (`createRenderer.ts`/Engine) — the one place a real pipeline
  is built, so the seam stays clean and jsdom never touches it. Tree-shakeable
  `three/examples/jsm/postprocessing`. Tone-mapping/sRGB already correct — bloom
  slots before output. This is **fill-rate spend, not draw-call spend**: half-res
  bloom buffer on medium, full on high; ~no triangles. Bytes: composer +
  `UnrealBloomPass` ≈ 8–12 KB gz (justified; far under the 400 KB cap). New
  `bloom`/`postProcess` knob in `QUALITY_TIERS`, applied at mount.
- **Acceptance criteria:**
  1. Beacons + emissive landmarks visibly glow on high; bloom fully off on low
     (composer bypassed → plain `renderer.render`, zero post cost).
  2. Bundle gz stays under the 400 KB cap; report the new total in the PR.
  3. Mobile floor held: medium (half-res) ≥ 30 fps on target via
     `StatsOverlay`/`checkFrame`; if not, bloom drops to high-only.
  4. New `bloom` knob added to `QUALITY_TIERS`, table updated in
     `docs/perf-budget.md`, tier resolution unit-tested in `quality.test.ts`.
  5. Composer/passes disposed on unmount; render targets resized on canvas resize.
- **AI-sized slices:**
  1. Add `bloom` knob to `QUALITY_TIERS` + `QualityConfig`; update `quality.test.ts`
     and `docs/perf-budget.md`.
  2. Wire `EffectComposer` + `RenderPass` + `UnrealBloomPass` behind the renderer
     seam; bypass entirely when `bloom: false`.
  3. Resize/dispose lifecycle + tune threshold/strength/radius to the palette.
  4. Profile medium half-res vs high full-res against the mobile floor; pin values.
- **Dependencies / risks:** fill-rate on mobile is real — strict gating (off on low)
  + half-res on medium are non-negotiable. Bundle delta must be reported and stay
  under cap. Touches the renderer seam — wholly inside the canvas, no frontend coord.

### G3 — Living sky: time-of-day & dynamic light  *(medium priority)*

- **Goal / value:** The sky and sun are frozen, so the world feels like a static
  diorama. A slow, looping day cycle (warm dawn → bright noon → golden dusk) that
  animates the gradient dome, sun color/angle, and fog tint makes the place feel
  alive on every visit.
- **Scope — in:** a `DayCycleSystem` driving the existing `sky.ts` sun + dome
  `ShaderMaterial` uniforms + `FogExp2` color through a tuned keyframe gradient over
  a slow loop; reduced-motion holds a fixed "golden" time; quality-tier respected
  (no extra cost).
- **Scope — out:** night/stars/moon (warm-daytime palette; night fights wayfinding
  readability), volumetric god-rays, real cloud sim, lens flares.
- **Technical approach (graphics-3d's call):** zero new geometry, zero draw calls,
  zero asset bytes — pure animation of existing uniforms + the one
  `DirectionalLight`. Small keyframe table (sun color/intensity/elevation/azimuth;
  dome top/bottom; fog color) in sRGB, interpolated by a pure
  `timeOfDay → palette` function in `src/world/` (headless-testable). The `System`
  maps `elapsed` to a slow cycle (~4–6 min loop) and writes uniforms — `sky.sun` and
  `sky.horizon` are already exposed for exactly this. Shadows track the sun
  automatically. Reduced-motion pins a fixed flattering value.
- **Acceptance criteria:**
  1. Sun color/angle, dome gradient, and fog tint shift smoothly over the loop;
     shadows track the sun.
  2. Reduced-motion pins a fixed time-of-day (verified via the reduced-motion source).
  3. Landmark/beacon readability holds at every point in the cycle (palette
     keyframes keep signature beacon colors distinct).
  4. `timeOfDay → palette` is a pure, unit-tested function; `System` stays trivial.
  5. Draw calls, triangles, bytes unchanged; `checkFrame` green throughout.
- **AI-sized slices:**
  1. Pure `dayCycle.ts`: keyframe palette table + interpolation, unit-tested.
  2. Refactor `sky.ts` to expose dome uniforms (top/bottom/offset); confirm
     `sun`/`horizon` handles for live mutation.
  3. `DayCycleSystem` writing uniforms from `elapsed`, reduced-motion pin; register
     in `buildWorld`.
  4. Tune keyframes for beacon/landmark contrast across the loop; verify via build +
     `render_game_to_text`.
- **Dependencies / risks:** readability is the only real risk — beacons must stay
  legible against golden hour; clamp the darkest keyframe well above night. Couples
  loosely with G2 — **sequence G2 first** so bloom tuning sees the brightest case.
  No bundle impact.

### G4 — Landmark silhouette & material upgrade  *(medium priority, larger)*

- **Goal / value:** The 13 landmarks are recognisable but read as grey box
  primitives. Raise their craft — distinct silhouettes, vertex-colored detail, a
  subtle signature-color rim/emissive — so each POI is a genuinely attractive
  destination rather than a stack of cuboids.
- **Scope — in:** per-archetype geometry refinement in `landmarks.ts` (more
  characterful merged geometry, vertex-color accents, consistent emissive that pairs
  with G2 bloom); shared-material batching to protect draw calls; keep the existing
  `landmark:<poiId>` naming + `placed` contract intact (Epic 4 discovery / Epic 5 nav
  depend on it).
- **Scope — out:** imported GLTF assets (would add to the 6 MB total + TTI — stay
  procedural), animated/rigged landmarks, interior spaces.
- **Technical approach (graphics-3d's call):** stay **fully procedural and
  flat-shaded** — the low-poly/no-texture stance keeps us at ~187 KB and sub-4 s
  TTI, and it's being defended. Improve silhouettes by composing more primitives per
  archetype and merging static sub-meshes per landmark with
  `BufferGeometryUtils.mergeGeometries` so each landmark trends toward **one draw
  call** instead of 3–9; share the `stone` material across all landmarks. Add a
  vertex-color `color` attribute for accent detail (no new materials) + a modest
  `emissive` on accent faces to catch G2 bloom. Even doubling per-landmark detail is
  a rounding error vs the 500 k frame budget; draw calls should **drop** after
  merging. Code only, no asset bytes.
- **Acceptance criteria:**
  1. Each archetype has a clearly improved, distinct silhouette; signature color
     still reads from afar (wayfinding preserved).
  2. `landmark:<poiId>` group naming + the `placed[]` contract unchanged (Epic 4 +
     Epic 5 tests stay green).
  3. Landmark-group draw calls do not increase vs today (target: decrease via merge);
     triangles well under the 500 k frame budget.
  4. Geometry/material construction covered by the existing `landmarks.test.ts`
     pattern (counts, naming, positions); visuals verified by running the build.
  5. All geometries/materials disposed; no per-frame work added.
- **AI-sized slices:**
  1. Shared-material + per-landmark `mergeGeometries` plumbing in `landmarks.ts`;
     assert draw-call/naming contract in tests.
  2. Upgrade 4–5 archetypes (gate, tower, foundry, mirror, dam) with richer
     silhouettes + vertex-color accents.
  3. Upgrade remaining archetypes (monolith, station, ring) + apply the shared
     emissive-accent treatment.
  4. Verify wayfinding/readability across all 13 via build; profile triangles/draw
     calls against budget.
- **Dependencies / risks:** must not break the Epic 4/5 contracts (`placed`, names)
  — the strongest risk; covered by keeping the interface identical and asserting it
  test-first. Pairs with G2 (emissive accents want bloom) — **sequence after G2.**
  Largest of the four, so it's last.

**Graphics sequencing (graphics-3d's recommendation):** G1 → G2 → G3 → G4. G1 is
the biggest wow-per-byte/ms win on the largest surface at near-zero cost. G2 is the
biggest single perceived-quality jump and unlocks G3/G4's emissive treatments. G3 is
free perf-wise and makes every visit feel alive. G4 is the largest and benefits from
bloom existing first.
