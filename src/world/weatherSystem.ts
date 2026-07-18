// WeatherSystem (W1 slice 2, #226) — the thin applier over the pure schedule
// in `weather.ts`. Registered AFTER `DayCycleSystem` (which re-writes BOTH
// `sun.intensity` and `fog.density` every frame — the slice-5 low-sun haze),
// so the shower's dim and fog boost are MULTIPLIES on the fresh frame values
// — never accumulating, never stomping the day cycle's own curves. It also
// registers BEFORE `UnderwaterFxSystem`, whose absolute submerged density
// must win over weather (you can't see the rain from under the lagoon).
// Clouds and wind get their factors through the small knobs added for this
// epic (`CloudSystem.setWeatherDark`, `WindSystem.setGust`). The
// environment-map intensity is dimmed by `EnvLightSystem` itself via an
// injected `dim` read (it writes after this system, and on every bake).
//
// The clock is system-owned play time (the `BirdsSystem` convention) and, like
// the day cycle it modulates, keeps running while the session is paused —
// weather is ambience, not gameplay.

import type { FrameContext, System } from "../engine/types.ts";
import { mistAt, thunderBetween, weatherAt, type WeatherSnapshot } from "./weather.ts";

/** The sky handles weather writes to — `buildSky`'s result satisfies it. */
export interface WeatherSky {
  sun: { intensity: number };
  fog: { density: number } | null;
}

/** The day-cycle loop fraction — `DayCycleSystem` satisfies it. */
export interface DayPhaseSource {
  getPhase(): number;
}

export interface CloudDarkSink {
  setWeatherDark(dark01: number): void;
}

export interface GustSink {
  setGust(gust01: number): void;
}

/** How hard full dawn mist thickens the fog, relative to base density. */
const MIST_FOG_BOOST = 1.2;

export class WeatherSystem implements System {
  readonly id = "weather";

  private elapsed = 0;
  private snap: WeatherSnapshot;
  private thunderEdge = false;

  constructor(
    private readonly sky: WeatherSky,
    private readonly dayCycle: DayPhaseSource,
    private readonly clouds?: CloudDarkSink,
    private readonly wind?: GustSink,
    private readonly seed = 1,
  ) {
    this.snap = weatherAt(0, seed);
  }

  update(ctx: FrameContext): void {
    const t0 = this.elapsed;
    this.elapsed += ctx.dt;
    this.snap = weatherAt(this.elapsed, this.seed);
    if (thunderBetween(t0, this.elapsed, this.seed)) this.thunderEdge = true;

    // The shower takes light (multiply on the day cycle's fresh write).
    this.sky.sun.intensity *= 1 - this.snap.dim;

    if (this.sky.fog) {
      // Multiply the density the day cycle just wrote (its low-sun haze curve
      // stays authoritative); UnderwaterFxSystem runs after us and overrides
      // absolutely while submerged.
      const mist = mistAt(this.dayCycle.getPhase()) * MIST_FOG_BOOST;
      this.sky.fog.density *= 1 + this.snap.fogBoost + mist;
    }

    this.clouds?.setWeatherDark(this.snap.cloudDark);
    this.wind?.setGust(this.snap.gust01);
  }

  /** The live snapshot — the rain layer, audio and EnvLight dim read this. */
  snapshot(): WeatherSnapshot {
    return this.snap;
  }

  /** True once per thunder strike — drained on read (the rumble's edge). */
  justThundered(): boolean {
    const e = this.thunderEdge;
    this.thunderEdge = false;
    return e;
  }

  describe(): Record<string, unknown> {
    // Coarse only — rain01 churns every frame and would make the render
    // gate's text snapshot non-deterministic (the WindSystem precedent).
    return { raining: this.snap.rain01 > 0, heavy: this.snap.heavy };
  }

  dispose(): void {
    // The sky/fog/cloud/wind handles are owned by their builders.
  }
}
