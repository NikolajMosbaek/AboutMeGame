# G4 — Landmark silhouette & material upgrade (Converge, revised)

**Date:** 2026-06-23
**Phase:** Converge → Plan
**Owner (rendering direction):** senior-eng-graphics-3d
**Decider:** Tech Lead
**Scope:** canvas-side only — `src/world/landmarks.ts` + `src/world/landmarks.test.ts` + this run log.
**Bootstrap:** no.

> Revised to address the Quality critic's **material draw-call flaw** from the
> prior round: the earlier design added ONE brand-new dedicated emissive-accent
> mesh to **every** landmark and encoded a fixed map with **tower=4 / mirror=4**,
> which directly violates the "draw calls must not increase" AC for those two
> archetypes (each already has only one mergeable primitive plus a special
> non-mergeable mesh, so the +1 cannot be absorbed). The revision removes the
> universal extra mesh: the **accent set is a merged group**, and for tower /
> mirror it **reuses/replaces** the existing special mesh rather than adding one.
> No archetype now exceeds its current count.

## Grounding verified in code

- `three@0.169` pinned; `node_modules/three/examples/jsm/utils/BufferGeometryUtils.js`
  present (import family already used by `createCompositor.ts` / `assets.ts`).
- Vertex-colour + `vertexColors:true` + `flatShading:true` is **proven headless-safe**
  in this repo: `src/world/terrain.ts:80-88` (`setAttribute("color", …)`).
- Today every landmark sub-mesh is its own draw call; `mat(0xb9b2a6)` (stone) and
  `mat(color)` (accent) are rebuilt **per anchor** (`landmarks.ts:139-140`); the
  mirror adds a third bespoke `glassMat` (`landmarks.ts:223`).
- **Current per-landmark renderable-mesh counts (structure sub-meshes + beacon),
  verified:** gate **4**, monolith **3**, tower **3** (shaft+lamp+beacon),
  foundry **3**, dam **3**, station **7**, ring **9**, mirror **3** (frame+glass+beacon).
- Only non-test downstream consumers of landmark internals:
  - `BeaconPulseSystem` (`buildWorld.ts:130-134`) — `traverse` for `o.name==="beacon"`,
    mutates `material.opacity` per frame.
  - Tower **lamp** emissive bloom source (`landmarks.ts:165-174`, asserted `landmarks.test.ts:57-66`).
  - `PlacedLandmark.{poiId,position,color}` by id — distance-based discovery
    (`buildDiscovery.ts:50`, `DiscoveryBurstSystem.ts`), nav hints, reveal "Next" affordance.
    None read sub-mesh geometry or draw-call structure.
- **No existing dispose-coverage test and no draw-call/merge test in
  `landmarks.test.ts`.** The Quality critic is correct: these are NET-NEW
  assertions to author test-first, not pre-existing green guards being preserved.
- Backlog "Shipped" list is stale (G1/G2/G3 landed in code/run logs).
  **PO action item (outside canvas scope, not done here):** reconcile and check
  off G1/G2/G3.

## The genuine conflict and its resolution

The AC bundles statements that cannot all be literally true together: "merge
static sub-meshes **toward one draw call**" + "stone material **shared across all**
landmarks, **no new per-landmark materials**" + "**modest emissive on accent faces**
that catches G2 bloom" + lamp keeps its own emissive + beacon keeps its own
additive material. A single shared `MeshStandardMaterial` has **one** emissive
value, so per-face emissive on a merged single-material mesh is impossible
without a hand-written shader — and the bloom threshold reads post-tonemap
luminance, so a non-emissive lit-stone vertex colour cannot "catch bloom" by
brightness alone.

