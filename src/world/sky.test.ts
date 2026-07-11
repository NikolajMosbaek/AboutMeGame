import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { buildSky } from "./sky.ts";
import { WORLD } from "./worldConfig.ts";

// Directory of THIS test file, used to read sky.ts as text for the static
// (grep-style) no-production-import guard below. Mirrors the source-reading
// pattern in dayCycle.test.ts / waterSurface.test.ts.
const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

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

describe("buildSky() dome-identity guard (T5, instanceof THREE.Mesh alone)", () => {
  // The dome Mesh at sky.ts:74 is UNNAMED, so the name-based `waterMesh`
  // precedent does NOT apply — the only way to reach it is by type. The sky
  // group holds exactly one Mesh: the gradient dome. Everything else is a Light
  // or an Object3D (hemi + sun are Lights; sun.target is a bare Object3D), none
  // of which is a THREE.Mesh, so `instanceof THREE.Mesh` uniquely isolates the
  // dome. Proving that this one in-scene Mesh's `.material` IS the returned
  // `sky.dome` confirms the handle is the live material a per-frame writer
  // mutates — not a detached copy.
  it("the sky group has exactly one Mesh and its material IS sky.dome", () => {
    const sky = buildSky(new THREE.Scene());

    const meshes = sky.group.children.filter(
      (o): o is THREE.Mesh => o instanceof THREE.Mesh,
    );
    expect(meshes).toHaveLength(1);
    expect(meshes[0].material).toBe(sky.dome);
  });

  it("the non-Mesh sky children are Lights / Object3Ds (not Meshes)", () => {
    const sky = buildSky(new THREE.Scene());

    // Make the filter meaningful: there ARE other children, and none is a Mesh.
    // hemi + sun are Lights; sun.target is a bare Object3D added to the group.
    const nonMeshes = sky.group.children.filter((o) => !(o instanceof THREE.Mesh));
    expect(nonMeshes.length).toBeGreaterThan(0);
    expect(nonMeshes.every((o) => !(o instanceof THREE.Mesh))).toBe(true);
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

  it("with quality.fog=true, fog density starts at FOG_DENSITY_BASE (the shipped 0.0022)", () => {
    const sky = buildSky(new THREE.Scene(), { shadows: true, shadowMapSize: 2048, fog: true });

    expect(sky.fog!.density).toBeCloseTo(0.0022, 10);
  });
});

describe("buildSky() atmospheric dome uniforms (visual-overhaul slice 5)", () => {
  it("dome carries sunDirection/sunColor/sunDiscStrength uniforms with sane NOON defaults", () => {
    const sky = buildSky(new THREE.Scene());

    const dir = sky.dome.uniforms.sunDirection.value as THREE.Vector3;
    const expectedDir = new THREE.Vector3(0.6, 1, 0.4).normalize();
    expect(dir.x).toBeCloseTo(expectedDir.x, 10);
    expect(dir.y).toBeCloseTo(expectedDir.y, 10);
    expect(dir.z).toBeCloseTo(expectedDir.z, 10);

    expect((sky.dome.uniforms.sunColor.value as THREE.Color).getHex()).toBe(0xfff1d6);
    expect(sky.dome.uniforms.sunDiscStrength.value).toBe(1);
  });
});

describe("buildSky() fog-fork regression (T4, horizon is not the live handle)", () => {
  // The load-bearing correctness fix: FogExp2 deep-copies its colour at
  // construction (FogExp2.js:11 `this.color = new Color(color)`), and sky.ts
  // builds the fog from `horizon.getHex()` — a hex *number*, not the Color. So
  // `fog.color` is a DISTINCT THREE.Color instance from `horizon`, equal only by
  // value. Mutating `horizon` would therefore never reach the running fog; the
  // supported per-frame path is `sky.fog.color.copy(...)`. This test pins the
  // fork by-instance so a future refactor that accidentally aliases the two
  // (re-introducing the detached-snapshot bug) fails here.
  it("with quality.fog=true, sky.fog.color is a distinct instance from sky.horizon, equal by value", () => {
    const sky = buildSky(new THREE.Scene(), { shadows: true, shadowMapSize: 2048, fog: true });

    expect(sky.fog).not.toBeNull();
    // By-instance: NOT the same Color object — proves the fork is real.
    expect(sky.fog!.color).not.toBe(sky.horizon);
    // By-value: same NOON haze hex — proves they were equal to begin with, so
    // the distinct-instance check is meaningful (not passing on a colour diff).
    expect(sky.fog!.color.getHex()).toBe(sky.horizon.getHex());
  });
});

describe("buildSky() dispose() unchanged contract (T6, no new disposal path)", () => {
  // dispose() is byte-identical to main: it closes over the `domeGeo` / `domeMat`
  // locals (reached here through the dome Mesh) and nulls scene.fog, and NOTHING
  // else. The prior round's "null the fog reference" was DROPPED — the Quality
  // critic flagged it as asymmetric, ineffective against a cached/destructured
  // handle, and a `this`-binding robustness regression smuggled into a no-op
  // slice. These tests pin that revision:
  //   (a) domeGeo.dispose() + domeMat.dispose() exactly once, scene.fog === null;
  //   (b) dispose() is `this`-INDEPENDENT — a detached `const d = sky.dispose`
  //       call does not throw and still nulls scene.fog;
  //   (c) NO field-nulling — sky.dome / sky.fog still reference the (now-disposed)
  //       objects, documented as dangling/invalid-to-read, not nulled.
  //
  // jsdom has no WebGL, so we spy on the real instances buildSky created (the
  // dome material is sky.dome; its geometry is reached through the dome Mesh),
  // mirroring boundaries.dispose.test.ts.

  it("disposes the dome geometry and material exactly once and nulls scene.fog (a)", () => {
    const scene = new THREE.Scene();
    const sky = buildSky(scene, { shadows: true, shadowMapSize: 2048, fog: true });
    // Fog is live on scene before dispose, so the null is observable.
    expect(scene.fog).toBe(sky.fog);

    const geo = domeMesh(sky.group).geometry as THREE.BufferGeometry;
    const geoDispose = vi.spyOn(geo, "dispose");
    const matDispose = vi.spyOn(sky.dome, "dispose");

    sky.dispose();

    expect(geoDispose).toHaveBeenCalledTimes(1);
    expect(matDispose).toHaveBeenCalledTimes(1);
    expect(scene.fog).toBeNull();
  });

  it("is `this`-INDEPENDENT — a detached `const d = sky.dispose; d()` does not throw and still nulls scene.fog (b)", () => {
    const scene = new THREE.Scene();
    const sky = buildSky(scene, { shadows: true, shadowMapSize: 2048, fog: true });

    const matDispose = vi.spyOn(sky.dome, "dispose");

    // Detach the method from its object — if dispose() leaned on `this`, this
    // call would throw. It must not: dispose closes over locals only.
    const d = sky.dispose;
    d();

    expect(matDispose).toHaveBeenCalledTimes(1);
    expect(scene.fog).toBeNull();
    // The field is NOT nulled by the detached call either — see (c).
    expect(sky.dome).not.toBeNull();
  });

  it("does NOT null the returned handles — sky.dome / sky.fog still reference the (now-disposed) objects (c)", () => {
    const scene = new THREE.Scene();
    const sky = buildSky(scene, { shadows: true, shadowMapSize: 2048, fog: true });

    const domeBefore = sky.dome;
    const fogBefore = sky.fog;
    expect(fogBefore).toBeInstanceOf(THREE.FogExp2);

    sky.dispose();

    // No field-nulling: the handles still point at the same (now-disposed)
    // objects. They are documented as dangling/invalid-to-read after dispose,
    // NOT nulled — nulling the returned-object field would protect nothing
    // because a cached/destructured handle (what slice-3's writer holds) dangles
    // regardless, so it would be test theater. This is the Quality-critic
    // revision: dispose body byte-identical to main, no field-nulling.
    expect(sky.dome).not.toBeNull();
    expect(sky.dome).toBe(domeBefore);
    expect(sky.fog).not.toBeNull();
    expect(sky.fog).toBe(fogBefore);
  });

  it("with quality.fog=false, dispose() still nulls scene.fog and does not throw", () => {
    const scene = new THREE.Scene();
    const sky = buildSky(scene, { shadows: false, shadowMapSize: 1024, fog: false });

    // No fog was assigned; dispose must still be a clean no-throw and leave
    // scene.fog null (the unchanged `scene.fog = null` body).
    expect(sky.fog).toBeNull();
    expect(() => sky.dispose()).not.toThrow();
    expect(scene.fog).toBeNull();
  });
});

describe("buildSky() no-production-import guard (T7)", () => {
  // This slice only builds the seam dayCycle WILL feed; it must NOT import
  // dayCycle.ts. The tree-wide tree-shaking guard at dayCycle.test.ts (empty
  // importer set) is the system-of-record; this is a focused, local sibling that
  // pins sky.ts specifically — the file this slice touches — so a regression
  // here points straight at the offending file. The slice-2 flip anticipated by
  // dayCycle.ts's stale header comment is DEFERRED to slice 3 (when
  // DayCycleSystem actually imports dayCycle.ts); do not act on it here.
  it("sky.ts contains NO import of ./dayCycle in this slice", () => {
    const skySource = readFileSync(join(MODULE_DIR, "sky.ts"), "utf8");

    expect(
      skySource,
      "sky.ts must NOT import ./dayCycle in G3 slice 2 — the seam only exposes " +
        "handles a future writer feeds; the production import lands in slice 3.",
    ).not.toMatch(/from\s+["'][^"']*dayCycle/);
  });
});
