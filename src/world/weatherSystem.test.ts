import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { WeatherSystem } from "./weatherSystem.ts";
import { FIRST_GAP, GATHER_SECONDS, weatherAt } from "./weather.ts";

const FRAME = (dt: number) => ({
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(),
  dt,
  elapsed: 0,
});

function rig(opts: { fog?: boolean; seed?: number } = {}) {
  const sky = {
    sun: { intensity: 1.2 },
    fog: opts.fog === false ? null : { density: 0.01 },
  };
  const dayCycle = { getPhase: () => 0.25 }; // noon — no dawn mist
  const clouds = { dark: -1, setWeatherDark(d: number) { this.dark = d; } };
  const wind = { gust: -1, setGust(g: number) { this.gust = g; } };
  const sys = new WeatherSystem(sky, dayCycle, clouds, wind, opts.seed ?? 1);
  return { sky, dayCycle, clouds, wind, sys };
}

/** Advance to a play moment where the seed-1 schedule is mid-shower. */
function rainingMoment(seed = 1): number {
  for (let t = 0; t < 3000; t += 1) {
    if (weatherAt(t, seed).rain01 > 0.4) return t;
  }
  throw new Error("no shower found");
}

describe("WeatherSystem", () => {
  it("multiplies the sun the day cycle wrote — never accumulates", () => {
    const { sky, sys } = rig();
    const t = rainingMoment();
    sys.update(FRAME(t)); // one big step lands mid-shower
    const snap = sys.snapshot();
    expect(snap.rain01).toBeGreaterThan(0.4);
    expect(sky.sun.intensity).toBeCloseTo(1.2 * (1 - snap.dim), 5);

    // Next frame the day cycle re-writes the base; the multiply must land on
    // the fresh value, not compound on last frame's product.
    sky.sun.intensity = 1.2;
    sys.update(FRAME(0.016));
    expect(sky.sun.intensity).toBeGreaterThan(1.2 * (1 - 0.45) - 0.01);
  });

  it("MULTIPLIES the fog density the day cycle wrote — boosted in rain, untouched when clear", () => {
    const { sky, sys } = rig();
    sys.update(FRAME(rainingMoment()));
    expect(sky.fog!.density).toBeGreaterThan(0.01);
    // A clear moment: the day cycle's own write passes through ×1 exactly
    // (its low-sun haze curve stays authoritative — review finding).
    const { sky: sky2, sys: sys2 } = rig();
    sys2.update(FRAME(30));
    expect(weatherAt(30).rain01).toBe(0);
    expect(sky2.fog!.density).toBeCloseTo(0.01, 6);
    // Emulate the day cycle's per-frame rewrite: fresh base, second frame —
    // the multiply lands on the fresh value, never compounding.
    sky2.fog!.density = 0.0032;
    sys2.update(FRAME(0.016));
    expect(sky2.fog!.density).toBeCloseTo(0.0032, 6);
  });

  it("adds dawn mist to the fog even in dry weather", () => {
    const sky = { sun: { intensity: 1 }, fog: { density: 0.01 } };
    const dawn = { getPhase: () => 0 };
    const sys = new WeatherSystem(sky, dawn);
    sys.update(FRAME(10)); // clear gap, but dawn
    expect(sky.fog.density).toBeGreaterThan(0.015); // ≥ 1.5× base under full mist
    sys.dispose?.();
  });

  it("drives the cloud and wind knobs from the snapshot", () => {
    const { clouds, wind, sys } = rig();
    sys.update(FRAME(rainingMoment()));
    const snap = sys.snapshot();
    expect(clouds.dark).toBeCloseTo(snap.cloudDark, 5);
    expect(wind.gust).toBeCloseTo(snap.gust01, 5);
  });

  it("gusts lead the rain during the gathering phase", () => {
    const { wind, sys } = rig();
    sys.update(FRAME(FIRST_GAP + GATHER_SECONDS * 0.8)); // mid-gather
    expect(sys.snapshot().rain01).toBe(0);
    expect(wind.gust).toBeGreaterThan(0.3);
  });

  it("survives a fog-less (low) tier — no fog writes, everything else works", () => {
    const { sky, clouds, sys } = rig({ fog: false });
    sys.update(FRAME(rainingMoment()));
    expect(sky.fog).toBeNull();
    expect(clouds.dark).toBeGreaterThan(0);
  });

  it("justThundered() drains once per strike window", () => {
    const { sys } = rig();
    // Sweep a long heavy shower in small steps; count edges.
    let edges = 0;
    for (let t = 0; t < 3600; t += 0.5) {
      sys.update(FRAME(0.5));
      if (sys.justThundered()) edges++;
    }
    expect(edges).toBeGreaterThan(2); // an hour of play has heavy showers
    expect(sys.justThundered()).toBe(false); // drained
  });

  it("describe() reports weather without churning per-frame numbers", () => {
    const { sys } = rig();
    sys.update(FRAME(10));
    expect(sys.describe()).toEqual({ raining: false, heavy: expect.any(Boolean) });
  });
});
