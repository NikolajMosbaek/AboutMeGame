import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { configureCompositorColor, type ColorOwnedRenderer } from "./compositorColor.ts";

/**
 * Guards the colour-ownership decision for the bloom compositor path WITHOUT
 * constructing an `EffectComposer` — so this stays in the WebGL-free Vitest
 * suite (it imports only the core `three` enums, never `three/examples/jsm`).
 *
 * The bug it pins: a previous implementation set the renderer to
 * `NoToneMapping` / `LinearSRGBColorSpace`, expecting `OutputPass` to "apply
 * ACES + sRGB once". But `OutputPass` derives its shader defines FROM those same
 * renderer fields — `SRGB_TRANSFER` only when the colour space is an sRGB
 * transfer, and a tone-mapping define only for a *named* tone mode. With
 * `NoToneMapping` / linear it sets neither and becomes a pass-through, presenting
 * a raw linear buffer (the whole scene renders dark/under-exposed). The correct
 * idiom is to LEAVE the renderer at ACES + sRGB so `OutputPass` picks them up.
 */
describe("configureCompositorColor", () => {
  it("leaves the renderer at ACESFilmic tone-mapping so OutputPass applies it", () => {
    const renderer: ColorOwnedRenderer = {
      toneMapping: THREE.NoToneMapping,
      outputColorSpace: THREE.LinearSRGBColorSpace,
    };

    configureCompositorColor(renderer);

    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    // It must NOT neutralise to NoToneMapping — that makes OutputPass a no-op.
    expect(renderer.toneMapping).not.toBe(THREE.NoToneMapping);
  });

  it("leaves the renderer at sRGB output so OutputPass encodes the SRGB_TRANSFER", () => {
    const renderer: ColorOwnedRenderer = {
      toneMapping: THREE.NoToneMapping,
      outputColorSpace: THREE.LinearSRGBColorSpace,
    };

    configureCompositorColor(renderer);

    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    // Linear output would yield LinearTransfer ⇒ OutputPass drops SRGB_TRANSFER
    // and presents an un-encoded (dark) frame.
    expect(renderer.outputColorSpace).not.toBe(THREE.LinearSRGBColorSpace);
  });

  it("the chosen output space has an sRGB transfer (so OutputPass sets SRGB_TRANSFER)", () => {
    const renderer: ColorOwnedRenderer = {
      toneMapping: THREE.NoToneMapping,
      outputColorSpace: THREE.LinearSRGBColorSpace,
    };

    configureCompositorColor(renderer);

    // This is the exact predicate OutputPass.render uses to decide SRGB_TRANSFER.
    expect(THREE.ColorManagement.getTransfer(renderer.outputColorSpace)).toBe(
      THREE.SRGBTransfer,
    );
  });

  it("the chosen tone mode is one OutputPass recognises (compiles a tone define)", () => {
    const renderer: ColorOwnedRenderer = {
      toneMapping: THREE.NoToneMapping,
      outputColorSpace: THREE.LinearSRGBColorSpace,
    };

    configureCompositorColor(renderer);

    // OutputPass only sets a tone-mapping define for a NAMED mode; assert the
    // chosen mode is in that named set (NoToneMapping is deliberately excluded).
    const namedToneModes: THREE.ToneMapping[] = [
      THREE.LinearToneMapping,
      THREE.ReinhardToneMapping,
      THREE.CineonToneMapping,
      THREE.ACESFilmicToneMapping,
      THREE.AgXToneMapping,
      THREE.NeutralToneMapping,
    ];
    expect(namedToneModes).toContain(renderer.toneMapping);
    expect(namedToneModes).not.toContain(THREE.NoToneMapping);
  });
});
