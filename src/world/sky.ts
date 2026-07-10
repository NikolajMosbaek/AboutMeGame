import * as THREE from "three";
import { WORLD } from "./worldConfig.ts";

export interface Sky {
  /** Add to the scene: the sky dome + lights. */
  group: THREE.Group;
  /**
   * The gradient dome's material — the live seam for the sky colours. A
   * per-frame writer (the day cycle, G3) drives the gradient by mutating the
   * uniform values IN PLACE: `dome.uniforms.topColor.value`/`bottomColor.value`
   * are `THREE.Color`s (use `.copy()`/`.set()`), `offset.value`/`exponent.value`
   * are numbers. ONLY `.uniforms.<name>.value` in-place mutation is supported —
   * never reassign `.uniforms` and never call `dome.dispose()` (the Sky owns it).
   * After `dispose()` this references a disposed material and must not be read.
   */
  dome: THREE.ShaderMaterial;
  /** The sun — shared so VFX/time-of-day (Epic 7) can reach it. */
  sun: THREE.DirectionalLight;
  /**
   * The live fog instance — the SAME object assigned to `scene.fog` — or `null`
   * on a tier with fog disabled. This, NOT `horizon`, is the supported per-frame
   * fog path: `sky.fog?.color.copy(...)`. `FogExp2` deep-copies its colour at
   * construction (and the dome builds it from `horizon.getHex()`), so `horizon`
   * is a detached snapshot — mutating `horizon` would never reach running fog.
   * After `dispose()` this references a disposed fog and must not be read.
   */
  fog: THREE.FogExp2 | null;
  /**
   * Horizon colour as captured at construction time — the NOON haze value the
   * dome bottom and the initial fog were built from. NOT a live handle: it is a
   * detached snapshot, so writing to it does NOT update the running fog (use
   * `fog` for that). Kept for callers that want the original horizon colour.
   */
  horizon: THREE.Color;
  dispose(): void;
}

const SKY_TOP = new THREE.Color(0x3a78c2); // upper sky blue
const SKY_BOTTOM = new THREE.Color(0xcfe4f2); // pale horizon haze

/**
 * Build a gradient sky-dome `ShaderMaterial` — top→bottom shaded in view
 * space, uniforms `topColor`/`bottomColor`/`offset`/`exponent` mutable in
 * place (the day cycle's live per-frame writer, `DayCycleSystem`, drives the
 * visible dome this way). Factored out of `buildSky` so `EnvLightSystem`
 * (visual-overhaul slice 2) can build its OWN independent instance — same
 * shader, different uniform values it controls itself — for the private mini
 * scene it bakes the sky-driven IBL environment map from, without duplicating
 * this GLSL a second time or coupling to the live visible dome's material.
 */
export function buildDomeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: SKY_TOP.clone() },
      bottomColor: { value: SKY_BOTTOM.clone() },
      offset: { value: 20 },
      exponent: { value: 0.7 },
    },
    vertexShader: `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPos;
      void main() {
        float h = normalize(vWorldPos + vec3(0.0, offset, 0.0)).y;
        float t = pow(max(h, 0.0), exponent);
        gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
      }`,
  });
}

/** Quality knobs the sky/lighting reads from the scaler (#47). Defaults to full
 *  quality so callers that don't scale (tests, previews) get the old behaviour. */
export interface SkyQuality {
  /** Whether the sun casts real-time shadows (off on the low tier). */
  shadows: boolean;
  /** Shadow-map resolution when `shadows` is on. */
  shadowMapSize: number;
  /** Whether to draw atmospheric fog. */
  fog: boolean;
}

const DEFAULT_SKY_QUALITY: SkyQuality = { shadows: true, shadowMapSize: 2048, fog: true };

/**
 * Sky, lighting and atmosphere (#19): a gradient sky dome, a warm key sun that
 * casts the world's shadows, image-based ambient from the sky itself
 * (visual-overhaul slice 2's `EnvLightSystem` — see there), and exponential
 * fog tuned to the horizon colour so distant land dissolves into the sky
 * (depth cue + draw-distance cover). Returns the `sun` so later epics can
 * animate light; configures its shadow camera to frame the island (a sane
 * static default — the follow-player frustum, `ShadowFrustumSystem`, takes
 * over these bounds live on tiers with shadows on).
 *
 * The flat `HemisphereLight` fill this used to carry was RETIRED in the
 * visual-overhaul lighting slice: `scene.environment` (baked from this very
 * dome + the sun) now supplies the ambient term on every tier, so a separate
 * hemisphere would double up (and fight the IBL's own colour). Confirmed
 * nothing outside this file referenced it (it was never exposed on `Sky`).
 *
 * The quality scaler (#47) passes `quality` to drop shadows + fog on the low
 * tier and shrink the shadow map on medium, keeping the mobile budget.
 */
export function buildSky(scene: THREE.Scene, quality: SkyQuality = DEFAULT_SKY_QUALITY): Sky {
  const group = new THREE.Group();
  group.name = "sky";

  // Gradient dome — a big inverted sphere shaded top→bottom in view space.
  const domeGeo = new THREE.SphereGeometry(WORLD.size * 1.2, 32, 16);
  const domeMat = buildDomeMaterial();
  const dome = new THREE.Mesh(domeGeo, domeMat);
  group.add(dome);

  const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
  sun.position.set(0.6, 1, 0.4).multiplyScalar(WORLD.islandRadius);
  sun.castShadow = quality.shadows;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  const s = WORLD.islandRadius * 1.1;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = WORLD.islandRadius * 3;
  sun.shadow.bias = -0.0004;
  sun.target.position.set(0, 0, 0);
  group.add(sun);
  group.add(sun.target);

  const horizon = SKY_BOTTOM.clone();
  // The live fog instance — the SAME object assigned to scene.fog, returned as
  // `fog` so a per-frame writer mutates it directly (`fog.color.copy(...)`)
  // instead of hunting the scene. FogExp2 deep-copies its colour, so `horizon`
  // is a detached snapshot and is NOT a live-fog handle.
  const fog = quality.fog ? new THREE.FogExp2(horizon.getHex(), 0.0022) : null;
  if (fog) scene.fog = fog;

  return {
    group,
    dome: domeMat,
    sun,
    fog,
    horizon,
    dispose() {
      domeGeo.dispose();
      domeMat.dispose();
      scene.fog = null;
    },
  };
}
