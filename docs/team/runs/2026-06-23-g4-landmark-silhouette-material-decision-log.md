# G4 — Landmark silhouette & material upgrade (T15: consolidated decision log)

**Date:** 2026-06-23
**Phase:** Converge → Plan → Verify (the full G4 trail, consolidated)
**Slice:** G4 — richer per-archetype silhouettes on two shared materials.
**Branch:** `feat/g4-landmark-meshcount-t2`
**Scope:** canvas-side only — `src/world/landmarks.ts` (+ its tests) and this
run log under `docs/team/runs/`.

> **What T15 is.** Guardrail 4 (*Auditable*) requires every run to leave one
> decision trail recording the converged design and its rationale, the plan, the
> verification results, and the PR-ready evidence. The G4 slice produced several
> per-task records (converge, the gzip-delta gate, the running-build visual
> verify); this entry **consolidates** them into the single auditable trail:
> the converged design, the Quality critic's flaw fix, and the **cited**
> Vitest / build / measured-gzip / Playwright evidence — each linked back to the
> per-task log that produced it. This is prose + cited evidence; it changes no
> product behaviour.

## Linked per-task evidence (the trail)

- **Converge / design rationale:** [`2026-06-23-g4-landmark-silhouette-material-converge.md`](./2026-06-23-g4-landmark-silhouette-material-converge.md)
  — the converged design, the genuine-conflict resolution, the rejected
  alternatives, and the Quality-critic revision posture.
- **Measured gzip entry-chunk delta gate:** [`2026-06-23-g4-landmark-gzip-entry-chunk-delta.md`](./2026-06-23-g4-landmark-gzip-entry-chunk-delta.md)
  — the `main`-vs-branch `vite build` measurement and the < 2 KB gate result.
- **Running-build visual verification (Playwright):** [`2026-06-23-g4-landmark-tour-verify.md`](./2026-06-23-g4-landmark-tour-verify.md)
  — the `--landmark-tour` smoke run over all 8 archetypes and its `VERIFY OK`.

## The converged design (what shipped)

**One sentence:** each of the 8 landmark archetypes gains a more characterful,
fully-procedural, flat-shaded silhouette, built from richer sub-primitives whose
transforms are **baked into geometry** and **merged per landmark** into ONE stone
mesh + ONE accent mesh, rendered with **two shared materials total** instead of
~39 per-landmark material instances.

### Two shared materials (down from ~39)

Created **once per `buildLandmarks` call** (a DI seam passed into
`buildArchetype`, **not** module-level singletons — a rebuild after `dispose()`
must get fresh materials, else use-after-dispose):

- **stone** — `MeshStandardMaterial({ flatShading:true, roughness:0.7, vertexColors:true })`.
- **accent** — `MeshStandardMaterial({ flatShading:true, roughness:0.5,
  vertexColors:true, emissive:0xffffff, emissiveIntensity ~1.0 })`, tuned just
  under the tower lamp so the lamp stays the brightest source.

The signature hue rides a per-vertex **`color`** attribute; the accent material's
white base **emissive modulated by that vertex colour** gives each landmark a
signature-hued glow that catches the shipped **G2 bloom** — from **one** shared
accent material, with no per-landmark material explosion. Both materials are
`vertexColors === true` and `flatShading === true`; exactly **two** instances are
shared across all 13 landmarks (object-identity asserted in the suite).

### Per-landmark merge

Build richer sub-primitives in local space; **bake each sub-primitive's
transform into its geometry** (`applyMatrix4` / `translate` / `rotate` / `scale`)
**before** merge — `BufferGeometryUtils.mergeGeometries` merges raw geometry and
ignores `Object3D` transforms, so an un-baked primitive collapses to the origin
and the headless name/position test would NOT catch it. Every source is
`toNonIndexed()` with a uniform `color` attribute stamped on (no `mergeVertices`,
so flat shading keeps hard normals), so all share `{position,normal,uv,color}`
and merge non-null. Sources split into a stone set and an accent set:
`mergeGeometries(stoneSet,false)` → one stone mesh, `mergeGeometries(accentSet,false)`
→ one accent mesh. Merged meshes re-set `castShadow`/`receiveShadow`.

### Beacon and tower lamp stay discrete (un-merged, named)

