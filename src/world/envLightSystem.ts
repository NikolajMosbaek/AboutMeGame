// Sky-driven IBL environment light (visual-overhaul slice 2, all tiers).
//
// Generates `scene.environment` from the procedural sky itself — a small
// PMREM baked from a private mini scene holding an INDEPENDENT copy of the
// gradient dome (`sky.ts`'s `buildDomeMaterial`) plus a small bright "sun
// glow" disc, so reflective/rough-lit surfaces get real image-based ambient
// that tracks the day cycle instead of a flat hemisphere fill (retired,
// `sky.ts`). Deliberately independent of the LIVE visible dome material: this
// system drives its own uniforms from a specific palette snapshot (either the
// day cycle's current moment, or the fixed golden-hour keyframe for the
// static/low path) rather than sharing the mutable material `DayCycleSystem`
// writes every frame — so the low tier can bake "golden hour, once" even
// though the live sky keeps cycling underneath it.
//
// Regeneration cadence is owned by the pure `envBakeScheduler` (palette delta
// + a real-seconds cap) — this file is deliberately thin GPU wiring: read the
// day cycle, ask the scheduler, bake if told to. `scene.environmentIntensity`
// is cheap (a scalar write) and updates every frame regardless, so brightness
// tracks the cycle smoothly even between the coarser texture rebakes.
//
// Constructed directly by `GameCanvas` (like the postprocessing compositor),
// NOT by `buildWorld`/`buildGame`: `PMREMGenerator` needs the real
// `THREE.WebGLRenderer`, which those composition-root functions never touch
// (keeping them headless-testable under jsdom, which has no WebGL). Unlike
// the compositor this needs no lazy chunk — `PMREMGenerator` is core `three`,
// already eagerly loaded — so it is built synchronously at mount, no
// late-attach dance required.

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import { DayCycleSystem } from "./dayCycleSystem.ts";
import { buildDomeMaterial } from "./sky.ts";
import { WORLD } from "./worldConfig.ts";
import { DEFAULT_ENV_BAKE_CONFIG, paletteDelta, shouldRebake } from "./envBakeScheduler.ts";
import { environmentIntensityForSunIntensity } from "./envIntensity.ts";

/** The palette fields the bake actually reads — a `DayPalette` (`./dayCycle.ts`)
 *  satisfies this structurally; this file never imports that module directly
 *  (`DayCycleSystem` re-exposes what it needs via `getPalette`/`goldenPalette`,
 *  keeping `dayCycle.ts`'s locked single-importer contract intact). */
interface EnvBakeSample {
  sunColor: readonly [number, number, number];
  sunIntensity: number;
  sunElevation: number;
  sunAzimuth: number;
  domeTop: readonly [number, number, number];
  domeBottom: readonly [number, number, number];
}

/** The palette accessor this system needs from the day cycle — a narrow slice
 *  of `DayCycleSystem`, injected so a test can fake it without a real one. */
export type DayCycleAccessor = Pick<DayCycleSystem, "getPhase" | "getPalette">;

export interface EnvLightQuality {
  /** Whether the environment map regenerates on a schedule as the day cycle
   *  moves (medium/high). `false` bakes ONCE at construction (golden hour) and
   *  never again — the low tier's free visual upgrade with zero steady-state
   *  cost. */
  dynamic: boolean;
}

/** Small PMREM source resolution — well inside the 64-128px range the design
 *  calls for. The whole point is a cheap ambient term, not a sharp mirror. */
const ENV_CUBE_SIZE = 96;
const ENV_NEAR = 1;
const ENV_FAR = WORLD.size * 1.5;

/** Radius of the private mini dome baked into the environment map — matches
 *  the VISIBLE dome's radius (`sky.ts`) so the gradient's shape (the
 *  world-space height ratio the shader's `offset` uniform reasons about) is
 *  reproduced exactly; only the PMREM's OWN cubemap resolution (above) is
 *  small, not this geometry. */
const ENV_DOME_RADIUS = WORLD.size * 1.2;

/** A small bright disc standing in for the sun's contribution to the bake
 *  ("sun glow contribution welcome" — the design doc). Gives reflective
 *  surfaces (water) a directional highlight instead of just flat gradient
 *  ambient. Positioned just inside the dome, in the sun's direction. */
const SUN_GLOW_RADIUS = ENV_DOME_RADIUS * 0.05;
const SUN_GLOW_DISTANCE = ENV_DOME_RADIUS * 0.92;
/** Multiplies the sun's authored colour so the glow disc reads as a bright
 *  source rather than the same flat tone as the sky it sits against. */
