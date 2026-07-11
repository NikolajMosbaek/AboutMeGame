import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { AmbientMotesSystem } from "./AmbientMotesSystem.ts";
import { AMBIENT_LEAF_COUNT, AMBIENT_MOTE_COUNT } from "./ambientMotes.ts";
import type { FrameContext } from "../engine/types.ts";

const CTX = (dt = 1 / 60): FrameContext =>
  ({ scene: {} as never, camera: {} as never, dt, elapsed: 0 }) as FrameContext;

const flatHeightAt = () => 3;

function rig(reduced?: boolean) {
  const scene = new THREE.Scene();
  const reducedMotion =
    reduced === undefined ? undefined : { getSnapshot: () => ({ reducedMotion: reduced }) };
  const sys = new AmbientMotesSystem(scene, flatHeightAt, reducedMotion);
  const motes = scene.children.find((o) => o.name === "ambient-motes") as THREE.Points;
  const leaves = scene.children.find((o) => o.name === "ambient-leaves") as THREE.Points;
  return { scene, sys, motes, leaves };
}

describe("AmbientMotesSystem — 2 draw calls, always visible (no idle/active toggle)", () => {
  it("builds exactly two Points clouds, sized to the design's counts", () => {
    const { motes, leaves } = rig();
    expect(motes).toBeDefined();
    expect(leaves).toBeDefined();
    expect((motes.geometry.getAttribute("position") as THREE.BufferAttribute).count).toBe(
      AMBIENT_MOTE_COUNT,
    );
    expect((leaves.geometry.getAttribute("position") as THREE.BufferAttribute).count).toBe(
      AMBIENT_LEAF_COUNT,
    );
  });

  it("never uses additive blending on the motes (must stay below the bloom threshold)", () => {
    const { motes } = rig();
    const mat = motes.material as THREE.PointsMaterial;
    expect(mat.blending).not.toBe(THREE.AdditiveBlending);
  });

  it("animates positions frame to frame under normal motion", () => {
    const { sys, motes } = rig();
    const attr = motes.geometry.getAttribute("position") as THREE.BufferAttribute;
    const before = attr.getX(0);
    for (let i = 0; i < 30; i++) sys.update(CTX());
    expect(attr.getX(0)).not.toBe(before);
  });

  it("reduced motion: positions are laid out once and never rewritten again", () => {
    const { sys, motes, leaves } = rig(true);
    const moteAttr = motes.geometry.getAttribute("position") as THREE.BufferAttribute;
    const leafAttr = leaves.geometry.getAttribute("position") as THREE.BufferAttribute;
    const moteBefore = [moteAttr.getX(0), moteAttr.getY(0), moteAttr.getZ(0)];
    const leafBefore = [leafAttr.getX(0), leafAttr.getY(0), leafAttr.getZ(0)];

    for (let i = 0; i < 120; i++) sys.update(CTX());

    expect([moteAttr.getX(0), moteAttr.getY(0), moteAttr.getZ(0)]).toEqual(moteBefore);
    expect([leafAttr.getX(0), leafAttr.getY(0), leafAttr.getZ(0)]).toEqual(leafBefore);
  });

  it("disposes both clouds and detaches from the scene", () => {
    const { scene, sys } = rig();
    expect(() => sys.dispose()).not.toThrow();
    expect(scene.children.find((o) => o.name === "ambient-motes")).toBeUndefined();
    expect(scene.children.find((o) => o.name === "ambient-leaves")).toBeUndefined();
  });
});
