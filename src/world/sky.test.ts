import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildSky } from "./sky.ts";
import { WORLD } from "./worldConfig.ts";

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

/** The single sky-dome Mesh inside the sky group. It is UNNAMED (hemi/sun are
 *  Lights, not Meshes), so the only way to reach it is `instanceof THREE.Mesh`
 *  — the name-based `waterMesh` precedent does NOT apply here. */
function domeMesh(group: THREE.Group): THREE.Mesh {
  const found = group.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh);
  expect(found).toHaveLength(1);
  return found[0];
}

describe("buildSky() handle identity (T2, one source of truth)", () => {
  it("with quality.fog=true, `fog` is the SAME FogExp2 assigned to scene.fog", () => {
    const scene = new THREE.Scene();
    const sky = buildSky(scene, { shadows: true, shadowMapSize: 2048, fog: true });

    expect(sky.fog).toBeInstanceOf(THREE.FogExp2);
    // Identity, not a copy: a per-frame writer mutating sky.fog drives scene.fog.
    expect(sky.fog).toBe(scene.fog);
  });

  it("with quality.fog=false, both `fog` and scene.fog are null", () => {
    const scene = new THREE.Scene();
    const sky = buildSky(scene, { shadows: false, shadowMapSize: 1024, fog: false });

    // null (not undefined): the field is always present and the type never lies.
    expect(sky.fog).toBeNull();
    expect(scene.fog).toBeNull();
  });

  it("`dome` IS the dome Mesh's material — the existing local, not a re-wrap", () => {
    const sky = buildSky(new THREE.Scene());

    // Reached via instanceof THREE.Mesh because the dome Mesh is unnamed.
    expect(sky.dome).toBe(domeMesh(sky.group).material);
  });
});

describe("buildSky() shipped NOON defaults (T3, bit-exact)", () => {
  it("dome uniforms carry the shipped NOON gradient values", () => {
    const sky = buildSky(new THREE.Scene());

    // The future day cycle (slice 3) drives these by mutating .value in place;
    // this slice must hand back today's NOON gradient byte-for-byte.
    expect(sky.dome.uniforms.topColor.value.getHex()).toBe(0x3a78c2);
    expect(sky.dome.uniforms.bottomColor.value.getHex()).toBe(0xcfe4f2);
    expect(sky.dome.uniforms.offset.value).toBe(20);
    expect(sky.dome.uniforms.exponent.value).toBe(0.7);
  });

  it("sun is the shipped warm key DirectionalLight at the island-scaled position", () => {
    const sky = buildSky(new THREE.Scene());

    expect(sky.sun).toBeInstanceOf(THREE.DirectionalLight);
    expect(sky.sun.color.getHex()).toBe(0xfff1d6);
    expect(sky.sun.intensity).toBe(1.6);

    // Position is COMPUTED from WORLD.islandRadius (not a literal), so the test
    // tracks the config rather than baking in a hand-multiplied value.
    const expected = new THREE.Vector3(0.6, 1, 0.4).multiplyScalar(WORLD.islandRadius);
    expect(sky.sun.position.x).toBe(expected.x);
    expect(sky.sun.position.y).toBe(expected.y);
    expect(sky.sun.position.z).toBe(expected.z);
  });

  it("with quality.fog=true, fog carries the shipped NOON haze colour and density", () => {
    const sky = buildSky(new THREE.Scene(), { shadows: true, shadowMapSize: 2048, fog: true });

    expect(sky.fog).toBeInstanceOf(THREE.FogExp2);
    expect(sky.fog!.color.getHex()).toBe(0xcfe4f2);
    expect(sky.fog!.density).toBe(0.0022);
  });

  it("horizon is the construction-time NOON haze snapshot", () => {
    const sky = buildSky(new THREE.Scene());

    expect(sky.horizon.getHex()).toBe(0xcfe4f2);
  });
});
