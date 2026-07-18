import { describe, expect, it } from "vitest";
import {
  CLEAR_SECONDS,
  FIRST_GAP,
  GAP_MAX,
  GAP_MIN,
  GATHER_SECONDS,
  LIGHT_CAP,
  RAIN_MAX,
  RAIN_MIN,
  mistAt,
  thunderTimes,
  weatherAt,
} from "./weather.ts";

describe("weatherAt — the shower schedule", () => {
  it("is deterministic: same seconds + seed, same snapshot", () => {
    for (const t of [0, 100, 500, 1234.5, 5000]) {
      expect(weatherAt(t)).toEqual(weatherAt(t));
      expect(weatherAt(t, 7)).toEqual(weatherAt(t, 7));
    }
  });

  it("starts clear and stays dry through most of the first gap", () => {
    const s = weatherAt(10);
    expect(s.rain01).toBe(0);
    expect(s.dim).toBe(0);
    expect(s.fogBoost).toBe(0);
  });

  it("the first shower arrives on schedule — an expedition actually sees weather", () => {
    // Scan the first gap + gather window: rain must begin by
    // FIRST_GAP + GATHER_SECONDS (+ slop).
    let firstRain = Infinity;
    for (let t = 0; t < FIRST_GAP + GATHER_SECONDS + RAIN_MAX; t += 1) {
      if (weatherAt(t).rain01 > 0) {
        firstRain = t;
        break;
      }
    }
    expect(firstRain).toBeGreaterThan(60); // never instant
    expect(firstRain).toBeLessThanOrEqual(FIRST_GAP + GATHER_SECONDS + 5);
  });

  it("showers alternate with clear gaps forever (scan an hour of play)", () => {
    let transitions = 0;
    let wasRaining = false;
    for (let t = 0; t < 3600; t += 2) {
      const raining = weatherAt(t).rain01 > 0;
      if (raining !== wasRaining) transitions++;
      wasRaining = raining;
    }
    expect(transitions).toBeGreaterThanOrEqual(6); // several full showers/hour
  });

  it("the envelope is continuous — no step exceeds what the ramps allow", () => {
    let prev = weatherAt(0).rain01;
    for (let t = 0.5; t < 1200; t += 0.5) {
      const cur = weatherAt(t).rain01;
      // Steepest legal slope: smoothstep's 1.5× peak over the SHORTEST ramp
      // (the clearing tail).
      expect(Math.abs(cur - prev)).toBeLessThanOrEqual((0.5 / CLEAR_SECONDS) * 1.5 + 1e-6);
      prev = cur;
    }
  });

  it("light showers cap below LIGHT_CAP; some shower in the first hour is heavy", () => {
    let sawHeavyPeak = false;
    for (let t = 0; t < 3600; t += 1) {
      const s = weatherAt(t);
      if (!s.heavy) expect(s.rain01).toBeLessThanOrEqual(LIGHT_CAP + 1e-6);
      if (s.heavy && s.rain01 > 0.9) sawHeavyPeak = true;
    }
    expect(sawHeavyPeak).toBe(true);
  });

  it("derives every factor from the one envelope", () => {
    // Find a raining moment and check the couplings.
    for (let t = 0; t < 2000; t += 1) {
      const s = weatherAt(t);
      if (s.rain01 > 0.3) {
        expect(s.dim).toBeCloseTo(0.45 * s.rain01, 5);
        expect(s.fogBoost).toBeCloseTo(1.6 * s.rain01, 5);
        expect(s.cloudDark).toBeCloseTo(s.rain01, 5);
        expect(s.gust01).toBeGreaterThanOrEqual(s.rain01 - 1e-6);
        return;
      }
    }
    throw new Error("no rain found in 2000 s");
  });

  it("gusts lead the rain: the gathering phase already agitates", () => {
    // Somewhere in a gather window gust01 > 0 while rain01 is still 0.
    let sawLeadingGust = false;
    for (let t = 0; t < 2000; t += 1) {
      const s = weatherAt(t);
      if (s.rain01 === 0 && s.gust01 > 0.2) sawLeadingGust = true;
    }
    expect(sawLeadingGust).toBe(true);
  });

  it("gust01 is continuous too — no pops at the gather/rain or tail/gap boundaries", () => {
    let prev = weatherAt(0).gust01;
    for (let t = 0.5; t < 1200; t += 0.5) {
      const cur = weatherAt(t).gust01;
      expect(Math.abs(cur - prev)).toBeLessThanOrEqual((0.5 / CLEAR_SECONDS) * 1.5 + 1e-6);
      prev = cur;
    }
  });

  it("different seeds shuffle the schedule", () => {
    let differs = false;
    for (let t = 200; t < 2000; t += 10) {
      if (weatherAt(t, 1).rain01 !== weatherAt(t, 99).rain01) differs = true;
    }
    expect(differs).toBe(true);
  });

  it("exposes sane constants", () => {
    expect(GAP_MIN).toBeLessThanOrEqual(GAP_MAX);
    expect(RAIN_MIN).toBeLessThanOrEqual(RAIN_MAX);
    expect(CLEAR_SECONDS).toBeGreaterThan(0);
  });
});

describe("mistAt — dawn mist", () => {
  it("peaks around dawn (phase 0) and vanishes by noon", () => {
    expect(mistAt(0)).toBeGreaterThan(0.8);
    expect(mistAt(0.25)).toBeLessThan(0.05);
    expect(mistAt(0.5)).toBeLessThan(0.05);
  });

  it("is periodic and continuous across the loop seam", () => {
    expect(mistAt(0.999)).toBeCloseTo(mistAt(-0.001), 2);
    expect(mistAt(1.0)).toBeCloseTo(mistAt(0), 5);
  });
});

describe("thunderTimes", () => {
  it("is deterministic per shower index and spaced 8–20 s apart", () => {
    const a = thunderTimes(2, 1);
    const b = thunderTimes(2, 1);
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) {
      const gap = a[i] - a[i - 1];
      expect(gap).toBeGreaterThanOrEqual(8);
      expect(gap).toBeLessThanOrEqual(20);
    }
    expect(a.length).toBeGreaterThan(2);
  });
});
