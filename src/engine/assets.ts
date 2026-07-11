// Asset pipeline & loading conventions (issue #10).
//
// Conventions, in one place so every later epic follows them:
//
//  • Static assets live under `public/assets/<kind>/…` — `models/`, `textures/`,
//    `audio/`, `fonts/`. Vite copies `public/` verbatim into the build root, so
//    these are *not* hashed/bundled and can be fetched lazily at runtime.
//  • Never hard-code a leading "/". GitHub Pages serves the app under a
//    sub-path (`/AboutMeGame/`), so every URL is resolved through `assetUrl`,
//    which prepends Vite's `BASE_URL`. A bare "/assets/x.png" would 404 in prod.
//  • Loads are async and cached by URL. Loaders are created lazily so the audio
//    decoder / GLTF parser aren't paid for until something needs them.
//
// Keep the actual binary assets small (the perf budget in `src/perf/perfBudget`
// caps total download); prefer compressed textures and low-poly glTF.

import * as THREE from "three";
import type { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Resolve a `public/`-relative path to a runtime URL under the deploy base.
 *  `assetUrl("assets/textures/grass.png")` →
 *  `/AboutMeGame/assets/textures/grass.png` in production, `/assets/…` in dev. */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const clean = path.replace(/^\/+/, "");
  return base.endsWith("/") ? base + clean : base + "/" + clean;
}

const textureCache = new Map<string, Promise<THREE.Texture>>();
const gltfCache = new Map<string, Promise<GLTF>>();

let _textureLoader: THREE.TextureLoader | null = null;
let _gltfLoaderPromise: Promise<GLTFLoader> | null = null;

function textureLoader(): THREE.TextureLoader {
  return (_textureLoader ??= new THREE.TextureLoader());
}

// `GLTFLoader` is imported DYNAMICALLY (never a static top-level `import`) —
// a visual-overhaul slice 6 finding, kept as a standing defensive discipline
// for this seam even though that slice's own flora models end up using the
// narrower `src/world/floraGlb.ts` parser instead (see that module's header
// doc: the full official `GLTFLoader` measured at +11.7 KB gz on the ALWAYS-
// eager `three` vendor chunk on top of its own ~13 KB gz, because it
// references three-core symbols — `Skeleton`/`AnimationClip`/etc. — nothing
// else in this codebase uses, so they could no longer be tree-shaken out of
// that eager bucket the moment ANY caller made `loadModel` "live"). Since
// `assets.ts` is itself eagerly reachable (via `loadTexture`, used by
// `terrain.ts`/`boundaries.ts`), a static `import { GLTFLoader }` here would
// pay that cost the instant a FUTURE caller (this seam is still a real,
// general glTF-loading utility) calls `loadModel` — dynamically importing it
// keeps GLTFLoader's own code chunked with whichever importer actually
// reaches it at runtime, without changing this module's public
// `loadModel(path): Promise<GLTF>` contract.
function gltfLoader(): Promise<GLTFLoader> {
  return (_gltfLoaderPromise ??= import("three/examples/jsm/loaders/GLTFLoader.js").then(
    (mod) => new mod.GLTFLoader(),
  ));
}

/** Load (and cache) a texture by its `public/`-relative path, sRGB-tagged for
 *  colour maps. Repeated calls for the same path share one in-flight load. */
export function loadTexture(path: string): Promise<THREE.Texture> {
  const url = assetUrl(path);
  let pending = textureCache.get(url);
  if (!pending) {
    pending = textureLoader()
      .loadAsync(url)
      .then((tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
      });
    textureCache.set(url, pending);
  }
  return pending;
}

/** Load (and cache) a glTF model by its `public/`-relative path. */
export function loadModel(path: string): Promise<GLTF> {
  const url = assetUrl(path);
  let pending = gltfCache.get(url);
  if (!pending) {
    pending = gltfLoader().then((loader) => loader.loadAsync(url));
    gltfCache.set(url, pending);
  }
  return pending;
}

/** Test/teardown hook: drop cached loads so a fresh load is forced. */
export function clearAssetCache(): void {
  textureCache.clear();
  gltfCache.clear();
}
