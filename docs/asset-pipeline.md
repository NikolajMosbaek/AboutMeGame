# Asset pipeline & loading conventions

- **Issue:** #10 — Asset pipeline & loading conventions
- **Epic:** #1 — Tech Foundation & Platform
- **Implemented in:** `src/engine/assets.ts`

One place, one set of rules, so every later epic loads assets the same way.

## Where assets live

```
public/assets/
  models/     # .glb / .gltf — low-poly, draco/meshopt where it helps
  textures/   # .png / .webp / .ktx2 — power-of-two, compressed
  audio/      # .mp3 / .ogg — short SFX and looping music (Epic 7)
  fonts/      # any 3D / SDF text fonts
```

Vite copies `public/` **verbatim** into the build root (no hashing, no
bundling), so these files can be fetched lazily at runtime and cached by URL.
Source-imported assets (small icons referenced from TS/CSS) still go through the
normal hashed bundle; `public/` is for the larger, lazily-loaded 3D payload.

## The rules

1. **Always resolve through `assetUrl(path)`** — never hard-code a leading `/`.
   GitHub Pages serves the app under `/AboutMeGame/`, so `assetUrl` prepends
   `import.meta.env.BASE_URL`. A bare `/assets/x.png` 404s in production. This is
   unit-tested in `assets.test.ts`.
2. **Load via the cached loader** — `loadTexture(path)` dedupes concurrent
   loads and caches by URL, so two systems asking for the same texture share
   one fetch and one GPU upload.
3. **Loaders are created lazily** — the glTF parser / texture loader aren't
   constructed until first use, keeping idle cost at zero.
4. **Stay inside the budget** — `docs/perf-budget.md` caps total download at
   6 MB. Prefer compressed textures (webp/ktx2) and low-poly glTF; profile big
   additions against the stats overlay.

## Adding an asset

1. Drop the file under the right `public/assets/<kind>/` folder.
2. Reference it by its `public`-relative path, e.g.
   `loadTexture("assets/textures/grass.png")`.
3. That's it — no manifest to update. (A typed manifest can be introduced later
   if hand-typed paths become error-prone.)

## glTF models: no general loader today — `floraGlb.ts` is model-specific

`assets.ts` used to also carry a general `loadModel(path): Promise<GLTF>` seam
over three's official `GLTFLoader` (dynamically imported), symmetric with
`loadTexture`. It was **removed** (a visual-overhaul slice 6 code-review
finding) once `grep` confirmed it had zero callers: `GLTFLoader` is a full
spec-general loader (animations/skinning/morph targets/every extension), and
reaching for it measured +13 KB gz of its own PLUS +11.7 KB gz on the
ALWAYS-eager `three` vendor chunk the moment any caller made `loadModel`
"live" (it references three-core symbols — `Skeleton`/`AnimationClip`/etc —
nothing else in this codebase uses, so `vite.config.ts`'s `manualChunks`
could no longer tree-shake them out of that eager bucket) — see
`docs/perf-budget.md`'s slice-6 entry for the full measurement.

`public/assets/models/flora/*.glb` (visual-overhaul slice 6) is instead loaded
through `src/world/floraGlb.ts`'s own minimal, purpose-built GLB parser: since
`scripts/process-models.mjs`'s own output is fully known and narrow (one mesh,
one primitive, POSITION/NORMAL/COLOR_0, `KHR_mesh_quantization`, no
images/materials/animations), it parses that shape directly at a fraction of
the bytes, referencing nothing outside `THREE.BufferGeometry`/`BufferAttribute`
(already eager everywhere) — zero cost added to the `three` chunk. Unlike
`loadTexture`, it does **not** cache by URL (see its own header doc): the
title ↔ playing replay loop (`App.tsx`) can mount `floraUpgrade.ts`'s upgrade
more than once per page load, and a URL-keyed cache would hand a later mount
geometries an earlier mount's teardown already disposed.

A general glTF loader is a small, well-understood re-addition (a standard
`three/examples/jsm` import behind the same dynamic-`import()` idiom) the
moment a real caller needs the features this narrow parser doesn't support
(animations, multiple meshes, textures, materials) — do not restore it
speculatively ahead of that need.