const SUN_GLOW_BOOST = 4;

export class EnvLightSystem implements System {
  readonly id = "envLight";

  private readonly pmrem: THREE.PMREMGenerator;
  private readonly miniScene: THREE.Scene;
  private readonly domeGeo: THREE.SphereGeometry;
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly glowGeo: THREE.SphereGeometry;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly glowMesh: THREE.Mesh;

  private currentTarget: THREE.WebGLRenderTarget | null = null;
  private lastBaked: EnvBakeSample | null = null;
  private secondsSinceBake = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly dayCycle: DayCycleAccessor,
    private readonly quality: EnvLightQuality,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.miniScene = new THREE.Scene();
    this.domeGeo = new THREE.SphereGeometry(ENV_DOME_RADIUS, 16, 8);
    this.domeMat = buildDomeMaterial();
    this.miniScene.add(new THREE.Mesh(this.domeGeo, this.domeMat));

    this.glowGeo = new THREE.SphereGeometry(SUN_GLOW_RADIUS, 12, 8);
    this.glowMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.glowMesh = new THREE.Mesh(this.glowGeo, this.glowMat);
    this.miniScene.add(this.glowMesh);

    // Bake immediately — every tier gets IBL from the very first frame, never
    // an unlit fallback while waiting for the first scheduled regen. Static
    // (low tier) bakes the fixed golden-hour keyframe, reachable via the
    // static without needing a live instance; dynamic bakes whatever the day
    // cycle is painting at construction time (usually dawn, `t = 0`).
    this.bake(quality.dynamic ? dayCycle.getPalette() : DayCycleSystem.goldenPalette());
  }

  update(ctx: FrameContext): void {
    // Static (low tier): everything — texture AND intensity — was fixed at
    // construction from the golden-hour keyframe and never touched again, so
    // this is a true no-op (zero steady-state cost), even though the day
    // cycle itself keeps cycling live underneath (unconditionally, on every
    // tier) — that live palette is simply never read here.
    if (!this.quality.dynamic) return;

    const current = this.dayCycle.getPalette();
    // The intensity scalar is cheap (a number write) and tracks every frame
    // regardless of the coarser texture-rebake cadence below, so brightness
    // fades smoothly even between rebakes.
    this.scene.environmentIntensity = environmentIntensityForSunIntensity(current.sunIntensity);

    this.secondsSinceBake += ctx.dt;
    const delta = this.lastBaked ? paletteDelta(current, this.lastBaked) : Infinity;
    if (shouldRebake(this.secondsSinceBake, delta, DEFAULT_ENV_BAKE_CONFIG)) {
      this.bake(current);
    }
  }

  private bake(palette: EnvBakeSample): void {
    this.domeMat.uniforms.topColor.value.setRGB(...palette.domeTop, THREE.SRGBColorSpace);
    this.domeMat.uniforms.bottomColor.value.setRGB(...palette.domeBottom, THREE.SRGBColorSpace);

    const ce = Math.cos(palette.sunElevation);
    this.glowMesh.position
      .set(
        ce * Math.sin(palette.sunAzimuth),
        Math.sin(palette.sunElevation),
        ce * Math.cos(palette.sunAzimuth),
      )
      .multiplyScalar(SUN_GLOW_DISTANCE);
    this.glowMat.color.setRGB(...palette.sunColor, THREE.SRGBColorSpace).multiplyScalar(SUN_GLOW_BOOST);

    const target = this.pmrem.fromScene(this.miniScene, 0, ENV_NEAR, ENV_FAR, { size: ENV_CUBE_SIZE });
    const old = this.currentTarget;
    this.scene.environment = target.texture;
    this.scene.environmentIntensity = environmentIntensityForSunIntensity(palette.sunIntensity);
    this.currentTarget = target;
    old?.dispose();

    this.lastBaked = {
      sunColor: palette.sunColor,
      sunIntensity: palette.sunIntensity,
      sunElevation: palette.sunElevation,
      sunAzimuth: palette.sunAzimuth,
      domeTop: palette.domeTop,
      domeBottom: palette.domeBottom,
    };
    this.secondsSinceBake = 0;
  }

  dispose(): void {
    if (this.scene.environment === this.currentTarget?.texture) {
      this.scene.environment = null;
    }
    this.currentTarget?.dispose();
    this.pmrem.dispose();
    this.domeGeo.dispose();
    this.domeMat.dispose();
    this.glowGeo.dispose();
    this.glowMat.dispose();
  }
}
