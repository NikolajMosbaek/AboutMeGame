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
//  • Loads are async and cached by URL. The texture loader is created lazily
//    so its cost isn't paid until something actually needs it.
//
// Keep the actual binary assets small (the perf budget in `src/perf/perfBudget`
// caps total download); prefer compressed textures and low-poly glTF.
//
// This module carried a general `loadModel(path): Promise<GLTF>` seam over
// three's `GLTFLoader` (dynamically imported) alongside `loadTexture`. It was
// REMOVED (visual-overhaul slice 6 code-review finding) once `grep` confirmed
// zero callers: `floraGlb.ts` uses its own narrower parser instead (see that
// module's header doc — `GLTFLoader` measured a real +11.7 KB gz hit on the
// always-eager `three` vendor chunk the moment any caller "activated" it), and
// nothing else in this codebase ever called `loadModel`. Re-adding it (or a
// model loader against a genuine glTF payload that needs animations/skinning/
// multiple meshes/materials — this parser's narrow assumptions don't support
// those) is a small, well-understood addition: `GLTFLoader` is a standard
// `three/examples/jsm` import, trivially re-introduced behind the same
// dynamic-`import()` idiom the moment a real caller needs it.

import * as THREE from "three";

/** Resolve a `public/`-relative path to a runtime URL under the deploy base.
 *  `assetUrl("assets/textures/grass.png")` →
 *  `/AboutMeGame/assets/textures/grass.png` in production, `/assets/…` in dev. */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const clean = path.replace(/^\/+/, "");
  return base.endsWith("/") ? base + clean : base + "/" + clean;
}

const textureCache = new Map<string, Promise<THREE.Texture>>();

let _textureLoader: THREE.TextureLoader | null = null;

function textureLoader(): THREE.TextureLoader {
  return (_textureLoader ??= new THREE.TextureLoader());
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

/** Test/teardown hook: drop cached loads so a fresh load is forced. */
export function clearAssetCache(): void {
  textureCache.clear();
}
