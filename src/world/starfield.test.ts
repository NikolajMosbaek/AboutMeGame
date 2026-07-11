import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { FrameContext } from "../engine/types.ts";
import type { ReducedMotionSource } from "./buildWorld.ts";
import {
  STAR_COUNT,
  STAR_ELEVATION_FULL,
  STAR_ELEVATION_HIDDEN,
  STAR_ROTATION_RATE,
  STAR_WRAP_PERIOD,
  StarfieldSystem,
  makeStarField,
  starOpacity,
  starRotationAngle,
} from "./starfield.ts";

/** radians/second inside the twinkle shader's `sin()` — mirrors the module's
 *  own private `TWINKLE_RATE` (not exported, so re-declared here; a drift
 *  between the two would only affect this test's own continuity check). */
const TWINKLE_RATE = 1.6;

describe("makeStarField (deterministic placement)", () => {
  it("is a pure function: the same seed produces byte-identical output", () => {
    expect(makeStarField(50, 7)).toEqual(makeStarField(50, 7));
  });

  it("returns exactly `count` stars, each on the unit sphere", () => {
    const stars = makeStarField(200, 3);
    expect(stars).toHaveLength(200);
    for (const s of stars) {
      const r2 = s.x * s.x + s.y * s.y + s.z * s.z;
      expect(r2).toBeCloseTo(1, 6);
    }
  });

  it("decorrelates across a different seed (not the same field twice)", () => {
    const a = makeStarField(20, 1);
    const b = makeStarField(20, 2);
    expect(a).not.toEqual(b);
  });

  it("the default STAR_COUNT is the ~800-1500 the design calls for", () => {
    expect(STAR_COUNT).toBeGreaterThanOrEqual(800);
    expect(STAR_COUNT).toBeLessThanOrEqual(1500);
  });
});

describe("starOpacity (twilight fade curve)", () => {
  it("is fully visible at/below STAR_ELEVATION_FULL", () => {
    expect(starOpacity(STAR_ELEVATION_FULL)).toBeCloseTo(1, 10);
    expect(starOpacity(STAR_ELEVATION_FULL - 0.1)).toBeCloseTo(1, 10);
  });

  it("is fully hidden at/above STAR_ELEVATION_HIDDEN", () => {
    expect(starOpacity(STAR_ELEVATION_HIDDEN)).toBeCloseTo(0, 10);
    expect(starOpacity(1.0)).toBe(0);
  });

  it("is essentially invisible at noon (this world's brightest keyframe)", () => {
    const NOON_ELEVATION = Math.atan2(1, Math.hypot(0.6, 0.4));
    expect(starOpacity(NOON_ELEVATION)).toBe(0);
  });

  it("is monotonically decreasing as the sun climbs", () => {
    expect(starOpacity(0.13)).toBeGreaterThan(starOpacity(0.18));
    expect(starOpacity(0.18)).toBeGreaterThan(starOpacity(0.21));
  });
});

describe("starRotationAngle (celestial-pole wheel)", () => {
  it("is 0 at elapsed = 0", () => {
    expect(starRotationAngle(0)).toBe(0);
  });

  it("scales linearly with elapsed time at STAR_ROTATION_RATE", () => {
    expect(starRotationAngle(10)).toBeCloseTo(10 * STAR_ROTATION_RATE, 10);
  });

  it("is slow — a full 2π wheel takes several minutes, not a spin", () => {
    const secondsForFullTurn = (2 * Math.PI) / STAR_ROTATION_RATE;
    expect(secondsForFullTurn).toBeGreaterThan(180); // slower than one whole day-cycle loop
  });
});

describe("STAR_WRAP_PERIOD (continuous wrap for float32 precision — mirrors waterSurface.ts's WRAP_PERIOD)", () => {
  it("is a finite, positive period", () => {
    expect(Number.isFinite(STAR_WRAP_PERIOD)).toBe(true);
    expect(STAR_WRAP_PERIOD).toBeGreaterThan(0);
  });

  it("each consumer's rate completes a whole number of 2π cycles over the period", () => {
    const nTwinkle = (STAR_WRAP_PERIOD * TWINKLE_RATE) / (2 * Math.PI);
    const nRotation = (STAR_WRAP_PERIOD * STAR_ROTATION_RATE) / (2 * Math.PI);
    expect(nTwinkle).toBeCloseTo(Math.round(nTwinkle), 6);
    expect(nRotation).toBeCloseTo(Math.round(nRotation), 6);
    expect(Math.round(nTwinkle)).toBeGreaterThan(0);
    expect(Math.round(nRotation)).toBeGreaterThan(0);
  });

  it("makes the twinkle shader's sin() term continuous across the wrap", () => {
    // sin(uTime * TWINKLE_RATE + phase) must read identically at t and
    // t + STAR_WRAP_PERIOD for ANY per-star phase — otherwise the twinkle
    // would visibly pop the instant the accumulator wraps.
    const phases = [0, 0.7, 2.1, 4.4, Math.PI];
    for (const phase of phases) {
      const before = Math.sin(0 * TWINKLE_RATE + phase);
      const afterWrap = Math.sin(STAR_WRAP_PERIOD * TWINKLE_RATE + phase);
      expect(afterWrap).toBeCloseTo(before, 9);
    }
  });

  it("makes the pole rotation continuous across the wrap (same angle mod 2π)", () => {
    const angleAtZero = starRotationAngle(0);
    const angleAtPeriod = starRotationAngle(STAR_WRAP_PERIOD);
    const twoPi = 2 * Math.PI;
    const wrappedZero = THREE.MathUtils.euclideanModulo(angleAtZero, twoPi);
    const wrappedPeriod = THREE.MathUtils.euclideanModulo(angleAtPeriod, twoPi);
    expect(wrappedPeriod).toBeCloseTo(wrappedZero, 6);
  });
});

