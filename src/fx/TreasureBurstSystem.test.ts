import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  IDOL_EMISSIVE_AFTER,
  IDOL_EMISSIVE_PEAK,
  IDOL_EMISSIVE_REST,
  MOTE_COUNT,
  PEAK_AT,
  TreasureBurstSystem,
  idolEmissiveAt,
} from "./TreasureBurstSystem.ts";
import type { FrameContext } from "../engine/types.ts";

const CTX = (dt = 1 / 60): FrameContext =>
  ({ scene: {} as never, camera: {} as never, dt, elapsed: 0 }) as FrameContext;

function finaleSource(active = false) {
  const snap = { finaleActive: active };
  return { getSnapshot: () => snap, set: (v: boolean) => (snap.finaleActive = v) };
}

function rig(opts: { reduced?: boolean } = {}) {
  const scene = new THREE.Scene();
  const quest = finaleSource();
  const setIdolEmissive = vi.fn();
  const sys = new TreasureBurstSystem(
    scene,
    quest,
    { x: 10, y: 2, z: -5 },
    opts.reduced === undefined ? undefined : { getSnapshot: () => ({ reducedMotion: opts.reduced! }) },
    setIdolEmissive,
    4.5,
  );
  const points = scene.children.find((o) => o.name === "treasure-burst") as THREE.Points;
  return { scene, quest, sys, points, setIdolEmissive };
}

describe("idolEmissiveAt — the finale's glow curve", () => {
  it("ramps rest → peak → settled afterglow", () => {
    expect(idolEmissiveAt(0)).toBeCloseTo(IDOL_EMISSIVE_REST);
    expect(idolEmissiveAt(PEAK_AT)).toBeCloseTo(IDOL_EMISSIVE_PEAK);
    expect(idolEmissiveAt(1)).toBeCloseTo(IDOL_EMISSIVE_AFTER);
    // Monotone up before the peak, down after.
    expect(idolEmissiveAt(PEAK_AT / 2)).toBeGreaterThan(IDOL_EMISSIVE_REST);
    expect(idolEmissiveAt(0.9)).toBeLessThan(IDOL_EMISSIVE_PEAK);
    expect(idolEmissiveAt(0.9)).toBeGreaterThan(IDOL_EMISSIVE_AFTER);
  });
});

describe("TreasureBurstSystem — the completion spectacle", () => {
  it("idles invisible until the finale, then raises the mote spiral", () => {
    const { quest, sys, points } = rig();
    sys.update(CTX());
    expect(points.visible).toBe(false);

    quest.set(true);
    sys.update(CTX());
    expect(points.visible).toBe(true);
    expect(
      (points.geometry.getAttribute("position") as THREE.BufferAttribute).count,
    ).toBe(MOTE_COUNT);
  });

  it("animates the motes and drives the idol's emissive pulse while the finale runs", () => {
    const { quest, sys, points, setIdolEmissive } = rig();
    quest.set(true);
    sys.update(CTX());
    const attr = points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const before = attr.getY(0);

    for (let i = 0; i < 60; i++) sys.update(CTX()); // 1 s in
    expect(attr.getY(0)).not.toBe(before); // motes rise
    const lastCall = setIdolEmissive.mock.calls.at(-1)![0] as number;
    expect(lastCall).toBeGreaterThan(IDOL_EMISSIVE_REST); // climbing to the peak
  });

  it("parks the motes and settles the idol's afterglow when the finale ends", () => {
    const { quest, sys, points, setIdolEmissive } = rig();
    quest.set(true);
    sys.update(CTX());
    quest.set(false); // treasureFound lands; the panel takes over
    sys.update(CTX());
    expect(points.visible).toBe(false);
    expect(setIdolEmissive).toHaveBeenLastCalledWith(IDOL_EMISSIVE_AFTER);
  });

  it("reduced motion: no mote animation, a static glow instead — and the same afterglow", () => {
    const { quest, sys, points, setIdolEmissive } = rig({ reduced: true });
    quest.set(true);
    for (let i = 0; i < 30; i++) sys.update(CTX());
    expect(points.visible).toBe(false); // never animates
    expect(setIdolEmissive).toHaveBeenCalledWith(IDOL_EMISSIVE_PEAK); // the static glow
    const glowCalls = setIdolEmissive.mock.calls.length;
    expect(glowCalls).toBe(1); // static: set once, not per frame

    quest.set(false);
    sys.update(CTX());
    expect(setIdolEmissive).toHaveBeenLastCalledWith(IDOL_EMISSIVE_AFTER);
  });

  it("disposes the points, geometry and material and detaches from the scene", () => {
    const { scene, sys } = rig();
    expect(() => sys.dispose()).not.toThrow();
    expect(scene.children.find((o) => o.name === "treasure-burst")).toBeUndefined();
  });
});
