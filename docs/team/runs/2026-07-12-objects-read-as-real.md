# Run log — 2026-07-12 — Objects slice 1: make the objects look like what they really are

## Intake

Owner directive (verbatim): *"Make the objects look more like what they really are."*
Context: the world got a full visual overhaul (`docs/team/runs/2026-07-10-visual-overhaul.md`,
`docs/design/2026-07-10-visual-overhaul-design.md`) — real flora models, PBR terrain/water,
atmospheric sky — but the gameplay objects were still primitive assemblies: the tent a plain
tan cone, the crates flat brown boxes, the canoe barely reading as a boat, the ruin/remains/
overhang loose primitive piles, the treasure chest+idol simple shapes.

## Scope

Every man-made/site object, judged by "does it read as the thing": the 6 expedition sites
(`src/world/landmarks.ts`) and the treasure chest + idol (`src/quest/buildTreasure.ts`).
Wildlife (the next slice) and forage plants (gameplay-interactive, already read okay) were
explicitly out of scope.

## Decisions

1. **Follow the flora-upgrade precedent exactly.** Low tier keeps the plain-procedural sites
   forever (zero fetches, the render-gate's own path); medium/high async-swap in real CC0
   models with a procedural fallback on any load failure — a new `quality.objectDetail` knob,
   `src/world/landmarksUpgrade.ts` mirroring `floraUpgrade.ts`'s lazy-chunk/cancel/dispose
   shape almost line for line.
2. **One function, two paths, not two copies.** `buildLandmarks`'s `buildSite` gained an
   OPTIONAL 5th `modelGeometry` parameter rather than a parallel "model-upgraded" builder —
   camp/canoe/ruin/remains branch on its presence; overhang/figtree/the ruin's gaze rig never
   branch at all (no CC0 model fits them, so they're upgraded procedurally, UNCONDITIONALLY,
   on every tier, at zero extra cost). This keeps the ruin's statue-gaze convention (clue 5's
   "sight along the eyes") a single source of truth no upgrade path can drift from.
3. **Source from three CC0 Kenney kits**, reusing the flora slice's own "follow the
   donate-or-skip flow to one stable zip URL" scriptability finding: Survival Kit (tent,
   campfire, crates, barrel, bedroll, tools), Pirate Kit (a rowboat hull, already carrying its
   own paddles), Graveyard Kit (generic worked-stone wall/column/rubble pieces ONLY — its
   tombstone/coffin pieces were rejected as the wrong genre for a jungle ruin).
