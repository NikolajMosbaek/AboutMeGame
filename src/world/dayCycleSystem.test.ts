import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { FrameContext } from "../engine/types.ts";
import type { ReducedMotionSource } from "./buildWorld.ts";
import { dayPalette, GOLDEN_T } from "./dayCycle.ts";
import { DayCycleSystem, PERIOD_SECONDS, SUN_DISTANCE } from "./dayCycleSystem.ts";

// --- Plain fakes for the three live handles (headless, no WebGL) -------------
//
// The System is injected the individual handles `sky.sun` / `sky.dome` /
// `sky.fog`, never the whole World/Sky, so these fakes only need the surface the
// System writes. They use real `THREE.Color`/`THREE.Vector3` value-holders
// (pure math objects — no GL context) so `getHex()` and the position components
// read back exactly as they would on the live scene. The objects are identity-
// stable: the System mutates `.color`/`.value`/`.position`/`.intensity` IN PLACE
// and never reassigns `dome.uniforms` (the scratch-Color-reuse proof below).

/** A `THREE.DirectionalLight`-shaped fake: the colour, intensity and position
 *  the System drives, with identity-stable `Color`/`Vector3` holders. */
function fakeSun(): Pick<THREE.DirectionalLight, "color" | "intensity" | "position"> {
  return {
    color: new THREE.Color(0xffffff),
    intensity: 0,
    position: new THREE.Vector3(),
  };
}

/** A `THREE.ShaderMaterial`-shaped fake exposing only the gradient uniforms the
 *  System writes — `topColor.value`/`bottomColor.value`/`sunColor.value` are
 *  live `THREE.Color`s and `sunDirection.value` a live `THREE.Vector3`, the
 *  System mutates each by reference (never reassigning `.uniforms`). */
function fakeDome(): {
  uniforms: {
    topColor: { value: THREE.Color };
    bottomColor: { value: THREE.Color };
    sunDirection: { value: THREE.Vector3 };
    sunColor: { value: THREE.Color };
  };
} {
  return {
    uniforms: {
      topColor: { value: new THREE.Color(0xffffff) },
      bottomColor: { value: new THREE.Color(0xffffff) },
      sunDirection: { value: new THREE.Vector3() },
      sunColor: { value: new THREE.Color(0xffffff) },
    },
  };
}

/** A `THREE.FogExp2`-shaped fake — the live `color`/`density` the System
 *  writes (slice 5 added the density write alongside the pre-existing colour). */
function fakeFog(): Pick<THREE.FogExp2, "color" | "density"> {
  return { color: new THREE.Color(0xffffff), density: 0 };
}

// A reduced-motion source whose answer we can flip between frames, so the test
// proves the gate is read LIVE (mirrors WaterSystem/BeaconPulseSystem's seam).
function reducedMotion(still: boolean): ReducedMotionSource {
  return { getSnapshot: () => ({ reducedMotion: still }) };
}

// A frame context with a tracked scene whose `traverse` we assert is never
// called — the System owns the handles by reference, it does NOT hunt the graph.
// `elapsed` is intentionally large and ticking: the System must IGNORE it and
// use its own accumulator, so a non-zero elapsed must not leak into the writes.
function ctxWith(dt: number): { ctx: FrameContext; traverse: ReturnType<typeof vi.fn> } {
  const traverse = vi.fn();
  const scene = { traverse } as unknown as FrameContext["scene"];
  return { ctx: { scene, camera: {} as never, dt, elapsed: 9999 }, traverse };
}

/** Construct the System over all three fakes plus a reduced-motion source. */
function makeSystem(still: boolean) {
  const sun = fakeSun();
  const dome = fakeDome();
  const fog = fakeFog();
  const sys = new DayCycleSystem(
    sun as unknown as THREE.DirectionalLight,
    dome as unknown as THREE.ShaderMaterial,
    fog as unknown as THREE.FogExp2,
    reducedMotion(still),
  );
  return { sys, sun, dome, fog };
}

