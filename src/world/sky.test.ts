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