4. **The pipeline needed a second colour-bake mode.** These three kits share ONE textured
   "colormap" atlas material per model (each UV island a solid-colour swatch), unlike the
   Nature Kit's untextured flat `baseColorFactor` per material — `scripts/process-models.mjs`
   gained `colorMode: "texture"` (sample the atlas at each vertex's UV via `sharp`) alongside
   the original `"material"` mode, plus a `scaleAxis` option so a wide-but-short model (the
   campfire ring, the rowboat hull) sizes by length/width instead of a height it never had.
5. **The idol is bespoke; the chest stays bespoke too, deliberately.** The MacGuffin gets a
   real carved-statue silhouette (plinth/riser/body/crossed arms/collar/head/crown) — no CC0
   model could give it the exact envelope + emissive-eyes contract it needs. Kenney's
   `chest.glb` was evaluated and rejected for the TREASURE chest specifically: its lid is a
   separate child node in a closed authored pose, and reaching an "open" pose would need
   per-node re-export engineering disproportionate to a secondary prop once the idol had the
   team's real attention. The chest instead gained procedural corner straps + a latch.
6. **A structural bug only a live capture caught.** Mixing a loaded model's quantized
   (`Int16Array`/`Uint8Array`, `normalized: true`) attributes with a procedural piece's plain
   `Float32Array` in the same `mergeGeometries` call fails outright (ruin/remains, which mix
   model + "keep" procedural geometry) — and a second, more dangerous bug rode along:
   `place()`'s `applyMatrix4()` silently corrupts a still-normalized int16 store via
   integer-overflow. Fixed by dequantizing every loaded model geometry to plain Float32
   BEFORE any placement transform or merge (`dequantize()` in `landmarks.ts`); the unit
   fixture was rewritten to use a genuinely indexed/quantized fake so this class of bug is
   pinned going forward.

## Trail table

| Step | What | Where |
|---|---|---|
| Sourcing | Survival/Pirate/Graveyard Kit zip URLs found, models selected by inspecting triangle count + bbox | `scripts/process-models.mjs`, `public/assets/LICENSES.md` |
| Pipeline | `colorMode: "texture"` (UV-sampled atlas bake via `sharp`) + `scaleAxis` generalized rescale + `flatten()` before `join()` (fixes a real multi-node-hierarchy miss on `bedroll.glb`) | `scripts/process-models.mjs` |
| Quality knob | `objectDetail: "none" \| "full"` (low/medium+high) | `src/perf/quality.ts`, `src/perf/quality.test.ts` |
| Model-swap seam | `buildSite`'s optional `modelGeometry` branch; `ruinGazeRig()` extracted as the shared "always procedural" source | `src/world/landmarks.ts`, `src/world/landmarks.test.ts` |
| Async upgrade | Lazy dynamic import, load-swap-dispose, procedural-forever on failure | `src/world/landmarksUpgrade.ts`, `src/world/landmarksUpgrade.test.ts` |
| World wiring | Gated dynamic import + dispose, mirroring `floraUpgrade` | `src/world/buildWorld.ts` |
| The idol + chest | Carved-statue silhouette; corner straps + latch | `src/quest/buildTreasure.ts`, `src/quest/buildTreasure.test.ts` |
| Perf record | Draw/triangle/payload deltas measured pre vs. post, same machine | `docs/perf-budget.md` |
| Verification | 6 sites + idol/chest, real GPU, noon, high tier | this log, below |

## Gates (all EXIT=0)

`npm run lint` · `npm run build` · `npm test` (142 files / 1496 passed, 1 skipped) ·
`npm run check:bundle` (392.4/400 KB JS gzip, 4054.7/6000 KB total) · `npm run verify`.

## Verification (real GPU, `--use-gl=angle --use-angle=metal`, `quality: "high"` via
`localStorage`, noon — `window.advanceTime(45000)`)

- **Camp** — reads as a real A-frame tent (canvas panels, ridge pole, stake feet) beside a
  stacked crate pair and a barrel. (First cut used `tent.glb`, the bare pole frame with no
  fabric — a real "does it read as the thing" miss caught by the FIRST screenshot; swapped to
  `tent-canvas.glb` and re-verified.)
- **Canoe** — unmistakably a rowboat: real hull cavity, gunwale, bow/stern points, resting
  paddles. The headline "barely reads as a boat" complaint is resolved.
- **Overhang** — chunkier 2-lobe boulder pillars + a backing slab behind the carvings; a real
  but modest improvement (no CC0 model fits a carved rock shelf).
- **Remains** — the lost expedition's dropped axe and shovel now lie beside the existing
  cairn/pack, reading as gear left behind.
- **Ruin** — a genuine beveled/coped worked-stone wall panel in place of a bare box; reads
  as worked masonry, not a random block.
- **Fig tree** — a fuller, less-spherical 4-lobe canopy and deeper buttress roots read as a
  more convincing ancient strangler fig (wide establishing shot).
- **Idol/chest** — verified via a temporary, NOT-shipped debug hook
  (`window.__debugRevealTreasure__`, added and removed within this session — reaching the
  reveal through the real 5-clue-plus-dig quest chain was out of scope for a screenshot). The
  reveal mechanism and the idol's emissive glow render correctly in place. The new carved
  silhouette itself is verified by `buildTreasure.test.ts` (8 idol meshes, one shared emissive
  material, envelope still inside the chest) rather than a flattering screenshot — the
  treasure sits wedged tightly between two of the fig's buttress roots (a pre-existing
  site-design constraint, unchanged by this slice), and no camera angle tried from outside
  that root cage gave a clean, unoccluded "statue portrait". Recorded honestly rather than
  claiming a hero shot that wasn't achieved.

## Deviations from the brief

