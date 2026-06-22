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
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

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
let _gltfLoader: GLTFLoader | null = null;

function textureLoader(): THREE.TextureLoader {
  return (_textureLoader ??= new THREE.TextureLoader());
}
function gltfLoader(): GLTFLoader {
  return (_gltfLoader ??= new GLTFLoader());
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
    pending = gltfLoader().loadAsync(url);
    gltfCache.set(url, pending);
  }
  return pending;
}

/** Test/teardown hook: drop cached loads so a fresh load is forced. */
export function clearAssetCache(): void {
  textureCache.clear();
  gltfCache.clear();
}