describe("DayCycleSystem (G3 slice, T2)", () => {
  it("has the stable id 'dayCycle'", () => {
    const { sys } = makeSystem(false);
    expect(sys.id).toBe("dayCycle");
  });

  // --- (a) NOON snapshot at frac = 0.25, bit-exact vs sky.ts -----------------
  // Advancing the accumulator to exactly 0.25 * PERIOD_SECONDS lands the loop on
  // the NOON keyframe (f==0 early-return in dayPalette), so the writes must
  // reproduce sky.ts's shipped look bit-exact through the
  // setRGB(...srgbTuple, SRGBColorSpace) path.
  describe("NOON snapshot at loop fraction 0.25 reproduces sky.ts bit-exact", () => {
    const { sys, sun, dome, fog } = makeSystem(false);
    // One frame of dt = 0.25 * PERIOD lands the accumulator on the noon keyframe.
    const { ctx } = ctxWith(0.25 * PERIOD_SECONDS);
    sys.update(ctx);

    it("dome top == SKY_TOP #3a78c2", () => {
      expect(dome.uniforms.topColor.value.getHex()).toBe(0x3a78c2);
    });

    it("dome bottom == SKY_BOTTOM #cfe4f2", () => {
      expect(dome.uniforms.bottomColor.value.getHex()).toBe(0xc6dcc2);
    });

    it("fog == horizon #cfe4f2 (fog refactor is a no-op at noon)", () => {
      expect(fog.color.getHex()).toBe(0xc6dcc2);
    });

    it("fog density == FOG_DENSITY_BASE 0.0022 at noon (slice 5, item 5)", () => {
      expect(fog.density).toBeCloseTo(0.0022, 10);
    });

    it("dome sunColor == sun colour #fff1d6 and sunDirection matches the written sun direction", () => {
      expect(dome.uniforms.sunColor.value.getHex()).toBe(0xfff1d6);
      const dir = dome.uniforms.sunDirection.value;
      const expected = sys.getSunDirection();
      expect(dir.x).toBeCloseTo(expected.x, 10);
      expect(dir.y).toBeCloseTo(expected.y, 10);
      expect(dir.z).toBeCloseTo(expected.z, 10);
    });

    it("sun colour == DirectionalLight colour #fff1d6", () => {
      expect(sun.color.getHex()).toBe(0xfff1d6);
    });

    it("sun intensity == 1.6", () => {
      expect(sun.intensity).toBe(1.6);
    });

    it("FULL sun.position == (120, 200, 80) — SUN_DISTANCE preserves magnitude", () => {
      // The flagged material flaw: reconstructing a UNIT direction and scaling by
      // islandRadius (200) would give |pos|=200, NOT sky.ts's |pos|=246.58 from
      // new Vector3(0.6,1,0.4).multiplyScalar(200). Asserting the FULL vector (not
      // just a normalized direction) catches that 19%-short regression — direction
      // alone is magnitude-invariant and would pass on the buggy version.
      expect(sun.position.x).toBeCloseTo(120, 4);
      expect(sun.position.y).toBeCloseTo(200, 4);
      expect(sun.position.z).toBeCloseTo(80, 4);
    });

    it("SUN_DISTANCE is the islandRadius-scaled (0.6,1,0.4) length, not islandRadius", () => {
      // Guards the named const itself: 200 * |(0.6,1,0.4)| ≈ 246.58, the exact
      // magnitude that reproduces sky.ts's sun.position.
      expect(SUN_DISTANCE).toBeCloseTo(200 * Math.hypot(0.6, 1, 0.4), 6);
      expect(sun.position.length()).toBeCloseTo(SUN_DISTANCE, 4);
    });
  });

  // --- (b) moving palette while motion is allowed ----------------------------
  it("advances and writes a MOVING palette across frames when motion is allowed", () => {
    const { sys, sun, dome } = makeSystem(false);
    const { ctx } = ctxWith(0.05 * PERIOD_SECONDS);

    sys.update(ctx); // frac ≈ 0.05
    const intensityA = sun.intensity;
    const topHexA = dome.uniforms.topColor.value.getHex();

    sys.update(ctx); // frac ≈ 0.10
    const intensityB = sun.intensity;
    const topHexB = dome.uniforms.topColor.value.getHex();

    // The look is driven by the accumulator, so distinct loop fractions must
    // yield distinct writes — the world is animating, not pinned.
    expect(intensityB).not.toBe(intensityA);
    expect(topHexB).not.toBe(topHexA);
  });

  // --- (c) reduced motion: HOLD-and-PIN to the GOLDEN_T still -----------------
  describe("reduced motion writes the GOLDEN_T pin and freezes the accumulator", () => {
    it("a fresh reduced-motion load WRITES dayPalette(GOLDEN_T) (golden hour, not noon)", () => {
      // Unlike WaterSystem (early-return + hold last phase), DayCycleSystem must
      // still WRITE while held — so a fresh load with reduced-motion-on shows the
      // flattering golden-dusk still, not the construction-time default.
      const { sys, sun, dome, fog } = makeSystem(true);
      const { ctx } = ctxWith(0.016);
      sys.update(ctx);

      // GOLDEN_T (= 0.5) keyframe values from dayCycle.ts, authored bit-exact.
      expect(sun.color.getHex()).toBe(0xffc27a);
      expect(sun.intensity).toBe(1.2);
      expect(dome.uniforms.topColor.value.getHex()).toBe(0x5f7fb4);
      expect(dome.uniforms.bottomColor.value.getHex()).toBe(0xf2d9b8);
      expect(fog.color.getHex()).toBe(0xf2d9b8);
      // GOLDEN_T is the exported pin, not a hand-typed fraction.
      expect(GOLDEN_T).toBe(0.5);
    });

    it("does NOT advance the accumulator while held (no movement on repeat frames)", () => {
      const { sys, sun } = makeSystem(true);
      const { ctx } = ctxWith(0.25 * PERIOD_SECONDS); // a big dt that WOULD move
      sys.update(ctx);
      const goldenIntensity = sun.intensity;
      // Many more held frames must not nudge the look off the golden pin.
      sys.update(ctx);
      sys.update(ctx);
      expect(sun.intensity).toBe(goldenIntensity);
      expect(sun.intensity).toBe(1.2); // still the GOLDEN_T value, never advanced
    });
  });

  // --- (d) live flip mid-run + seamless resume from the held accumulator -----
  it("flips LIVE mid-run, holds without reset, and resumes from the held t (no jump)", () => {
    const sun = fakeSun();
    const dome = fakeDome();
    const fog = fakeFog();
    const still = { reducedMotion: false };
    const source: ReducedMotionSource = { getSnapshot: () => still };
    const sys = new DayCycleSystem(
      sun as unknown as THREE.DirectionalLight,
      dome as unknown as THREE.ShaderMaterial,
      fog as unknown as THREE.FogExp2,
      source,
    );

    // Build a non-trivial phase while motion is allowed.
    const { ctx } = ctxWith(0.1 * PERIOD_SECONDS);
    sys.update(ctx); // frac 0.1
    sys.update(ctx); // frac 0.2
    const runningIntensity = sun.intensity;
    const runningTopHex = dome.uniforms.topColor.value.getHex();

    // Flip the gate LIVE: the very next frame must SNAP to the GOLDEN_T pin
    // (proving the gate is read each frame, no rebuild), without advancing.
    still.reducedMotion = true;
    sys.update(ctx);
    expect(sun.intensity).toBe(1.2); // golden pin
    expect(dome.uniforms.topColor.value.getHex()).toBe(0x5f7fb4);
    // A second held frame must not drift off the pin.
    sys.update(ctx);
    expect(sun.intensity).toBe(1.2);

    // Release the gate: motion resumes from the HELD accumulator (frac 0.2), not
    // from 0 and not from golden — the next advance writes frac ≈ 0.3, which
    // equals the look we'd get advancing the original running phase by one step.
    still.reducedMotion = false;
    sys.update(ctx); // frac 0.2 -> 0.3
    expect(sun.intensity).not.toBe(1.2); // off the golden pin again
    // And it is NOT a snap back to the pre-pause sample (we moved forward).
    expect(sun.intensity).not.toBe(runningIntensity);
    expect(dome.uniforms.topColor.value.getHex()).not.toBe(runningTopHex);
  });

  // --- (e) seamless wrap across the period -----------------------------------
  it("wraps the accumulator modulo PERIOD_SECONDS with continuous writes across the seam", () => {
    // Two systems: one stepped to just BEFORE a full period, one stepped one
    // tiny dt PAST the period (which euclidean-wraps back to the same small
    // fraction). dayPalette's closing keyframe rejoins dawn, so the writes either
    // side of the wrap must agree — proving the seam is jump-free.
    const eps = 0.001 * PERIOD_SECONDS;

    const before = makeSystem(false);
    before.sys.update(ctxWith(PERIOD_SECONDS - eps).ctx); // frac ≈ 0.999

    const after = makeSystem(false);
    // One whole period + eps wraps to frac ≈ 0.001 — adjacent to the dawn seam.
    after.sys.update(ctxWith(PERIOD_SECONDS + eps).ctx);

    // Dawn (frac 0) and its closing repeat (frac 1) share colour/intensity, so a
    // fraction just below the wrap and one just above must be near-identical.
    expect(after.sun.intensity).toBeCloseTo(before.sun.intensity, 1);
    expect(after.sun.color.getHexString()).not.toBe("");
  });

  // --- (f) null fog (low tier) is safe ---------------------------------------
  it("does not throw when fog is null (low tier) and still writes sun + dome", () => {
    const sun = fakeSun();
    const dome = fakeDome();
    const sys = new DayCycleSystem(
      sun as unknown as THREE.DirectionalLight,
      dome as unknown as THREE.ShaderMaterial,
      null,
      reducedMotion(false),
    );
    const { ctx } = ctxWith(0.25 * PERIOD_SECONDS);
    expect(() => sys.update(ctx)).not.toThrow();
    // The non-fog writes still land — null fog only skips the fog write.
    expect(sun.color.getHex()).toBe(0xfff1d6);
    expect(dome.uniforms.topColor.value.getHex()).toBe(0x3a78c2);
  });

  // --- (g) absent reduced-motion source => motion on -------------------------
  it("treats an absent reduced-motion source as motion-on (advances the clock)", () => {
    const sun = fakeSun();
    const dome = fakeDome();
    const fog = fakeFog();
    const sys = new DayCycleSystem(
      sun as unknown as THREE.DirectionalLight,
      dome as unknown as THREE.ShaderMaterial,
      fog as unknown as THREE.FogExp2,
    );
    const { ctx } = ctxWith(0.25 * PERIOD_SECONDS);
    sys.update(ctx);
    // With no gate, motion is on, so frac 0.25 lands NOON — not the golden pin.
    expect(sun.intensity).toBe(1.6);
    expect(dome.uniforms.topColor.value.getHex()).toBe(0x3a78c2);
  });

  // --- (h) never traverses the scene -----------------------------------------
  it("never traverses the scene (owns the handles by reference)", () => {
    const { sys } = makeSystem(false);
    const { ctx, traverse } = ctxWith(0.016);
    sys.update(ctx);
    sys.update(ctx);
    expect(traverse).not.toHaveBeenCalled();
  });

  // --- (i) scratch-Color reuse: zero per-frame uniform-object realloc --------
  it("reuses the uniform/colour objects across frames (no per-frame realloc)", () => {
    const { sys, sun, dome, fog } = makeSystem(false);
    // Capture the identity-stable handles BEFORE any update.
    const sunColorBefore = sun.color;
    const topValueBefore = dome.uniforms.topColor.value;
    const bottomValueBefore = dome.uniforms.bottomColor.value;
    const sunDirectionValueBefore = dome.uniforms.sunDirection.value;
    const sunColorValueBefore = dome.uniforms.sunColor.value;
    const fogColorBefore = fog.color;
    const positionBefore = sun.position;

    const { ctx } = ctxWith(0.05 * PERIOD_SECONDS);
    sys.update(ctx);
    sys.update(ctx);

    // The System mutates these in place; it must never swap the objects, so the
    // live shader/light/fog keep reading one stable reference (zero alloc churn).
    expect(sun.color).toBe(sunColorBefore);
    expect(dome.uniforms.topColor.value).toBe(topValueBefore);
    expect(dome.uniforms.bottomColor.value).toBe(bottomValueBefore);
    expect(dome.uniforms.sunDirection.value).toBe(sunDirectionValueBefore);
    expect(dome.uniforms.sunColor.value).toBe(sunColorValueBefore);
    expect(fog.color).toBe(fogColorBefore);
    expect(sun.position).toBe(positionBefore);
  });
});

