import * as THREE from "three";
import type { RendererLike } from "./types.ts";

export interface RendererConfig {
  canvas: HTMLCanvasElement;
  /** Cap the device pixel ratio. >2 buys little on retina but costs a lot of
   *  fill rate on mobile, so the quality scaler (Epic 6) tunes this down. */
  maxPixelRatio?: number;
  antialias?: boolean;
}

/**
 * Build the production `THREE.WebGLRenderer`. Isolated in its own module so the
 * Engine and every test can stay WebGL-free: nothing that runs under jsdom ever
 * imports this file. Quality scaling (Epic 6) reaches the same renderer through
 * the returned `RendererLike`.
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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // sRGB output + ACES tone-mapping so the world's lighting reads correctly.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  return renderer as unknown as THREE.WebGLRenderer & RendererLike;
}
