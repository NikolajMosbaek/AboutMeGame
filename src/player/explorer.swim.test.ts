import { describe, expect, it } from "vitest";
import { ExplorerSystem, TUNE } from "./explorer.ts";
import type { SwimZones } from "../world/waterZones.ts";
import { FRAME, fakeInput, fakeTerrain, openBounds, seaLevelWater } from "./testDoubles.ts";
import { WORLD } from "../world/worldConfig.ts";

function run(sys: ExplorerSystem, frames: number) {
  for (let i = 0; i < frames; i++) sys.update(FRAME);
}

/** Calm, swimmable water everywhere — a boundless lagoon. */
function lagoonEverywhere(): SwimZones {
  return { inLagoon: () => true, riverFlowAt: () => null };
}

/** A river channel everywhere, flowing along +Z at unit rate. */
function riverEverywhere(): SwimZones {
  const flow = { x: 0, z: 1 };
  return { inLagoon: () => false, riverFlowAt: () => flow };
}

/** Shore at z<0 (dry), wade band 0..6 (0.6 deep), deep water past z=6 (3 m). */
function shoreProfile() {
  return fakeTerrain(0, (_x, z) =>
    z < 0 ? 1 : z < 6 ? WORLD.seaLevel - 0.6 : WORLD.seaLevel - 3,
  );
}

/** A linear beach ramp: depth grows with z (z=0 shoreline, deeper southward). */
function rampProfile(slope = 0.25) {
  return fakeTerrain(0, (_x, z) => WORLD.seaLevel - z * slope);
}