describe("getPhase (wildlife day/night seam)", () => {
  it("stays in [0,1) and tracks the accumulated cycle time", () => {
    const sun = fakeSun();
    const dome = fakeDome();
    const sys = new DayCycleSystem(
      sun as never,
      dome as never,
      null,
      reducedMotion(false),
    );
    expect(sys.getPhase()).toBe(0);

    const { ctx } = ctxWith(PERIOD_SECONDS / 4 / 60);
    for (let i = 0; i < 60; i++) sys.update(ctx); // a quarter period
    expect(sys.getPhase()).toBeCloseTo(0.25, 2);

    const full = ctxWith(PERIOD_SECONDS / 60);
    for (let i = 0; i < 60; i++) sys.update(full.ctx); // one full period wraps
    expect(sys.getPhase()).toBeCloseTo(0.25, 2);
    expect(sys.getPhase()).toBeGreaterThanOrEqual(0);
    expect(sys.getPhase()).toBeLessThan(1);
  });

  it("pins to the golden-hour phase under reduced motion", () => {
    const sys = new DayCycleSystem(
      fakeSun() as never,
      fakeDome() as never,
      null,
      reducedMotion(true),
    );
    const { ctx } = ctxWith(1);
    for (let i = 0; i < 90; i++) sys.update(ctx);
    expect(sys.getPhase()).toBe(GOLDEN_T);
    for (let i = 0; i < 33; i++) sys.update(ctx);
    expect(sys.getPhase()).toBe(GOLDEN_T); // held still
  });
});

