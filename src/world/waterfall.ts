// The waterfall (living-water epic, 2026-07-19). The river's source sits in a
// natural box-canyon at the northern highland's foot: the carved bed ends at
// {24,-148} with a ~22 u rock wall rising 8–12 u further upstream (probed
// against the real terrain, pinned by test). This pours the river over that
// wall — a translucent scrolling curtain, a crest lip, splash foam discs and
// a few bobbing mist puffs, plus a distance-attenuated roar
// (`roarLevelAt` → `AudioEngine.setWaterfallLevel`). All procedural: two
// generated `DataTexture`s, zero asset bytes, ≤ 6 draw calls in a compact
// group three frustum-culls as a whole — invisible from the zero-headroom
// spawn vantage on the far side of the island.
//
// Animation is a `WaterfallSystem` scrolling the curtain texture's offset —
// no shader patch, no per-vertex work. Pause holds it; reduced motion holds
// it (a still curtain still reads as a waterfall; the mist stays put).

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import { hash2 } from "../wildlife/geometry.ts";

/** Where the curtain meets the pool — the gorge head, on the river course
 *  just downstream of the wall (see the terrain probe in the module doc). */
export const FALLS_POS = { x: 27, z: -151.5 } as const;
/** Downstream unit direction at the source segment — the curtain FACES this
 *  way (its rock wall stands behind it, upstream). */
export const FALLS_FACING = { x: -0.641, z: 0.769 } as const;
/** Curtain height: pool (y 0) up to the notch in the wall. The wall crest
 *  behind is ~22 u, so the lip reads as a cut, not a floating edge. */
export const FALL_TOP = 16;
/** Curtain width — the carved bed is ~10 u across at the head. */
export const FALL_WIDTH = 7;
/** Full roar at the pool, silent past this distance (world units). */
export const ROAR_RADIUS = 70;

const CURTAIN_SCROLL_SPEED = 0.55; // texture repeats per second, downward
const SPLASH_DRIFT_SPEED = 0.06;
const MIST_COUNT = 5;

/** Distance-attenuated roar level 0..1 — squared falloff so it swells fast
 *  on approach (how a real falls reads) and dies politely by the radius. */
export function roarLevelAt(x: number, z: number): number {
  const d = Math.hypot(x - FALLS_POS.x, z - FALLS_POS.z);
  const t = Math.max(0, 1 - d / ROAR_RADIUS);
  return t * t;
}

/** 64² tileable value-noise RGBA texture: near-white with a cool tint, alpha
 *  banded into vertical streaks (the curtain), soft mottle (the splash) or a
 *  radial puff (the mist — hard quad edges read as floating slabs otherwise).
 *  Pure `hash2` noise — deterministic, no canvas (jsdom-safe). */
