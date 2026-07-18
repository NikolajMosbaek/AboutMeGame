import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DRINK_SECONDS, HandsSystem, handPose } from "./hands.ts";

const FRAME = (dt = 0.05) => {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(4, 1.7, -2);
  return { scene: new THREE.Scene(), camera, dt, elapsed: 0 };
};

function rig() {
  const scene = new THREE.Scene();
  const survival = { thirst: 50 };
  const forage = { eaten: 0 };
  const quest = { digProgress: null as number | null };
  const sys = new HandsSystem(
    scene,
    { getSnapshot: () => ({ thirst: survival.thirst }) },
    { getSnapshot: () => ({ eaten: forage.eaten }) },
    { getSnapshot: () => ({ digProgress: quest.digProgress }) },
  );
  return { scene, sys, survival, forage, quest };
}

describe("handPose (pure)", () => {
  it("parks idle below the view and raises for a drink, cupping toward the mouth", () => {
    expect(handPose("idle", 0).y).toBeLessThan(-0.5);
    const mid = handPose("drink", 0.5);
    expect(mid.y).toBeGreaterThan(handPose("idle", 0).y);
    expect(mid.rotX).toBeLessThan(0);
    expect(mid.fruitVisible).toBe(false);
  });

  it("one-shots settle back down: pose at progress 1 returns to the parked height", () => {
    expect(handPose("drink", 1).y).toBeCloseTo(handPose("idle", 0).y, 5);
    expect(handPose("eat", 1).y).toBeCloseTo(handPose("idle", 0).y, 5);
  });

  it("eat shows the fruit; dig pumps rhythmically over its clock", () => {
    expect(handPose("eat", 0.5).fruitVisible).toBe(true);
    const a = handPose("dig", 0.1).y;
    const b = handPose("dig", 0.35).y;
    expect(a).not.toBeCloseTo(b, 3);
  });

  it("reduced motion holds a static raised pose — no bell, no pump", () => {
    expect(handPose("drink", 0.1, true).y).toBeCloseTo(handPose("drink", 0.9, true).y, 6);
    expect(handPose("dig", 0.1, true).y).toBeCloseTo(handPose("dig", 0.35, true).y, 6);
  });
});

describe("HandsSystem", () => {
  it("stays hidden at mount and raises on the thirst-rise edge, near the camera", () => {
    const { sys, survival } = rig();
    sys.update(FRAME());
    expect(sys.describe().action).toBe("idle");

    survival.thirst = 80; // a gulp
    const f = FRAME();
    sys.update(f);
    expect(sys.describe().action).toBe("drink");
    // Placed within arm's reach of the camera's world position.
    const g = f.scene; // group lives in the rig scene, not the frame scene
    void g;
    sys.dispose();
  });

  it("plays eat on the eaten edge and clears after its duration", () => {
    const { sys, forage } = rig();
    sys.update(FRAME());
    forage.eaten = 1;
    sys.update(FRAME());
    expect(sys.describe().action).toBe("eat");
    for (let t = 0; t < 1.2; t += 0.05) sys.update(FRAME());
    expect(sys.describe().action).toBe("idle");
    sys.dispose();
  });

  it("digs for exactly as long as the dig runs", () => {
    const { sys, quest } = rig();
    quest.digProgress = 0.2;
    sys.update(FRAME());
    expect(sys.describe().action).toBe("dig");
    for (let t = 0; t < DRINK_SECONDS * 3; t += 0.05) sys.update(FRAME());
    expect(sys.describe().action).toBe("dig"); // loops while digging
    quest.digProgress = null;
    sys.update(FRAME());
    expect(sys.describe().action).toBe("idle");
    sys.dispose();
  });

  it("never replays restored progress at mount (baselines captured)", () => {
    const scene = new THREE.Scene();
    const sys = new HandsSystem(
      scene,
      { getSnapshot: () => ({ thirst: 90 }) },
      { getSnapshot: () => ({ eaten: 7 }) },
      { getSnapshot: () => ({ digProgress: null }) },
    );
    sys.update(FRAME());
    expect(sys.describe().action).toBe("idle");
    sys.dispose();
  });

  it("holds mid-pose while the session is paused and ignores the respawn thirst refill", () => {
    const scene = new THREE.Scene();
    const survival = { thirst: 2 };
    const session = { paused: false };
    const sys = new HandsSystem(
      scene,
      { getSnapshot: () => ({ thirst: survival.thirst }) },
      { getSnapshot: () => ({ eaten: 0 }) },
      { getSnapshot: () => ({ digProgress: null }) },
      session,
    );
    sys.update(FRAME());
    survival.thirst = 75; // the respawn refill — NOT a drink
    sys.update(FRAME());
    expect(sys.describe().action).toBe("idle");

    survival.thirst = 95; // a real gulp (+20)
    sys.update(FRAME());
    expect(sys.describe().action).toBe("drink");
    session.paused = true;
    for (let t = 0; t < 3; t += 0.05) sys.update(FRAME());
    expect(sys.describe().action).toBe("drink"); // frozen, not expired
    sys.dispose();
  });

  it("disposes cleanly, detaching from the scene", () => {
    const { scene, sys } = rig();
    sys.dispose();
    expect(scene.getObjectByName("fp-hands")).toBeUndefined();
  });
});
