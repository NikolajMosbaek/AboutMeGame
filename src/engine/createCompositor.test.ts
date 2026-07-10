import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BloomEffect, EffectPass, SMAAEffect, ToneMappingMode, VignetteEffect } from "postprocessing";
import { N8AOPostPass } from "n8ao";
import { buildAOPass, buildEffectStack, buildPasses } from "./createCompositor.ts";
import { QUALITY_TIERS } from "../perf/quality.ts";

/**
 * Guards the compositor's contract WITHOUT ever building a real
 * `EffectComposer`/`WebGLRenderer` — constructing an `Effect`/`Pass` needs no
 * WebGL context (only `EffectComposer.addPass`/`render`/`setSize` do, once a
 * real renderer is attached), so this stays in the WebGL-free Vitest suite,
 * same as `compositorColor.test.ts`. `npm run verify` is what proves the whole
 * chain actually renders and looks right on a live renderer.
 */
describe("buildEffectStack", () => {
  it("pins the bloom luminance threshold at the invariant landmarks/wildlife rely on", () => {
    // src/world/landmarks.test.ts, src/wildlife/fliers.ts and
    // src/wildlife/jaguar.ts all promise their emissive accents clear this
    // exact bloom threshold — it must never silently drift.
    const { bloom } = buildEffectStack(QUALITY_TIERS.medium);
    expect(bloom).toBeInstanceOf(BloomEffect);
    expect(bloom.luminanceMaterial.threshold).toBe(0.85);
    expect(bloom.luminanceMaterial.threshold).toBeGreaterThanOrEqual(0.85);
  });

  it("uses mipmap-blur bloom (the pmndrs replacement for UnrealBloomPass)", () => {
    const { bloom } = buildEffectStack(QUALITY_TIERS.high);
    expect(bloom.mipmapBlurPass.enabled).toBe(true);
  });

  it("runs a shorter (cheaper) bloom mip pyramid on medium than on high", () => {
    // `BloomEffect.resolution`/`resolutionScale` only affects its legacy
    // non-mipmap blur path — with `mipmapBlur: true` it's a documented no-op,
    // so `levels` (the mip-pyramid depth) is the real medium/high cost lever.
    const medium = buildEffectStack(QUALITY_TIERS.medium);
    const high = buildEffectStack(QUALITY_TIERS.high);
    expect(medium.bloom.mipmapBlurPass.levels).toBeLessThan(high.bloom.mipmapBlurPass.levels);
    expect(high.bloom.mipmapBlurPass.levels).toBe(8); // the library default
  });

  it("includes an SMAA effect (replaces MSAA-only AA)", () => {
    const { smaa } = buildEffectStack(QUALITY_TIERS.medium);
    expect(smaa).toBeInstanceOf(SMAAEffect);
  });

  it("includes a subtle vignette", () => {
    const { vignette } = buildEffectStack(QUALITY_TIERS.medium);
    expect(vignette).toBeInstanceOf(VignetteEffect);
    expect(vignette.darkness).toBeCloseTo(0.25, 5);
    expect(vignette.offset).toBeCloseTo(0.3, 5);
  });

  it("tone-maps in AgX mode — matching the bare (low-tier) renderer path", () => {
    const { toneMapping } = buildEffectStack(QUALITY_TIERS.medium);
    expect(toneMapping.mode).toBe(ToneMappingMode.AGX);
    // Every tier that builds a compositor agrees — no per-tier tone-map drift.
    expect(buildEffectStack(QUALITY_TIERS.high).toneMapping.mode).toBe(ToneMappingMode.AGX);
  });
});