function makeWaterTexture(kind: "curtain" | "foam" | "mist"): THREE.DataTexture {
  const res = 64;
  const data = new Uint8Array(res * res * 4);
  for (let v = 0; v < res; v++) {
    for (let u = 0; u < res; u++) {
      // Tileable: sample hash noise on a torus lattice (two octaves).
      const tu = u / res;
      const tv = v / res;
      const n =
        kind === "curtain"
          ? // Vertical streaks: high frequency across, low along the fall.
            0.6 * hash2(Math.round(tu * 16) * 13.37, Math.round(tv * 4) * 7.77) +
            0.4 * hash2(Math.round(tu * 32) * 3.14, Math.round(tv * 8) * 9.42)
          : 0.5 * hash2(Math.round(tu * 8) * 13.37, Math.round(tv * 8) * 7.77) +
            0.5 * hash2(Math.round(tu * 16) * 3.14, Math.round(tv * 16) * 9.42);
      const i = (v * res + u) * 4;
      data[i] = 235 + Math.round(n * 20);
      data[i + 1] = 242 + Math.round(n * 13);
      data[i + 2] = 255;
      if (kind === "mist") {
        // Soft radial falloff from the quad centre, broken up by the noise.
        const r = Math.hypot(tu - 0.5, tv - 0.5) * 2;
        const puff = Math.max(0, 1 - r * r) * (0.55 + 0.45 * n);
        data[i + 3] = Math.round(puff * 255);
      } else {
        data[i + 3] =
          kind === "curtain"
            ? Math.round(140 + n * 115) // mostly opaque, streaked
            : Math.round(Math.max(0, n - 0.25) * 300); // patchy foam
      }
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export interface Waterfall {
  group: THREE.Group;
  /** The scrolling curtain map — the `WaterfallSystem` advances `offset.y`. */
  curtainTexture: THREE.DataTexture;
  /** Splash foam maps — drifted slowly for a boiling-pool read. */
  splashTextures: THREE.DataTexture[];
  dispose(): void;
}

export function buildWaterfall(): Waterfall {
  const group = new THREE.Group();
  group.name = "waterfall";
  const disposables: Array<{ dispose(): void }> = [];

  const curtainTexture = makeWaterTexture("curtain");
  curtainTexture.repeat.set(2, 2);
  disposables.push(curtainTexture);

  // Curtain: a plane bowed outward at the base (water falls away from the
  // wall). Base at local y=0 (the pool), top at FALL_TOP.
  const curtainGeo = new THREE.PlaneGeometry(FALL_WIDTH, FALL_TOP, 4, 8);
  {
    const pos = curtainGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y01 = pos.getY(i) / FALL_TOP + 0.5; // 0 at base, 1 at top
      pos.setZ(i, (1 - y01) * (1 - y01) * 1.6); // quadratic outward bow
      pos.setY(i, (y01 - 0) * FALL_TOP); // rebase: 0..FALL_TOP
    }
    curtainGeo.computeVertexNormals();
  }
  const curtainMat = new THREE.MeshStandardMaterial({
    map: curtainTexture,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.55,
  });
  const curtain = new THREE.Mesh(curtainGeo, curtainMat);
  curtain.name = "waterfall-curtain";
  disposables.push(curtainGeo, curtainMat);
  group.add(curtain);

  // Crest lip: a thin bright rounded bar where the water breaks over the edge.
  const lipGeo = new THREE.CylinderGeometry(0.45, 0.45, FALL_WIDTH, 6, 1);
  lipGeo.rotateZ(Math.PI / 2);
  const lipMat = new THREE.MeshStandardMaterial({ color: 0xeef6ff, roughness: 0.5 });
  const lip = new THREE.Mesh(lipGeo, lipMat);
  lip.position.set(0, FALL_TOP, 0.35);
  lip.name = "waterfall-lip";
  disposables.push(lipGeo, lipMat);
  group.add(lip);

  // Splash: two offset foam discs boiling at the pool.
  const splashTextures: THREE.DataTexture[] = [];
  for (const [radius, y, drift] of [
    [4.2, 0.12, 1],
    [2.8, 0.2, -1],
  ] as const) {
    const tex = makeWaterTexture("foam");
    tex.repeat.set(2, 2);
    splashTextures.push(tex);
    disposables.push(tex);
    const geo = new THREE.CircleGeometry(radius, 14);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      roughness: 0.8,
    });
    const disc = new THREE.Mesh(geo, mat);
    disc.position.set(0.4 * drift, y, 1.2 + 0.8 * drift);
    disc.name = "waterfall-splash";
    disposables.push(geo, mat);
    group.add(disc);
  }

  // Mist: a few soft translucent puffs above the pool (bobbed by the system).
  const mistGeo = new THREE.PlaneGeometry(2.4, 1.6);
  const mistTex = makeWaterTexture("mist");
  disposables.push(mistTex);
  const mistMat = new THREE.MeshStandardMaterial({
    map: mistTex,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  disposables.push(mistGeo, mistMat);
  const mist = new THREE.InstancedMesh(mistGeo, mistMat, MIST_COUNT);
  mist.name = "waterfall-mist";
  const m = new THREE.Matrix4();
  for (let i = 0; i < MIST_COUNT; i++) {
    m.makeTranslation((hash2(i * 3.3, 7.1) - 0.5) * FALL_WIDTH, 1.2 + hash2(i * 5.7, 2.9) * 2.5, 1 + hash2(i * 9.1, 4.3) * 2);
    mist.setMatrixAt(i, m);
  }
  disposables.push(mist);
  group.add(mist);

  // Place and face the group: local +Z is the curtain's outward (downstream)
  // normal; rotate local +Z onto FALLS_FACING.
  group.position.set(FALLS_POS.x, 0, FALLS_POS.z);
  group.rotation.y = Math.atan2(FALLS_FACING.x, FALLS_FACING.z);

  return {
    group,
    curtainTexture,
    splashTextures,
    dispose() {
      group.parent?.remove(group);
      for (const d of disposables) d.dispose();
    },
  };
}

export interface PauseSource {
  readonly paused: boolean;
}
export interface ReducedMotionSource {
  getSnapshot(): { reducedMotion: boolean };
}

export class WaterfallSystem implements System {
  readonly id = "waterfall";

  private elapsed = 0;
  private readonly m = new THREE.Matrix4();

  constructor(
    private readonly falls: Waterfall,
    private readonly session?: PauseSource,
    private readonly reducedMotion?: ReducedMotionSource,
  ) {}

  update(ctx: FrameContext): void {
    if (this.session?.paused) return;
    if (this.reducedMotion?.getSnapshot().reducedMotion) return; // still falls
    this.elapsed += ctx.dt;

    // Falling water: scroll the curtain map downward (offset wraps in [0,1)).
    const tex = this.falls.curtainTexture;
    tex.offset.y = (tex.offset.y + ctx.dt * CURTAIN_SCROLL_SPEED) % 1;

    // Boiling pool: counter-drift the two splash maps.
    this.falls.splashTextures.forEach((t, i) => {
      const dir = i % 2 === 0 ? 1 : -1;
      t.offset.x = (t.offset.x + dir * ctx.dt * SPLASH_DRIFT_SPEED + 1) % 1;
    });

    // Mist: gentle bob (tiny matrix refresh over MIST_COUNT instances).
    const mist = this.falls.group.getObjectByName("waterfall-mist");
    if (mist instanceof THREE.InstancedMesh) {
      for (let i = 0; i < MIST_COUNT; i++) {
        const bob = Math.sin(this.elapsed * 0.8 + i * 1.7) * 0.3;
        this.m.makeTranslation(
          (hash2(i * 3.3, 7.1) - 0.5) * FALL_WIDTH,
          1.2 + hash2(i * 5.7, 2.9) * 2.5 + bob,
          1 + hash2(i * 9.1, 4.3) * 2,
        );
        mist.setMatrixAt(i, this.m);
      }
      mist.instanceMatrix.needsUpdate = true;
    }
  }

  describe(): Record<string, unknown> {
    return { scrolling: !this.session?.paused };
  }
}