function sunSource(y: number): { getSunDirection(): THREE.Vector3 } {
  const dir = new THREE.Vector3(0, y, Math.sqrt(Math.max(0, 1 - y * y)));
  return { getSunDirection: () => dir };
}

function reducedMotion(still: boolean): ReducedMotionSource {
  return { getSnapshot: () => ({ reducedMotion: still }) };
}

function ctxWith(dt: number): FrameContext {
  return { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), dt, elapsed: 0 };
}

describe("StarfieldSystem (GPU wiring)", () => {
  it("adds exactly ONE Points draw call to the scene", () => {
    const scene = new THREE.Scene();
    new StarfieldSystem(scene, sunSource(0.8));

    const points: THREE.Points[] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.Points) points.push(o);
    });
    expect(points).toHaveLength(1);
  });

  it("tracks the sun elevation live: low sun raises uOpacity, high sun lowers it", () => {
    const scene = new THREE.Scene();
    const source = { dir: new THREE.Vector3(0, Math.sin(0.9), Math.cos(0.9)) };
    const sys = new StarfieldSystem(scene, { getSunDirection: () => source.dir });

    sys.update(ctxWith(1 / 60));
    const material = (scene.children[0] as THREE.Group).children[0] as THREE.Points;
    const mat = material.material as THREE.ShaderMaterial;
    const highSunOpacity = mat.uniforms.uOpacity.value;

    source.dir = new THREE.Vector3(0, Math.sin(0.1), Math.cos(0.1));
    sys.update(ctxWith(1 / 60));
    const lowSunOpacity = mat.uniforms.uOpacity.value;

    expect(lowSunOpacity).toBeGreaterThan(highSunOpacity);
  });

  it("under reduced motion, holds rotation and twinkle time frozen (no motion writes)", () => {
    const scene = new THREE.Scene();
    const sys = new StarfieldSystem(scene, sunSource(0.15), reducedMotion(true));
    const group = scene.children[0] as THREE.Group;
    const points = group.children[0] as THREE.Points;
    const mat = points.material as THREE.ShaderMaterial;

    sys.update(ctxWith(1));
    const timeAfterFirst = mat.uniforms.uTime.value;
    const rotationAfterFirst = group.rotation.y;

    sys.update(ctxWith(1));
    expect(mat.uniforms.uTime.value).toBe(timeAfterFirst);
    expect(group.rotation.y).toBe(rotationAfterFirst);
  });

  it("advances rotation and twinkle time when motion is allowed", () => {
    const scene = new THREE.Scene();
    const sys = new StarfieldSystem(scene, sunSource(0.15), reducedMotion(false));
    const group = scene.children[0] as THREE.Group;
    const points = group.children[0] as THREE.Points;
    const mat = points.material as THREE.ShaderMaterial;

    sys.update(ctxWith(1));
    const timeA = mat.uniforms.uTime.value;
    sys.update(ctxWith(1));
    const timeB = mat.uniforms.uTime.value;

    expect(timeB).toBeGreaterThan(timeA);
  });

  it("wraps uTime/rotation modulo STAR_WRAP_PERIOD — the accumulator never grows unbounded", () => {
    // Float32-precision discipline (mirrors `WaterSystem`/`waterSurface.ts`'s
    // `WRAP_PERIOD`): a long-lived tab must not feed an ever-growing `elapsed`
    // into `sin(uTime * TWINKLE_RATE + aPhase)` on a mediump mobile GPU.
    const scene = new THREE.Scene();
    const sys = new StarfieldSystem(scene, sunSource(0.15), reducedMotion(false));
    const group = scene.children[0] as THREE.Group;
    const points = group.children[0] as THREE.Points;
    const mat = points.material as THREE.ShaderMaterial;

    // One big dt that would, unwrapped, sail past several periods.
    sys.update(ctxWith(STAR_WRAP_PERIOD * 2.5));
    expect(mat.uniforms.uTime.value).toBeGreaterThanOrEqual(0);
    expect(mat.uniforms.uTime.value).toBeLessThan(STAR_WRAP_PERIOD);

    // Stepping exactly one further period lands on the SAME wrapped value
    // (continuous — no jump at the wrap boundary).
    const beforeWrapTime = mat.uniforms.uTime.value;
    const beforeWrapRotation = group.rotation.y;
    sys.update(ctxWith(STAR_WRAP_PERIOD));
    expect(mat.uniforms.uTime.value).toBeCloseTo(beforeWrapTime, 6);
    expect(group.rotation.y).toBeCloseTo(beforeWrapRotation, 6);
  });

  it("dispose() removes the group from the scene and disposes geometry/material", () => {
    const scene = new THREE.Scene();
    const sys = new StarfieldSystem(scene, sunSource(0.5));
    const group = scene.children[0] as THREE.Group;
    const points = group.children[0] as THREE.Points;
    const geo = points.geometry;
    const mat = points.material as THREE.ShaderMaterial;
    const geoDispose = vi.spyOn(geo, "dispose");
    const matDispose = vi.spyOn(mat, "dispose");

    sys.dispose();

    expect(scene.children).toHaveLength(0);
    expect(geoDispose).toHaveBeenCalledTimes(1);
    expect(matDispose).toHaveBeenCalledTimes(1);
  });
});