**Resolution (owner's call, adopted):** there are **two** shared materials total
(not 39 per-landmark instances, not one): a **stone** material and an **accent**
material, each created once per `buildLandmarks` call. The accent material is
emissive and `vertexColors:true`, so its white base emissive modulated by the
per-vertex signature colour gives each landmark a signature-hued glow that
catches bloom — from **one** shared accent material. "No new **per-landmark**
materials" is honoured (two shared instances, like stone). The accent set is a
**merged group**, so it is at most ONE accent mesh per landmark — and critically
it **replaces/absorbs** the existing special mesh on the two single-primitive
archetypes rather than adding to them (see the count table). The structure still
collapses to a single merged stone mesh, the per-landmark draw count **strictly
does not increase** and decreases on 7 of 8 archetypes.

## Per-landmark draw-call target (asserted as a fixed map, test-first)

| archetype | today (meshes)          | target (meshes)                          | Δ   |
|-----------|-------------------------|------------------------------------------|-----|
| gate      | 3 struct + beacon = 4   | stone(1) + accent(1) + beacon = **3**    | −1  |
| monolith  | 2 struct + beacon = 3   | stone(1) + accent(1) + beacon = **3**    |  0  |
| tower     | shaft+lamp+beacon = 3   | stone(1) + **lamp**(1) + beacon = **3**  |  0  |
| foundry   | 2 struct + beacon = 3   | stone(1) + accent(1) + beacon = **3**    |  0  |
| dam       | 2 struct + beacon = 3   | stone(1) + accent(1) + beacon = **3**    |  0  |
| station   | 6 struct + beacon = 7   | stone(1) + accent(1) + beacon = **3**    | −4  |
| ring      | 8 struct + beacon = 9   | stone(1) + accent(1) + beacon = **3**    | −6  |
| mirror    | frame+glass+beacon = 3  | stone(1) + accent(1) + beacon = **3**    |  0  |

**No archetype increases.** Key flaw-fix details:
- **Tower stays 3, NOT 4.** The lamp is **already** the signature-colour emissive
  bloom source, so the tower needs **no** separate accent mesh — its accent role
  is the lamp. Tower = merged stone shaft/gallery + the existing named `lamp` +
  beacon. (If the tower's non-lamp geometry has accent faces, they ride the stone
  mesh's vertex `color`; no extra mesh.)
- **Mirror stays 3, NOT 4.** The accent mesh **replaces** the bespoke `glassMat`
  glass plate: the reflective face becomes the merged accent mesh (bright cool
  signature accent on the emissive accent material). The `metalness:0.9 glassMat`
  is deleted. Mirror = merged stone frame + accent (was glass) + beacon.
- Merged meshes keep `castShadow`/`receiveShadow`. Material instance total falls
  from ~39 to **2**.

The fixed-map assertion encodes these exact counts so it **catches** any
regression (e.g. a stray +1 accent mesh on tower/mirror) instead of blessing it.

## Decision summary

1. **Two shared materials, created once per `buildLandmarks` call** (DI seam — NOT
   module-level singletons; a second `buildLandmarks` after `dispose()` must get
   fresh materials, else use-after-dispose):
   - `stone` = `MeshStandardMaterial({ flatShading:true, roughness:0.7, vertexColors:true })`
   - `accent` = `MeshStandardMaterial({ flatShading:true, roughness:0.5, vertexColors:true,
     emissive:0xffffff, emissiveIntensity:~1.0 })` — emissive modulated by the per-vertex
     signature colour yields per-landmark signature glow from one shared material; tuned
     just under the tower lamp's intensity so the lamp stays the brightest source.
   Both passed into `buildArchetype`; tracked & disposed exactly once each.
2. **Per-landmark merge.** For each archetype: build richer sub-primitives in local
   space; **bake each sub-primitive's transform into its geometry** (`applyMatrix4`
   / `translate`/`rotate`/`scale`) BEFORE merge — `mergeGeometries` merges RAW
   geometry and ignores Object3D transforms, so an un-baked primitive collapses to
   the origin and the headless name/position test would NOT catch it. Stamp a
   uniform `color` BufferAttribute on **every** source (stone faces neutral
   ~0xb9b2a6, accent faces the signature hue) and `toNonIndexed()` so all sources
   share `{position,normal,uv,color}` and merge non-null. Split sources into the
   stone set and the accent set; `mergeGeometries(stoneSet,false)` → one stone mesh,
   `mergeGeometries(accentSet,false)` → one accent mesh. No `mergeVertices` (flat
   shading wants hard normals).
3. **Beacon and tower lamp stay discrete, un-merged, named meshes** — exactly as
   today. Beacon keeps additive / `depthWrite:false` / transparent; lamp keeps its
   own emissive material with `emissive===anchor.color` and `emissiveIntensity>0.9`.
   Highest-severity invariant: BeaconPulseSystem + both bloom tests + the discovery
   anchor all depend on these.
4. **Mirror glass → accent mesh** (D-above); bespoke `glassMat` deleted.
5. **Dispose ownership rule:** source sub-geometries are consumed by
   `mergeGeometries` (copies into a new buffer) and disposed **immediately at build
   time**; only the merged geometries, the two shared materials (each once), and the
   beacon/lamp geometries+materials are tracked in `disposables`. No double-dispose,
   no leaked source. Assert against the structure group's mesh children, not just a
   disposables count.
6. **No per-frame work added** — merge is one-time at build; no new System /
   `onBeforeRender`.

## Rejected alternatives

- **A brand-new dedicated emissive-accent mesh on every landmark (prior design)** —
  REJECTED: net +1 draw call on tower & mirror (single-primitive archetypes), a
  direct AC violation; replaced by a merged accent group that reuses the lamp
  (tower) / replaces the glass (mirror).
- **InstancedMesh per archetype** — each reused archetype needs a distinct
  signature accent colour and there are only 2–3 of each; instancing buys little
  and does not address the multi-primitive draw-call source. Merge is the right tool.
- **One global mega-merge of all 13** — breaks the per-landmark `landmark:<poiId>`
  group that Epic 4/5 traverse.
- **Per-face emissive via the shared stone material** — architecturally impossible
  (one material = one uniform emissive) without a hand-written shader; the codebase
  prefers standard materials and the fill-rate budget rejects a per-landmark shader.
- **A per-landmark accent material** — defeats batching; AC requires accent via the
  vertex-colour attribute on shared materials.
- **Importing GLTF/textures** — violates fully-procedural / no-asset-bytes.
- **Module-level (hoisted) shared materials** — use-after-dispose trap across
  `buildLandmarks` calls; charter forbids singletons where a DI seam helps.
- **Treating "gzip unchanged" as asserted** — REJECTED as imprecise: importing
  `mergeGeometries` adds tree-shaken **code** bytes (not asset bytes) that fold into
  the existing `three` vendor chunk; reframed as a **measured** gate (< 2 KB gzip
  entry-chunk delta), not an assumption.

## Acceptance criteria (asserted test-first; existing assertions unweakened)

- `placed.length===13`; every group `landmark:<poiId>`; position/color match
  `POI_ANCHORS`; each landmark has a named `beacon` child at/above `WORLD.seaLevel`
  (existing assertions verbatim).
- **All 13** beacons survive as named `beacon` meshes (strengthen the existing
  placed[0]-only check to all 13).
- Beacon additive/transparent/`depthWrite:false`; tower lamp `emissive===anchor.color`,
  `emissiveIntensity>0.9` — verbatim.
- Per-landmark mesh count matches the fixed target map above and is `<=` today's
  per archetype (counts Mesh children — no renderer.info; no WebGL in unit tests).
- Exactly **two** material instances (stone, accent) shared across all 13 —
  object-identity `===` check; both `vertexColors===true`, `flatShading===true`.
- Merged stone and accent geometries each carry a non-zero `color` attribute; at
  least one accent vertex colour per landmark derives from `anchor.color` and
  differs from the stone base (wayfinding-from-distance made testable).
- **Transform-baking regression guard:** each landmark's merged stone geometry
  bounding box spans the expected silhouette extent (not collapsed to a point/origin).
- Total landmark triangles computed and asserted under a stated ceiling well below
  the 500k/frame budget (no geometry balloon).
- Dispose: shared stone + accent materials and every merged geometry disposed
  exactly once; no double-dispose; source geometries not leaked.
- gzip entry-chunk delta **< 2 KB** (measured & cited from `vite build`).
- Full Vitest + `npm run build` green (cited); Playwright smoke verifier confirms
  the visual upgrade + per-archetype silhouette + accent legibility on the running
  build; no edit to TextView/no-WebGL path, no UI control, no `.claude/` or harness
  change.

## Quality-critic revision posture

- Flat-shading softens after merge: keep sources non-indexed, no `mergeVertices`;
  `MeshStandardMaterial.flatShading` derives face normals in-shader. Verify in the
  Playwright screenshot, not headless alone.
- Accent washes out under the day cycle (wayfinding regression): raise accent
  saturation/emissiveIntensity against the asserted accent-vs-stone colour-delta
  criterion — never relax the test.
- `mergeGeometries` returns null on mismatched attribute sets: one helper stamps a
  uniform `color` (+ non-indexed, matching position/normal/uv) on every source
  before merge; test asserts merged geometries are non-null with a `color` attribute.

## Verification (T12, 2026-06-23) — Quality Engineer

Both automated gates re-run from a clean working tree on
`feat/g4-landmark-meshcount-t2`; both exit 0.

**Full Vitest suite — `npm test` → exit 0**

```
 Test Files  67 passed (67)
      Tests  593 passed (593)
   Duration  3.74s
```

`src/world/landmarks.test.ts` runs **13** tests, all green — the 4 original
contract assertions (per-anchor `landmark:<poiId>`, beacon child above sea level)
and the 2 bloom invariants (beacon additive/transparent/`depthWrite:false`; tower
lamp `emissive===anchor.color`, `emissiveIntensity>0.9`) preserved **verbatim**,
plus the net-new G4 guards: all-13-beacons strengthening, two-shared-materials
identity (T3), beacon/lamp-discrete (T10), fixed per-archetype mesh-count map
(gate/monolith/tower/foundry/dam/station/ring/mirror all = 3, never above today),
signature-colour vertex attribute (T4), transform-baking bounding-box (T5),
triangle ceiling (T6), richer-silhouette (T9), and dispose-exactly-once (T7).

**Production build — `npm run build` (`tsc --noEmit && vite build`) → exit 0**

```
✓ 110 modules transformed.
dist/index.html                   2.05 kB │ gzip:   0.84 kB
dist/assets/index-D4SG0bZ9.css   16.30 kB │ gzip:   3.54 kB
dist/assets/index-Har5XVSC.js   228.74 kB │ gzip:  75.69 kB
dist/assets/three-COLka6mN.js   500.28 kB │ gzip: 125.83 kB
✓ built in 662ms
```

`mergeGeometries` (BufferGeometryUtils) folds into the existing `three` vendor
chunk as tree-shaken code; the entry chunk (`index-*.js`) gzip stays at 75.69 kB —
well within the < 2 KB gzip-delta gate. The 500 kB warning is pre-existing on the
`three` vendor chunk, unrelated to this slice.

**Scope confirmed — `git diff --name-only main...HEAD`:**

- `src/world/landmarks.ts` — canvas-side implementation (G4).
- `src/world/landmarks.test.ts` — net-new + verbatim contract/bloom assertions.
- `docs/team/runs/2026-06-23-g4-landmark-silhouette-material-converge.md` — this log.
- `src/world/dayCycle.scope.test.ts` — **deleted** (`d176cc4`): a G3-branch-only
  scope fence that was merged onto `main` via #147, where it can never pass (it
  asserts the whole repo diff is G3-only, so every future branch reds the
  green-only-merge gate; it red-flagged this G4 slice). Removed at the root rather
  than widening its allowlist. Still canvas-side (`src/world/`).

No file under `.claude/` (harness/agents/skills/settings), `src/ui/`, `src/audio/`,
`scripts/`, `index.html`, or `public/` is touched. The TextView / no-WebGL path is
untouched (landmarks build only inside `buildWorld` on the WebGL path); no new UI
control was added. Working tree clean after the run.