describe("getPalette (env-light IBL seam, visual-overhaul slice 2)", () => {
  it("returns dayPalette(getPhase()) — always in lockstep with the phase accessor", () => {
    const sun = fakeSun();
    const dome = fakeDome();
    const sys = new DayCycleSystem(sun as never, dome as never, null, reducedMotion(false));
    const { ctx } = ctxWith(0.1 * PERIOD_SECONDS);
    sys.update(ctx);

    expect(sys.getPalette()).toEqual(dayPalette(sys.getPhase()));
  });

  it("is recomputed on every call — never a stale cached snapshot", () => {
    const sun = fakeSun();
    const dome = fakeDome();
    const sys = new DayCycleSystem(sun as never, dome as never, null, reducedMotion(false));
    const { ctx } = ctxWith(0.1 * PERIOD_SECONDS);

    sys.update(ctx);
    const first = sys.getPalette();
    sys.update(ctx);
    const second = sys.getPalette();

    expect(second).toEqual(dayPalette(sys.getPhase()));
    expect(second.sunIntensity).not.toBe(first.sunIntensity);
  });

  it("under reduced motion, always returns the GOLDEN_T palette — matches what's actually painted", () => {
    const sun = fakeSun();
    const dome = fakeDome();
    const sys = new DayCycleSystem(sun as never, dome as never, null, reducedMotion(true));
    const { ctx } = ctxWith(0.25 * PERIOD_SECONDS); // would be noon if motion were on
    sys.update(ctx);

    expect(sys.getPalette()).toEqual(dayPalette(GOLDEN_T));
  });
});

describe("DayCycleSystem.goldenPalette (static, the low-tier one-shot env-light bake)", () => {
  it("returns dayPalette(GOLDEN_T) — reachable without a live instance", () => {
    expect(DayCycleSystem.goldenPalette()).toEqual(dayPalette(GOLDEN_T));
  });
});
