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
2. **Load via the cached loaders** — `loadTexture(path)` and `loadModel(path)`
   dedupe concurrent loads and cache by URL, so two systems asking for the same
   texture share one fetch and one GPU upload.
3. **Loaders are created lazily** — the glTF parser / texture loader aren't
   constructed until first use, keeping idle cost at zero.
4. **Stay inside the budget** — `docs/perf-budget.md` caps total download at
   6 MB. Prefer compressed textures (webp/ktx2) and low-poly glTF; profile big
   additions against the stats overlay.

## Adding an asset

1. Drop the file under the right `public/assets/<kind>/` folder.
2. Reference it by its `public`-relative path, e.g.
   `loadModel("assets/models/car.glb")`.
3. That's it — no manifest to update. (A typed manifest can be introduced later
   if hand-typed paths become error-prone.)

## Exception: the flora model payload bypasses `loadModel`/`GLTFLoader`

`public/assets/models/flora/*.glb` (visual-overhaul slice 6) is loaded through
`src/world/floraGlb.ts`'s own minimal GLB parser, NOT rule 2's `loadModel`
seam — a measured, documented exception, not a silent inconsistency. Three's
official `GLTFLoader` is a full spec-general loader (animations/skinning/
morph targets/every extension); reaching for it here cost +13 KB gz of its
own PLUS +11.7 KB gz on the ALWAYS-eager `three` vendor chunk (it references
three-core symbols — `Skeleton`/`AnimationClip`/etc — nothing else in this
codebase uses, so `vite.config.ts`'s `manualChunks` could no longer tree-shake
them out the moment any caller made `loadModel` "live"), blowing the JS-gzip
budget (`docs/perf-budget.md`'s slice-6 entry has the full measurement). Since
`scripts/process-models.mjs`'s own output is fully known and narrow (one
mesh, one primitive, POSITION/NORMAL/COLOR_0, `KHR_mesh_quantization`, no
images/materials/animations), a purpose-built parser reads it directly at a
fraction of the bytes, referencing nothing outside
`THREE.BufferGeometry`/`BufferAttribute` (already eager everywhere). The
general `loadModel`/`GLTFLoader` seam in `assets.ts` still exists (now behind
a dynamic import, so it costs nothing until a caller actually uses it) for any
FUTURE consumer that genuinely needs full glTF features this narrow parser
does not support (animations, multiple meshes, textures, materials).