The **beacon** (all 13) and the **tower lamp** stay discrete, named, **un-merged**
meshes exactly as today — they are **not folded** into the merge. The beacon
keeps additive / `depthWrite:false` / `transparent`; the lamp keeps its own
emissive material with `emissive === anchor.color` and `emissiveIntensity > 0.9`.
`BeaconPulseSystem` (`buildWorld.ts`), both bloom-invariant tests, and the
discovery anchor depend on these, so they stay untouched.

### Seam unchanged

`buildLandmarks` signature, the `PlacedLandmark`/`Landmarks` interfaces, the
`landmark:<poiId>` naming, the recorded `position`/`color`, and the `dispose()`
contract are all verbatim. Epic 4 discovery, Epic 5 nav hints/reveal, and the
audio seam consume only `placed[].{poiId,position,color}` by id (distance-based);
none read sub-mesh geometry. Source sub-geometries are consumed by
`mergeGeometries` (copied into a new buffer) and disposed immediately at build;
only the merged geometries, the two shared materials (each tracked once), and the
beacon/lamp geometries+materials go in `disposables` — no double-dispose, no
leaked source.

## Quality flaw fix — the fixed per-archetype count map

The prior design added ONE brand-new dedicated emissive-accent mesh to **every**
landmark and encoded `tower = 4` / `mirror = 4`, a direct **draw-call** regression
on the two single-primitive archetypes (each has only one mergeable primitive
plus a non-mergeable special mesh, so the +1 cannot be absorbed). The Quality
critic's **material draw-call flaw** is fixed by making the accent set a **merged
group** that **reuses/replaces** the existing special mesh on those archetypes,
asserted as a **fixed per-archetype count map** (test-first) so a stray +1 reds
the gate instead of being blessed:

| archetype | today | target | Δ |
|-----------|------:|-------:|---|
| gate      | 4 | **3** | −1 |
| monolith  | 3 | **3** |  0 |
| tower     | 3 | **3** |  0 |
| foundry   | 3 | **3** |  0 |
| dam       | 3 | **3** |  0 |
| station   | 7 | **3** | −4 |
| ring      | 9 | **3** | −6 |
| mirror    | 3 | **3** |  0 |

**No archetype increases**; 3 of 8 drop materially. Key fixes:

- **Tower stays 3, NOT 4** — the **lamp** is already the signature-colour emissive
  bloom source, so the tower needs no separate accent mesh (its accent role *is*
  the lamp). Tower = merged stone + the existing named `lamp` + beacon.
- **Mirror stays 3, NOT 4** — the accent mesh **replaces** the deleted bespoke
  `metalness:0.9 glassMat` glass plate (the reflective face becomes the merged
  accent). Mirror = merged stone frame + accent (was glass) + beacon.

Material instance total falls from **~39 to 2**.

## Verification — both automated gates green (cited)

### Full Vitest suite — `npm test` → **exit 0**

```
 Test Files  68 passed (68)
      Tests  603 passed (603)
```

`src/world/landmarks.test.ts` keeps the **4 original contract assertions**
(per-anchor `landmark:<poiId>`, beacon child at/above sea level) and the **2 bloom
invariants** (beacon additive/transparent/`depthWrite:false`; tower lamp
`emissive === anchor.color`, `emissiveIntensity > 0.9`) **verbatim, unweakened**,
plus the net-new G4 guards: all-13-beacons strengthening, two-shared-materials
identity, beacon/lamp-discrete, the fixed per-archetype mesh-count map (all = 3,
never above today), the signature-colour vertex attribute, the transform-baking
bounding-box guard, the triangle ceiling (total landmark triangles **< 4000**,
well under the 500k/frame budget), the richer-silhouette floor, and
dispose-exactly-once. (Cited from the T14 tour-verify log, which re-ran the full
suite after the framing seam landed.)

### Production build — `npm run build` (`tsc --noEmit && vite build`) → **exit 0**

```
✓ 110 modules transformed.
dist/index.html                   2.05 kB │ gzip:   0.84 kB
dist/assets/index-CDvBh_OH.js   229.00 kB │ gzip:  75.77 kB   <- entry chunk
dist/assets/three-COLka6mN.js   500.28 kB │ gzip: 125.83 kB   <- three vendor chunk
✓ built in 688ms
```

`mergeGeometries` (BufferGeometryUtils) folds into the existing `three-*.js`
vendor chunk as tree-shaken code; the 500 kB warning is the pre-existing vendor
chunk, unrelated to this slice.

### Measured gzip entry-chunk delta — **PASS** (gate, not invariant)

