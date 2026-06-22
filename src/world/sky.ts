import * as THREE from "three";
import { WORLD } from "./worldConfig.ts";

export interface Sky {
  /** Add to the scene: the sky dome + lights. */
  group: THREE.Group;
  /** The sun — shared so VFX/time-of-day (Epic 7) can reach it. */
  sun: THREE.DirectionalLight;
  /** Horizon colour, reused for fog so the world fades into the sky. */
  horizon: THREE.Color;
  dispose(): void;
}

const SKY_TOP = new THREE.Color(0x3a78c2); // upper sky blue
const SKY_BOTTOM = new THREE.Color(0xcfe4f2); // pale horizon haze

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
 * casts the world's shadows, a hemisphere fill so shadowed faces aren't black,
 * and exponential fog tuned to the horizon colour so distant land dissolves
 * into the sky (depth cue + draw-distance cover). Returns the `sun` so later
 * epics can animate light; configures its shadow camera to frame the island.
 *
 * The quality scaler (#47) passes `quality` to drop shadows + fog on the low
 * tier and shrink the shadow map on medium, keeping the mobile budget.
 */
export function buildSky(scene: THREE.Scene, quality: SkyQuality = DEFAULT_SKY_QUALITY): Sky {
  const group = new THREE.Group();
  group.name = "sky";

  // Gradient dome — a big inverted sphere shaded top→bottom in view space.
  const domeGeo = new THREE.SphereGeometry(WORLD.size * 1.2, 32, 16);
  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: SKY_TOP },
      bottomColor: { value: SKY_BOTTOM },
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
  const dome = new THREE.Mesh(domeGeo, domeMat);
  group.add(dome);

  const hemi = new THREE.HemisphereLight(0xbdd7f2, 0x4a4636, 0.85);
  group.add(hemi);

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
  if (quality.fog) scene.fog = new THREE.FogExp2(horizon.getHex(), 0.0022);

  return {
    group,
    sun,
    horizon,
    dispose() {
      domeGeo.dispose();
      domeMat.dispose();
      scene.fog = null;
    },
  };
}
