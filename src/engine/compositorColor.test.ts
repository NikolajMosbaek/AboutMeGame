import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  configureBareRendererColor,
  configureCompositorColor,
  type ColorOwnedRenderer,
} from "./compositorColor.ts";

function dirtyRenderer(): ColorOwnedRenderer {
  return {
    toneMapping: THREE.CineonToneMapping,
    outputColorSpace: THREE.LinearSRGBColorSpace,
  };
}

/**
 * Guards the colour-ownership decision for BOTH presentation paths WITHOUT
 * constructing an `EffectComposer`/`WebGLRenderer` — so this stays in the
 * WebGL-free Vitest suite (it imports only the core `three` enums, never
 * `postprocessing` or `three/examples/jsm`).
 *
 * The visual-overhaul contract (docs/design/2026-07-10-visual-overhaul-design.md,
 * slice 1): BOTH paths grade with `AgXToneMapping`, so switching quality tiers
 * mid-session never visibly re-grades the world. They apply it in different
 * places — see the doc comments on each function for why.
 */
describe("configureBareRendererColor (low tier — no compositor)", () => {
  it("sets AgXToneMapping — the renderer is the only stage, so it owns tone-mapping outright", () => {
    const renderer = dirtyRenderer();
    configureBareRendererColor(renderer);
    expect(renderer.toneMapping).toBe(THREE.AgXToneMapping);
  });

  it("sets sRGB output so the renderer's own encode is correct", () => {
    const renderer = dirtyRenderer();
    configureBareRendererColor(renderer);
    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(THREE.ColorManagement.getTransfer(renderer.outputColorSpace)).toBe(
      THREE.SRGBTransfer,
    );
  });
});

describe("configureCompositorColor (medium/high tier — postprocessing compositor)", () => {
  it("sets NoToneMapping — tone-mapping moves to the ToneMappingEffect at the end of the chain", () => {
    const renderer = dirtyRenderer();
    configureCompositorColor(renderer);
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
  });

  it("does NOT leave a named tone-map on the renderer (the classic double-tonemap pitfall)", () => {
    // If the renderer tone-mapped AND the ToneMappingEffect tone-mapped, the
    // scene would be tone-mapped twice — the double-gamma / washed-out bug
    // this seam exists to prevent. AgX (or any named mode) here is a bug.
    const renderer = dirtyRenderer();
    configureCompositorColor(renderer);
    expect(renderer.toneMapping).not.toBe(THREE.AgXToneMapping);
    expect(renderer.toneMapping).not.toBe(THREE.ACESFilmicToneMapping);
  });

  it("still sets sRGB output — postprocessing 'follows suit' and encodes it once at the end", () => {
    const renderer = dirtyRenderer();
    configureCompositorColor(renderer);
    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(THREE.ColorManagement.getTransfer(renderer.outputColorSpace)).toBe(
      THREE.SRGBTransfer,
    );
  });

  it("the bare and composited paths share the same OUTPUT colour space", () => {
    // Whichever path is active, the final present is sRGB-encoded the same
    // way — only WHERE the tone-map is applied differs.
    const bare = dirtyRenderer();
    const composited = dirtyRenderer();
    configureBareRendererColor(bare);
    configureCompositorColor(composited);
    expect(bare.outputColorSpace).toBe(composited.outputColorSpace);
  });
});