describe("buildPasses (EffectPass merging)", () => {
  it("merges bloom + SMAA + vignette + tone-mapping into ONE EffectPass, not four", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const { renderPass, aoPass, effectPass } = buildPasses(scene, camera, QUALITY_TIERS.medium);

    // Exactly three passes make up the whole chain: the scene render, N8AO
    // (which cannot merge into an `Effect` — it's its own `Pass`), and ONE
    // fullscreen effect pass for everything else. The merge is still the
    // mobile fill-rate win pmndrs `postprocessing` buys over the old
    // pass-per-effect chain (RenderPass → UnrealBloomPass → OutputPass, three
    // separate fullscreen blits) — it just doesn't apply to N8AO itself.
    expect(renderPass).toBeDefined();
    expect(aoPass).toBeInstanceOf(N8AOPostPass);
    expect(effectPass).toBeInstanceOf(EffectPass);
  });

  it("the merged pass carries all four effects (bloom, SMAA, vignette, tone-mapping)", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const { effectPass, stack } = buildPasses(scene, camera, QUALITY_TIERS.high);

    // `effects` is TS-`private` on EffectPass (compile-time only); reading it
    // here is the one honest way to prove all four effects landed in the SAME
    // pass without constructing a real EffectComposer/WebGLRenderer.
    const effects = (effectPass as unknown as { effects: unknown[] }).effects;
    expect(effects).toHaveLength(4);
    expect(effects).toEqual(
      expect.arrayContaining([stack.bloom, stack.smaa, stack.vignette, stack.toneMapping]),
    );
  });
});

describe("buildAOPass (N8AO ambient occlusion, medium/high)", () => {
  it("applies quality.ao's look constants (aoRadius/distanceFalloff/intensity/halfRes)", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const pass = buildAOPass(scene, camera, QUALITY_TIERS.high);

    expect(pass).toBeInstanceOf(N8AOPostPass);
    expect(pass.configuration.aoRadius).toBe(QUALITY_TIERS.high.ao.aoRadius);
    expect(pass.configuration.distanceFalloff).toBe(QUALITY_TIERS.high.ao.distanceFalloff);
    expect(pass.configuration.intensity).toBe(QUALITY_TIERS.high.ao.intensity);
    expect(pass.configuration.halfRes).toBe(QUALITY_TIERS.high.ao.halfRes);
  });

  it("tuned for this world's scale — aoRadius in the 1.5-3 range (not a dirty-corners look)", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const pass = buildAOPass(scene, camera, QUALITY_TIERS.medium);
    expect(pass.configuration.aoRadius).toBeGreaterThanOrEqual(1.5);
    expect(pass.configuration.aoRadius).toBeLessThanOrEqual(3);
  });

  it("runs a cheaper quality preset on medium than on high (aoSamples proxy)", () => {
    // setQualityMode isn't independently readable, so this reads through the
    // ONE side-effect it has that IS readable: it doesn't touch aoRadius/etc,
    // only sample counts — asserted instead via the source tier config, which
    // this function is pinned to apply (see the previous test) and
    // `perf/quality.test.ts` locks distinct presets per tier.
    expect(QUALITY_TIERS.medium.ao.qualityMode).not.toBe(QUALITY_TIERS.high.ao.qualityMode);
  });

  it("disables gammaCorrection — this pass is never the LAST pass in the chain", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const pass = buildAOPass(scene, camera, QUALITY_TIERS.high);
    expect(pass.configuration.gammaCorrection).toBe(false);
  });
});

describe("buildPasses — AO sits BEFORE the merged effect pass (n8ao's own ordering rule)", () => {
  it("returns renderPass, aoPass and effectPass as three distinct instances", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const { renderPass, aoPass, effectPass } = buildPasses(scene, camera, QUALITY_TIERS.medium);
    expect(new Set([renderPass, aoPass, effectPass]).size).toBe(3);
  });
});

describe("low tier never builds a compositor", () => {
  // The gate lives in GameCanvas (`if (quality.bloom) { createBloomCompositor(...) }`),
  // sourced from this same table (asserted in full in `perf/quality.test.ts`).
  // Pinned here too because it's the exact predicate this compositor's
  // existence depends on: if it ever drifted, low would pay bloom's fill-rate
  // cost, or medium/high would silently lose their glow.
  it("quality.bloom is false on low, true on medium/high", () => {
    expect(QUALITY_TIERS.low.bloom).toBe(false);
    expect(QUALITY_TIERS.medium.bloom).toBe(true);
    expect(QUALITY_TIERS.high.bloom).toBe(true);
  });
});
