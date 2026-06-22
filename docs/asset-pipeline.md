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