describe("ExplorerSystem swimming (lagoon)", () => {
  it("transitions walk → swim past maxWadeDepth instead of refusing", () => {
    const input = fakeInput();
    const t = shoreProfile();
    const sys = new ExplorerSystem(
      input.snap, t, openBounds(), seaLevelWater(t), { x: 0, z: 2, yaw: 0 },
      undefined, undefined, lagoonEverywhere(),
    );
    input.state.moveZ = 1;
    run(sys, 600); // 10 s pushing into the deep — old code pinned at z<6
    const s = sys.state;
    expect(s.mode).toBe("swim");
    expect(s.position.z).toBeGreaterThan(6);
    // Floats at the surface on entry.
    expect(s.position.y).toBeCloseTo(WORLD.seaLevel - TUNE.swimSurfaceOffset, 3);
  });

  it("swims at swim speed, and sprint-swims faster", () => {
    const input = fakeInput();
    const t = fakeTerrain(WORLD.seaLevel - 5); // uniform deep water
    const sys = new ExplorerSystem(
      input.snap, t, openBounds(), seaLevelWater(t), { x: 0, z: 0, yaw: 0 },
      undefined, undefined, lagoonEverywhere(),
    );
    input.state.moveZ = 1;
    run(sys, 240);
    expect(sys.state.mode).toBe("swim");
    expect(sys.state.speed).toBeCloseTo(TUNE.swimSpeed, 1);
    input.state.sprint = true;
    run(sys, 240);
    expect(sys.state.speed).toBeCloseTo(TUNE.sprintSwimSpeed, 1);
    expect(sys.state.sprinting).toBe(true);
  });

  it("exits swim → walk only below the hysteresis depth (~0.9), not at maxWadeDepth", () => {
    const input = fakeInput();
    const t = rampProfile();
    const sys = new ExplorerSystem(
      input.snap, t, openBounds(), seaLevelWater(t), { x: 0, z: 8, yaw: 0 },
      undefined, undefined, lagoonEverywhere(),
    );
    // z=8 → depth 2.0: swimming.
    run(sys, 5);
    expect(sys.state.mode).toBe("swim");
    // Swim shoreward (turn around: face -Z by moving backward).
    input.state.moveZ = -1;
    let sawSwimShallowerThanWade = false;
    for (let i = 0; i < 1200 && sys.state.mode === "swim"; i++) {
      sys.update(FRAME);
      const depth = WORLD.seaLevel - t.heightAt(sys.state.position.x, sys.state.position.z);
      if (depth < TUNE.maxWadeDepth && depth > TUNE.swimExitDepth + 0.05) {
        sawSwimShallowerThanWade = true; // still swimming inside the hysteresis band
      }
    }
    expect(sys.state.mode).toBe("walk"); // reached wading ground
    expect(sawSwimShallowerThanWade).toBe(true); // hysteresis held between 0.9 and 1.2
    const exitDepth = WORLD.seaLevel - t.heightAt(sys.state.position.x, sys.state.position.z);
    expect(exitDepth).toBeLessThan(TUNE.swimExitDepth + 0.1);
  });

  it("dives along the look direction: look down + forward descends and flags submerged", () => {
    const input = fakeInput();
    const t = fakeTerrain(WORLD.seaLevel - 8);
    const sys = new ExplorerSystem(
      input.snap, t, openBounds(), seaLevelWater(t), { x: 0, z: 0, yaw: 0 },
      undefined, undefined, lagoonEverywhere(),
    );
    run(sys, 2);
    expect(sys.state.mode).toBe("swim");
    expect(sys.state.submerged).toBe(false); // surfaced head stays above water
    input.look.dy = 1.0; // look well down
    input.state.moveZ = 1;
    run(sys, 120); // 2 s nose-down
    expect(sys.state.position.y).toBeLessThan(WORLD.seaLevel - 1);
    expect(sys.state.submerged).toBe(true);
  });

  it("Space rises steadily, and no input drifts buoyantly back to a surface float", () => {
    const input = fakeInput();
    const t = fakeTerrain(WORLD.seaLevel - 8);
    const sys = new ExplorerSystem(
      input.snap, t, openBounds(), seaLevelWater(t), { x: 0, z: 0, yaw: 0 },
      undefined, undefined, lagoonEverywhere(),
    );
    // Dive first.
    input.look.dy = 1.0;
    input.state.moveZ = 1;
    run(sys, 180);
    const deepY = sys.state.position.y;
    expect(deepY).toBeLessThan(WORLD.seaLevel - 1.5);
    // Space: steady rise even while still nosing down.
    input.state.moveZ = 0;
    input.state.rise = true;
    run(sys, 60);
    expect(sys.state.position.y).toBeGreaterThan(deepY + 0.8);
    // Release everything: buoyancy floats the rest of the way, then holds.
    input.state.rise = false;
    run(sys, 60 * 20);
    expect(sys.state.position.y).toBeCloseTo(WORLD.seaLevel - TUNE.swimSurfaceOffset, 2);
    expect(sys.state.submerged).toBe(false); // eye back above the water
  });

  it("never traps: pinned to the bed clearance floor, surfacing + swimming shoreward always works", () => {
    const input = fakeInput();
    const t = rampProfile(0.5);
    const sys = new ExplorerSystem(
      input.snap, t, openBounds(), seaLevelWater(t), { x: 0, z: 12, yaw: 0 },
      undefined, undefined, lagoonEverywhere(),
    );
    // Grind into the bed: nose fully down and push for a long while.
    input.look.dy = 5; // clamps to max pitch down
    input.state.moveZ = 1;
    run(sys, 600);
    const bed = t.heightAt(sys.state.position.x, sys.state.position.z);
    expect(sys.state.position.y).toBeGreaterThanOrEqual(bed + TUNE.swimBedClearance - 1e-6);
    // Now level out and swim shoreward: must come out walking. (The grind
    // pinned pitch at -maxPitch; this look-up delta returns it exactly to 0 —
    // swimming backward while still pitched would dive, which is correct.)
    input.look.dy = -TUNE.maxPitch;
    sys.update(FRAME);
    input.state.moveZ = -1; // back toward the shore (facing +Z, shore is -Z)
    run(sys, 60 * 30);
    expect(sys.state.mode).toBe("walk");
  });

  it("cannot climb a tall bank straight out of the water (the step is refused, not scaled)", () => {
    const input = fakeInput();
    // Deep pool with a 3 m-high wall bank at z >= 5.
    const t = fakeTerrain(0, (_x, z) => (z < 5 ? WORLD.seaLevel - 4 : WORLD.seaLevel + 3));
    const sys = new ExplorerSystem(
      input.snap, t, openBounds(), seaLevelWater(t), { x: 0, z: 0, yaw: 0 },
      undefined, undefined, lagoonEverywhere(),
    );
    input.state.moveZ = 1;
    run(sys, 600);
    expect(sys.state.mode).toBe("swim");
    expect(sys.state.position.z).toBeLessThan(5);
  });
});