- The treasure **chest** stays procedural (not a CC0 model) — see decision 5 above.
- The idol/chest live screenshot is a functional/glow proof, not a flattering portrait — see
  the verification note above.
- Forage plants and wildlife are untouched, as scoped.

## Next slice

Wildlife (deferred from the visual overhaul, `docs/perf-budget.md`'s slice-6 note: "the
NEXT slice that adds triangles (jaguar/wildlife) must budget against [the ~58k-triangle
headroom]"). This slice's own +2,107-triangle add (medium/high) leaves that headroom at
roughly 55.9k — still comfortable, but the next slice should re-measure rather than assume.

## Code review fix (2026-07-12)

review: sRGB bake missing linear conversion (13 models washed out) + dispose parity +
texel-center — fixed, GLBs re-baked.

- **sRGB→linear (the important one).** `bakeVertexColorFromTexture` (`scripts/process-models.mjs`)
  wrote `sharp`'s raw sRGB-encoded PNG bytes straight into `COLOR_0` (`byte/255`) — three treats
  vertex colour as already-linear, so every `colorMode: "texture"` model (all 13 Kenney object
  models: tent, campfire, crate/crate-open, barrel, bedroll, canoe-hull, ruin-wall/-damaged/
  -column/-debris, tool-axe/-shovel) rendered washed-out/over-bright versus the authored Kenney
  palette. Fixed by applying the exact IEC 61966-2-1 sRGB EOTF (`THREE.Color.convertSRGBToLinear`'s
  own piecewise curve) to each channel before the tint multiply — pulled into a new pure,
  unit-tested seam (`scripts/colorSpace.mjs`'s `srgbToLinear`, pinned against a known byte→linear
  value in `scripts/colorSpace.test.mjs`; `vite.config.ts`'s test `include` extended to
  `scripts/*.test.mjs` to run it). `STONE_TINT` (the Graveyard-kit cool-cast correction) was
  re-derived against the now-correctly-decoded linear samples — the old `[0.92, 0.84, 0.6]`,
  eyeballed against washed-out output, left 3 of the 4 ruin pieces (`ruin-wall`,
  `ruin-wall-damaged`, `ruin-debris`) reading distinctly cool/blue instead of the warm
  `STONE`/`RUIN` tan-grey tokens (`src/world/landmarks.ts`); the new `[0.92, 0.85, 0.44]` reads
  warm on all four. Confirmed with real (software-GPU) build screenshots at the camp, canoe and
  ruin sites, forcing `quality: "high"` via `localStorage` so the model swap actually loads: the
  tent canvas, crates and canoe hull all read visibly richer/more saturated post-fix (before/after
  mean-RGB samples of the same pixel regions: e.g. the tent canvas panel went from a washed
  (158, 150, 137) to a richer, warmer (154, 125, 95)), and the ruin's wall/debris pieces flipped
  from a cool blue-grey cast to a warm tan-grey one. All 13 GLBs re-baked and recommitted.
- **Dispose parity.** `landmarksUpgrade.ts`'s `dispose()` disposed the swapped-in geometries but
  never detached the swapped group from the site object, contradicting its own doc comment and
  `floraUpgrade.ts`'s `swapCategory` contract (`group.remove(mesh)` before disposal). Fixed: every
  swapped `newGroup` is now tracked alongside its parent site object and removed from the scene
  graph in `dispose()` before its geometries are freed.
  `landmarksUpgrade.test.ts`'s dispose-after-swap test now also asserts the child count is
  restored (1 → 0) after `dispose()`.
- **Texel-center sampling (minor).** `bakeVertexColorFromTexture`'s nearest-texel formula switched
  from `round(u*(width-1))` (grid sampling) to the standard clamped texel-center
  `min(width-1, floor(u*width))` (`scripts/colorSpace.mjs`'s `texelIndex`, also pinned by a unit
  test). Folded into the same pipeline re-run as the sRGB fix.

Gates (all EXIT=0): `npm run lint` · `npm run build` · `npm test` (143 files / 1503 passed, 1
skipped) · `npm run check:bundle` (392.5/400 KB JS gzip, 4056.0/6000 KB total) · `npm run verify`.

## Objects slice 2 (2026-07-12) — the wildlife half: "make the wildlife look like what it really is"

Owner directive (verbatim, restated): *"Make the objects look more like what they really are."*
Scope: the four scriptable-behaviour animals — jaguar (`src/wildlife/jaguar.ts`), birds
(`src/wildlife/birds.ts`), fish (`src/wildlife/fish.ts`), snakes (`src/wildlife/snakes.ts`).
Fireflies/butterflies (`src/wildlife/fliers.ts`) stayed untouched, out of scope.

### Sourcing — investigated, all four ended up procedural

Followed the objects slice 1 precedent (try scriptable CC0 sources first) before reaching for a
procedural upgrade:

- **poly.pizza** — its search API (`api.poly.pizza`) gates behind a paid API key
  (`"You need an API key to do that"`), and being an aggregator, licences vary per uploaded model
  rather than one blanket CC0 like a Kenney kit — a real risk for a "no attribution ambiguity"
  bar, on top of the key requirement.
- **Kenney** — no 3D animal kit exists; `kenney.nl/assets/animal-pack` (the only "Animal Pack"
  hit) is a 2D icon set (verified by downloading and listing its zip: `PNG/` folders only, no
  `Models/`), not a 3D kit at all. The already-vendored Survival Kit's `fish.glb`/`fish-large.glb`
  (used by Objects slice 1's camp) are a fishing-minigame prop pair, not a school-reusable asset.
- **Quaternius (quaternius.com)** — every pack's "Just give me the Download" button opens a
  Google Drive folder — the exact scriptability dead end `floraGlb.ts`'s own header doc already
  recorded for this source in the visual-overhaul flora slice.
- **Quaternius's itch.io mirrors** — a genuinely NEW finding this slice: itch.io's browse/csrf/
  signed-download-page flow IS scriptable with plain `curl` this far (confirmed live: POST the
  page's own `csrf_token` to `/<slug>/download_url` → a signed one-time download-page URL → that
  page lists the pack's `data-upload_id`), and the licence is genuinely CC0 (confirmed on-page).
  But the FINAL `/file/<upload_id>?source=game_download` download step 404s off that flow with
  itch.io's generic "page not found" route regardless of CSRF/Referer/`X-Requested-With` header
  combinations tried — an undocumented private-endpoint quirk, unlike Kenney's plain curl-able zip
  URLs. Even had that worked, the one pack that's literally fish ("Fish Pack Animated") ships
  SKINNED meshes (rigged for itch's own animation-library clips) — `scripts/process-models.mjs`
  has no bind-pose-stripping step, so using it would have meant new pipeline engineering against
  an unverified download path. No pack in either Quaternius catalogue (site or itch.io) is a
  jungle cat or a parrot/macaw at all.

Per the slice's own licence ("upgrade the procedural bodies where sourcing fails — fully
acceptable, likely for several animals"), all four animals took the procedural path. Because
NOTHING was fetched, every upgrade is **UNCONDITIONAL on every quality tier** — no new
`quality.ts` field, following the exact "fully procedural ⇒ free on every tier" precedent Objects
slice 1 set for the overhang/fig-tree/ruin-gaze-rig.

### What changed, per animal

- **Jaguar** — chest lobe + hip lobe (a tapered torso, not one uniform dodecahedron barrel) +
  skull/muzzle/ears (a distinct protruding muzzle, not one head box) + a 3-segment curving tail +
  4 two-part (thigh+shin) legs, merged to the SAME one body `Mesh` + emissive-eyes `Mesh` (2 draw
  calls, unchanged). Seeded rosette mottling (`geometry.ts`'s new `mottleFaces`/`hash2`, a
  construction-time-only per-face colour blend — zero runtime cost, zero extra triangles) blotches
  the coat. The eyes' emissive night/day contract (2.2 / 0.15) is untouched and still pinned by
  `jaguar.test.ts`.
- **Birds** — the bare 4-sided cone body gained a head/beak/tail (merged into the SAME
  `wildlife-bird-body` `InstancedMesh`), and the wing (previously a single DEGENERATE triangle per
  side — a wing "outline" with no chord/taper) became a real tapered, swept planform (a quad per
  side). Still 2 draw calls total. The existing per-instance wing-roll "flap" hinge animation is
  untouched — it already reads as real flight motion; the new planform just gives it a real shape
  to flap.
- **Fish** — the bare flattened-cone body gained a caudal (tail) fin + a small dorsal fin, merged
  into the SAME one `wildlife-fish` `InstancedMesh` (still 1 draw call). Empirically re-derived
  (not just trusted from the prior code comment) which end is the head: `FishSystem`'s own heading
  convention (`Euler(0, heading, 0)` applied to a local point) puts the cone's WIDE base — not its
  pointed apex, which the prior comment claimed — in the direction of travel; the new fins attach
  at the pointed (tail) end, confirmed correct against that convention. A held-rigid fin would read
  STIFFER than the prior bare cone (which at least turned/darted as a whole body), so the material
  gained a cheap `onBeforeCompile` tail-sway vertex bend (`makeFishSwayPatch`, the `windPatch.ts`
  idiom transplanted onto an `InstancedMesh` material instead of a geometry swap) — zero extra
  draw calls/triangles, pure GLSL/fill-rate cost.
- **Snakes** — already the closest-reading animal per this slice's own scope note, so a reshape/
  recolour rather than new geometry: the head cone is flattened+widened into a triangular,
  pit-viper-like wedge (a scale change, same triangle count), and the coiled body gained darker
  colour banding around the coil's own angle (`mottleFaces` again, periodic in `atan2(z, x)`) —
  zero added triangles either way.

### Gates (all EXIT=0)

`npm run lint` · `npm run build` · `npm test` (144 files / 1524 passed, 1 skipped) ·
`npm run check:bundle` (393.9/400 KB JS gzip, 6.1 KB headroom; 4057.4/6000 KB total,
1942.6 KB headroom) · `npm run verify`.

### Perf

+580 triangles across the whole wildlife slice (jaguar +152, birds +392, fish +36, snakes +0) —
see `docs/perf-budget.md`'s "Objects slice 2" section for the full per-animal table and headroom
math (roughly **~55.3k** triangles of high-tier headroom left, down from ~55.9k). Zero new draw
calls (every new part merged into an existing mesh/instanced-mesh). Zero new payload bytes (fully
procedural — no model/texture fetched, so `public/assets/LICENSES.md` needs no new entry this
slice).

### Verification

Real-GPU Playwright captures (`--use-gl=angle --use-angle=metal`, `quality: "high"` forced via
`localStorage`, noon — `window.advanceTime(45000)`), each animal framed via `window.__frameView__`
— the jaguar's shot used its LIVE prowl position (read back through `render_game_to_text()`,
since a static territory-waypoint guess goes stale the moment sim time advances and it starts
moving; the other three sit at fixed centres/placements, so a hand-picked frame stays valid):

- **Jaguar** (west-valley territory, day) — reads as a real quadruped: a wider chest lobe tapering
  to a narrower hip, pointed ears, a tail curving up off the hindquarters, and a visibly darker
  rosette-mottled patch across the coat. A large, honest improvement over the prior single
  stretched-blob torso.
- **Birds** (a flock mid-orbit) — a clear swept, tapered wingspan (not the prior single-triangle
  wing "outline") and a warm beak accent per bird; reads unmistakably as birds in flight.
- **Fish** (an underwater capture, camera below `y=0` near the lagoon at `0, 142`) — the new
  caudal fin flares out behind the body and a small dorsal fin bump is visible; reads as a fish,
  not a flat dark shadow-cone.
- **Snake** (a close, near-top-down capture of a coiled placement) — the new darker banding breaks
  up the coil into a scale-like faceted pattern; a real, if modest (as scoped), improvement over
  the flat single-tone coil.

### Deviations from the brief

- No animal ended up model-sourced — see the sourcing investigation above. This was judged an
  honest, licence-respecting outcome rather than a shortfall: the brief itself sanctioned this
  path ("this is fully acceptable for this slice and likely for several animals").
- Fish gained a genuinely new animation mechanism (the tail-sway shader patch) — birds/jaguar/
  snakes kept their existing motion, judged sufficient per-animal rather than uniformly adding
  motion everywhere.
