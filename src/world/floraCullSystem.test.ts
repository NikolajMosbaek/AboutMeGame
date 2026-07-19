import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FloraCullSystem, UNDERSTORY_DRAW_DISTANCE } from "./floraCullSystem.ts";

function chunkAt(x: number, z: number, radius = 60): THREE.InstancedMesh {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial(), 1);
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, 0, z), radius);
  return mesh;
}

function frame(camX: number, camZ: number) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(camX, 1.7, camZ);
  return { scene: new THREE.Scene(), camera, dt: 1 / 60, elapsed: 0 };
}

describe("FloraCullSystem", () => {
  it("hides understory chunks whose nearest edge is beyond the draw distance, shows near ones", () => {
    const near = chunkAt(50, 0); // edge at 50 - 60 < 0 → effectively on top of us
    const far = chunkAt(400, 0); // edge at 400 - 60 = 340 ≫ draw distance
    const sys = new FloraCullSystem(() => [near, far]);
    sys.update(frame(0, 0));
    expect(near.visible).toBe(true);
    expect(far.visible).toBe(false);
    expect(UNDERSTORY_DRAW_DISTANCE).toBeGreaterThan(0);
  });

  it("re-shows a chunk when the camera comes back into range", () => {
    const chunk = chunkAt(300, 0);
    const sys = new FloraCullSystem(() => [chunk]);
    sys.update(frame(0, 0));
    expect(chunk.visible).toBe(false);
    sys.update(frame(280, 0));
    expect(chunk.visible).toBe(true);
  });

  it("tolerates an empty chunk list (the pre-swap window) and a missing bounding sphere", () => {
    const bare = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
      1,
    );
    const sys = new FloraCullSystem(() => []);
    expect(() => sys.update(frame(0, 0))).not.toThrow();
    const sys2 = new FloraCullSystem(() => [bare]);
    expect(() => sys2.update(frame(0, 0))).not.toThrow();
    expect(bare.visible).toBe(true); // no sphere → never culled by us
  });
});
