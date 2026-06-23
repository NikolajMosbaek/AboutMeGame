import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildSky } from "./sky.ts";

// G3 slice 2 — buildSky() live-mutation handles (#119).
//
// A pure no-op refactor that widens the Sky interface so a future per-frame
// writer (slice 3's DayCycleSystem) can drive the sun, dome gradient and fog
// from dayPalette() with today's NOON look byte-for-byte unchanged.
//
// jsdom has no WebGL, so we construct buildSky against a plain THREE.Scene (the
// src/world unit pattern, matching boundaries.dispose.test.ts) and assert on the
// returned handles only — no renderer, no canvas.

describe("buildSky() exposed handles (T1, shape)", () => {
  it("exposes a `dome` ShaderMaterial and a `fog` FogExp2 | null handle", () => {
    const sky = buildSky(new THREE.Scene());

    // Type-level contract: these must compile against the widened interface.
    const dome: THREE.ShaderMaterial = sky.dome;
    const fog: THREE.FogExp2 | null = sky.fog;
    expect(dome).toBeDefined();
    void fog;

    expect(sky).toHaveProperty("dome");
    expect(sky).toHaveProperty("fog");
    expect(sky.dome).toBeInstanceOf(THREE.ShaderMaterial);
  });
});