describe("ExplorerSystem in the river current", () => {
  it("deep river water grips instead of refusing: forced downstream displacement", () => {
    const input = fakeInput();
    const t = shoreProfile();
    const sys = new ExplorerSystem(
      input.snap, t, openBounds(), seaLevelWater(t), { x: 0, z: 2, yaw: 0 },
      undefined, undefined, riverEverywhere(),
    );
    input.state.moveZ = 1;
    run(sys, 240); // wade in, get grabbed
    expect(sys.state.mode).toBe("swim");
    expect(sys.state.gripped).toBe(true);
    const z0 = sys.state.position.z;
    input.state.moveZ = 0; // stop swimming entirely
    run(sys, 120); // 2 s adrift
    // The current alone carried you ~currentSpeed downstream.
    expect(sys.state.position.z - z0).toBeGreaterThan(TUNE.currentSpeed * 2 * 0.8);
  });

  it("own input is reduced to ~40% while gripped (can steer, barely fight upstream)", () => {
    const input = fakeInput();
    const t = fakeTerrain(WORLD.seaLevel - 5);
    const sys = new ExplorerSystem(
      input.snap, t, openBounds(), seaLevelWater(t), { x: 0, z: 0, yaw: 0 },
      undefined, undefined, riverEverywhere(),
    );
    run(sys, 2);
    expect(sys.state.gripped).toBe(true);
    // Fight straight upstream (flow is +Z; face +Z and swim backward).
    input.state.moveZ = -1;
    const z0 = sys.state.position.z;
    run(sys, 120);
    const drift = (sys.state.position.z - z0) / 2; // m/s net downstream
    // Net ≈ 4.5 − 2.6·0.4 ≈ 3.46 m/s: you lose ground, but slower.
    expect(drift).toBeGreaterThan(TUNE.currentSpeed * 0.6);
    expect(drift).toBeLessThan(TUNE.currentSpeed * 0.95);
  });

  it("releases to a walk the moment you reach wade-depth ground", () => {
    const input = fakeInput();
    // Deep channel that shallows to a wadeable bank along +X.
    const t = fakeTerrain(0, (x, _z) => (x < 4 ? WORLD.seaLevel - 3 : WORLD.seaLevel - 0.6));
    const sys = new ExplorerSystem(
      input.snap, t, openBounds(), seaLevelWater(t), { x: 0, z: 0, yaw: 0 },
      undefined, undefined, riverEverywhere(),
    );
    run(sys, 2);
    expect(sys.state.gripped).toBe(true);
    input.state.moveX = -1; // steer toward the +X bank (facing +Z, +X is screen-LEFT)
    run(sys, 60 * 12);
    expect(sys.state.mode).toBe("walk");
    expect(sys.state.gripped).toBe(false);
    expect(sys.state.wading).toBe(true);
  });

  it("releases into a normal swim where the channel meets the lagoon zone", () => {
    const input = fakeInput();
    const t = fakeTerrain(WORLD.seaLevel - 5);
    // River for z<10, lagoon beyond — flow pushes +Z into the lagoon.
    const flow = { x: 0, z: 1 };
    const zones: SwimZones = {
      inLagoon: (_x, z) => z >= 10,
      riverFlowAt: (_x, z) => (z < 10 ? flow : null),
    };
    const sys = new ExplorerSystem(
      input.snap, t, openBounds(), seaLevelWater(t), { x: 0, z: 0, yaw: 0 },
      undefined, undefined, zones,
    );
    run(sys, 2);
    expect(sys.state.gripped).toBe(true);
    run(sys, 60 * 5); // adrift into the lagoon
    expect(sys.state.position.z).toBeGreaterThan(10);
    expect(sys.state.mode).toBe("swim");
    expect(sys.state.gripped).toBe(false);
  });

  it("wading in the river stays exactly as today — the fords still work", () => {
    const input = fakeInput();
    // A ford: never deeper than 0.6 m.
    const t = fakeTerrain(0, () => WORLD.seaLevel - 0.6);
    const sys = new ExplorerSystem(
      input.snap, t, openBounds(), seaLevelWater(t), { x: 0, z: 0, yaw: 0 },
      undefined, undefined, riverEverywhere(),
    );
    input.state.moveZ = 1;
    run(sys, 120);
    expect(sys.state.mode).toBe("walk");
    expect(sys.state.wading).toBe(true);
    expect(sys.state.gripped).toBe(false);
    // Wade speed, not current speed: the channel's grip never touches a ford.
    expect(sys.state.speed).toBeLessThanOrEqual(TUNE.walkSpeed + 1e-6);
  });
});
