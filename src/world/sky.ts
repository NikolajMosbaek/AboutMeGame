import * as THREE from "three";
import { WORLD } from "./worldConfig.ts";
import {
  FOG_DENSITY_BASE,
  HAZE_FALLOFF,
  HAZE_STRENGTH,
  SUN_DISC_INNER,
  SUN_DISC_OUTER,
  SUN_HALO_POWER,
} from "./skyAtmosphere.ts";

export interface Sky {
  /** Add to the scene: the sky dome + lights. */
  group: THREE.Group;
  /**
   * The gradient dome's material — the live seam for the sky colours. A
   * per-frame writer (the day cycle, G3) drives the gradient by mutating the
   * uniform values IN PLACE: `dome.uniforms.topColor.value`/`bottomColor.value`/
   * `sunColor.value` are `THREE.Color`s (use `.copy()`/`.set()`),
   * `dome.uniforms.sunDirection.value` is a `THREE.Vector3` (use `.copy()`/
   * `.set()`), `offset.value`/`exponent.value`/`sunDiscStrength.value` are
   * numbers. ONLY `.uniforms.<name>.value` in-place mutation is supported —
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
const SKY_BOTTOM = new THREE.Color(0xc6dcc2); // pale humid-green horizon haze (jungle-feel round 2)
/** Default sun direction/colour the dome shows before any per-frame writer
 *  touches it — the same NOON direction/colour `sky.ts`'s static sun ships
 *  (`(0.6,1,0.4)` normalized, `#fff1d6`), so a construction-only preview (a
 *  test, or a frame before `DayCycleSystem`'s first update) still shows the
 *  shipped NOON look rather than an arbitrary default. */
const NOON_SUN_DIRECTION = new THREE.Vector3(0.6, 1, 0.4).normalize();
const NOON_SUN_COLOR = new THREE.Color(0xfff1d6);

/**
 * Build a gradient sky-dome `ShaderMaterial` — top→bottom shaded in view
 * space, uniforms `topColor`/`bottomColor`/`sunColor`/`offset`/`exponent`/
 * `sunDirection`/`sunDiscStrength` mutable in place (the day cycle's live
 * per-frame writer, `DayCycleSystem`, drives the visible dome this way).
 * Factored out of `buildSky` so `EnvLightSystem` (visual-overhaul slice 2)
 * can build its OWN independent instance — same shader, different uniform
 * values it controls itself — for the private mini scene it bakes the
 * sky-driven IBL environment map from, without duplicating this GLSL a
 * second time or coupling to the live visible dome's material.
 *
 * Visual-overhaul slice 5 upgraded the flat two-colour gradient to a
 * Preetham/Rayleigh-FLAVOURED atmosphere (see `skyAtmosphere.ts` for the pure
 * reference math each GLSL term below is a direct transcription of, the
 * `waterSurface.ts`/`waterPatch.ts` idiom): a horizon-haze band that bleeds
 * extra `bottomColor` in near the horizon, a sharp sun disc, and a broad
 * Mie-style forward-scattering halo that warms toward amber as the sun gets
 * low. `sunDiscStrength` (default 1) lets a caller mute the disc/halo terms
 * entirely without touching the gradient itself — `EnvLightSystem`'s private
 * bake-scene copy sets it to 0 so the PMREM environment map's calibrated
 * energy budget (its own dedicated sun-glow disc mesh) is unaffected by this
 * slice; the gradient/haze terms (which only ever blend toward the palette's
 * own colours) still upgrade the bake for free.
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
      sunDirection: { value: NOON_SUN_DIRECTION.clone() },
      sunColor: { value: NOON_SUN_COLOR.clone() },
      sunDiscStrength: { value: 1 },
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
      uniform vec3 sunDirection;
      uniform vec3 sunColor;
      uniform float sunDiscStrength;
      varying vec3 vWorldPos;
      void main() {
        vec3 dir = normalize(vWorldPos + vec3(0.0, offset, 0.0));
        float h = dir.y;
        float t = pow(max(h, 0.0), exponent);
        vec3 col = mix(bottomColor, topColor, t);

        // Horizon haze band (skyAtmosphere.ts's hazeFactor): extra bottomColor
        // bleeding in near h = 0, falling off toward the zenith/nadir.
        float haze = exp(-abs(h) * ${HAZE_FALLOFF.toFixed(3)}) * ${HAZE_STRENGTH.toFixed(3)};
        col = mix(col, bottomColor, haze);

        // Sun disc (sharp rim) + Mie-style forward-scattering halo, warming
        // toward amber as the sun nears the horizon (skyAtmosphere.ts's
        // sunDiscFactor/sunHaloFactor/lowSunFactor).
        vec3 sun = normalize(sunDirection);
        float cosAngle = dot(dir, sun);
        float disc = smoothstep(${SUN_DISC_INNER.toFixed(6)}, ${SUN_DISC_OUTER.toFixed(6)}, cosAngle);
        float halo = pow(clamp(cosAngle, 0.0, 1.0), ${SUN_HALO_POWER.toFixed(1)});
        float lowSun = 1.0 - clamp(sun.y * 2.0, 0.0, 1.0);
        vec3 limb = mix(sunColor, sunColor * vec3(1.35, 0.82, 0.55), lowSun);
        col += halo * limb * (0.5 + 0.7 * lowSun) * sunDiscStrength;
        col = mix(col, sunColor * 1.6, disc * sunDiscStrength);

        gl_FragColor = vec4(col, 1.0);
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
  // is a detached snapshot and is NOT a live-fog handle. Density starts at
  // `FOG_DENSITY_BASE` (the shipped `0.0022`, held at the NOON sun elevation —
  // slice 5's `DayCycleSystem` retunes it live per phase from here).
  const fog = quality.fog ? new THREE.FogExp2(horizon.getHex(), FOG_DENSITY_BASE) : null;
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