This is a **measured** gate, **not an asserted runtime invariant**: there is no
runtime expression that yields a bundle-size delta, so it was established by an
actual `vite build` of `main` vs the branch and comparing the gzipped entry
chunk (`gzip -9 -c <file> | wc -c`, clean worktrees, shared `node_modules`).

| chunk | `main` gzip | branch gzip | gzip Δ |
|-------|------------:|------------:|-------:|
| entry `index-*.js` | 75,000 | 75,508 | **+508 bytes** |
| vendor `three-*.js` | 123,711 | 124,649 | +938 bytes |

- **Entry-chunk gzip delta: +508 bytes** — under the **2 KB (2048-byte)** ceiling.
  **Gate: PASS** (508 < 2048).
- The `three` vendor chunk absorbed the `BufferGeometryUtils` code via vite's
  id-based `manualChunks` matcher, confirming the design claim that the import is
  CODE bytes folding into the existing vendor chunk, not the entry.

Full measurement: linked gzip-delta log above.

### Running-build visual verification (Playwright) — **VERIFY OK** (exit 0)

`node scripts/verify-game.mjs <url> --landmark-tour` against `vite preview` (the
production build), headless Chromium with software WebGL (`--use-gl=angle
--use-angle=swiftshader`). For each of the 8 archetypes it frames an elevated 3/4
still via the `__frameView__` seam, decodes the PNG in-page, and asserts: positive
fps + the full 13-landmark count, a built structure framed (≥ 2% central-band
coverage), a **signature-hued accent glow** present (≥ 0.5% hue-matched bright
pixels — the emissive **accent** + beacon catching the G2 **bloom**), the 8
silhouettes distinct (coverage spread ≥ 2%), and no console/WebGL/three errors.

```
LANDMARK TOUR (8 procedural archetypes, framed one still each):
  gate      #ffcb47 structure=16.64% accent(hued)=2.338% fps=29.66 landmarks=13
  monolith  #7ad1ff structure=19.21% accent(hued)=10.393% fps=29.66 landmarks=13
  foundry   #ff8a5c structure=27.96% accent(hued)=1.362% fps=29.66 landmarks=13
  tower     #ffe066 structure=11.21% accent(hued)=1.356% fps=29.66 landmarks=13
  dam       #5cc8ff structure=18.92% accent(hued)=9.854% fps=29.66 landmarks=13
  station   #8affc1 structure=15.16% accent(hued)=2.517% fps=29.66 landmarks=13
  ring      #ffa3d1 structure=17.72% accent(hued)=1.282% fps=29.66 landmarks=13
  mirror    #d9e3ff structure=18.87% accent(hued)=9.113% fps=29.66 landmarks=13
  structure-coverage spread across the 8 = 16.75% (>=2% ⇒ distinct silhouettes)
VERIFY OK
```

All silhouettes read as flat-shaded (hard-edged facets, no Gouraud gradients),
purely procedural — no GLTF/textures, no animation/rigging, no interiors, no new
asset bytes. Committed screenshots are the source of truth:
`docs/team/runs/assets/2026-06-23-g4-landmark-tour-verify/landmark-<archetype>.png`.

## Scope confirmed — `git diff --name-only main...HEAD`

Canvas-side product code (`src/`) plus run logs under `docs/team/runs/` only:

- `src/world/landmarks.ts` — the G4 implementation (richer silhouettes, merge,
  two shared materials).
- `src/world/landmarks.test.ts` — net-new G4 guards + the verbatim contract/bloom
  assertions.
- `src/world/landmarks.gzip.runlog.test.ts`,
  `src/world/landmarks.decisionlog.test.ts` — the run-log gate guards.
- `src/engine/Engine.ts` / `Engine.test.ts`, `src/engine/GameCanvas.tsx` /
  `GameCanvas.test.tsx` / `globals.d.ts`, `scripts/verify-game.mjs` — the T14
  `renderFromView` / `__frameView__` running-build framing seam + its coverage.
- `docs/team/runs/2026-06-23-g4-landmark-*.md` (converge, gzip-delta, tour-verify,
  this decision log) + the tour screenshots.

**No edit outside `src/` (canvas-side) and `docs/team/runs/`.** The
TextView / no-WebGL path is untouched (landmarks build only on the WebGL path
inside `buildWorld`); no new UI control was added; **nothing under `.claude/`**
(agents, workflows, skills, settings, hooks) — the team's own process and
**harness** are unchanged.
