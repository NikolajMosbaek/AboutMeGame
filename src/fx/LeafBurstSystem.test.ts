import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LeafBurstSystem } from "./LeafBurstSystem.ts";

const FRAME = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), dt: 1 / 60, elapsed: 0 };

function queueSource(...positions: Array<{ x: number; y: number; z: number }>) {
  const queue = [...positions];
  return { consumeFlushBurst: () => queue.shift() ?? null, queue };
}

describe("LeafBurstSystem", () => {
  it("fires the pooled burst when the birds flush, at the flock position", () => {
    const scene = new THREE.Scene();
    const sys = new LeafBurstSystem(scene, queueSource({ x: 5, y: 20, z: -3 }));
    expect(sys.describe().active).toBe(false);
    sys.update(FRAME);
    expect(sys.describe().active).toBe(true);
    sys.dispose();
  });

  it("suppresses the particles under reduced motion but still drains the queue", () => {
    const scene = new THREE.Scene();
    const source = queueSource({ x: 0, y: 10, z: 0 });
    const sys = new LeafBurstSystem(scene, source, {
      getSnapshot: () => ({ reducedMotion: true }),
    });
    sys.update(FRAME);
    expect(sys.describe().active).toBe(false); // no motion…
    expect(source.queue.length).toBe(0); // …but no buildup either
    sys.dispose();
  });

  it("buffers a second flush until the active burst has finished — no teleporting cloud", () => {
    const scene = new THREE.Scene();
    const source = queueSource({ x: 0, y: 10, z: 0 }, { x: 50, y: 10, z: 50 });
    const sys = new LeafBurstSystem(scene, source);
    sys.update(FRAME); // fires burst 1
    sys.update(FRAME); // burst 1 still active — burst 2 must WAIT in the queue
    expect(source.queue.length).toBe(1);
    // Let burst 1 finish, then the queued flush fires.
    for (let i = 0; i < 300 && sys.describe().active; i++) sys.update(FRAME);
    sys.update(FRAME);
    expect(source.queue.length).toBe(0);
    expect(sys.describe().active).toBe(true);
    sys.dispose();
  });

  it("disposes cleanly and detaches its points from the scene", () => {
    const scene = new THREE.Scene();
    const sys = new LeafBurstSystem(scene, queueSource());
    const before = scene.children.length;
    expect(before).toBeGreaterThan(0);
    sys.dispose();
    expect(scene.children.length).toBe(before - 1);
  });
});
