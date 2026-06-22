import * as THREE from "three";
import type { RendererLike } from "./types.ts";

export interface RendererConfig {
  canvas: HTMLCanvasElement;
  /** Cap the device pixel ratio. >2 buys little on retina but costs a lot of
   *  fill rate on mobile, so the quality scaler (Epic 6) tunes this down. */
  maxPixelRatio?: number;
  antialias?: boolean;
  /** Enable the real-time shadow map. The quality scaler turns this off on the
   *  low tier (#47), where shadows are the costliest single feature. */
  shadows?: boolean;
}

/**
 * Build the production `THREE.WebGLRenderer`. Isolated in its own module so the
 * Engine and every test can stay WebGL-free: nothing that runs under jsdom ever
 * imports this file. Quality scaling (Epic 6) reaches the same renderer through
 * the returned `RendererLike` — `maxPixelRatio` and `shadows` come straight from
 * the resolved `QualityConfig`, and the cheap parts can be re-applied live (see
 * `applyRendererQuality`).
 */
export function createRenderer(config: RendererConfig): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas: config.canvas,
    antialias: config.antialias ?? true,
    powerPreference: "high-performance",
  });
  const ratio = Math.min(
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    config.maxPixelRatio ?? 2,
  );
  renderer.setPixelRatio(ratio);
  renderer.shadowMap.enabled = config.shadows ?? true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // sRGB output + ACES tone-mapping so the world's lighting reads correctly.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  return renderer as unknown as THREE.WebGLRenderer & RendererLike;
}

/**
 * Re-apply the *cheap* quality knobs to a live renderer (#47). Changing the
 * graphics setting in the pause menu calls this so the change is felt at once:
 * the pixel-ratio cap and the shadow-map enable both take effect on the next
 * frame without a rebuild. The expensive parts (prop count, shadow-map *size*)
 * are baked at build time and wait for the next mount — the menu surfaces an
 * "applies on reload" note for those.
 */
export function applyRendererQuality(
  renderer: THREE.WebGLRenderer,
  config: { maxPixelRatio: number; shadows: boolean },
): void {
  const ratio = Math.min(
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    config.maxPixelRatio,
  );
  renderer.setPixelRatio(ratio);
  if (renderer.shadowMap.enabled !== config.shadows) {
    renderer.shadowMap.enabled = config.shadows;
    // A toggled shadow map needs every material recompiled to add/drop the
    // shadow code path — without this the change only shows on new materials.
    renderer.shadowMap.needsUpdate = true;
  }
}
