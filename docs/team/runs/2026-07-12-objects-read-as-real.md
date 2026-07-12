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
