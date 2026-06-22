import * as THREE from "three";
import type { Engine } from "../engine/Engine.ts";
import type { System } from "../engine/types.ts";

/**
 * The Epic 1 placeholder world: a lit, slowly-rotating cube on a ground plane,
 * with a camera framing it. Its only job is to prove the engine renders on
 * desktop and mobile Safari (the #8 "hello cube" acceptance criterion). Epic 2
 * replaces `buildHelloWorld` with the real terrain/sky/landmark world builder;
 * the Engine + `buildWorld` seam stays identical.
 */
class SpinningCube implements System {
  readonly id = "helloCube";
  private spin = 0;
  constructor(private readonly mesh: THREE.Mesh) {}

  update(ctx: { dt: number }): void {
    this.spin += ctx.dt * 0.6;
    this.mesh.rotation.set(this.spin * 0.5, this.spin, 0);
  }

  describe(): Record<string, unknown> {
    return {
      spin: Math.round(this.spin * 100) / 100,
      position: this.mesh.position.toArray().map((n) => Math.round(n * 100) / 100),
    };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Populate an engine with the placeholder scene and return it (for chaining). */
export function buildHelloWorld(engine: Engine): Engine {
  const { scene, camera } = engine;
  scene.background = new THREE.Color(0x1a2740);

  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x202024, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(5, 8, 4);
  sun.castShadow = true;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x3a5a40, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1;
  ground.receiveShadow = true;
  scene.add(ground);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 1.5, 1.5),
    new THREE.MeshStandardMaterial({ color: 0xffcb47, roughness: 0.4, metalness: 0.1 }),
  );
  cube.castShadow = true;
  scene.add(cube);

  camera.position.set(3.5, 2.5, 4.5);
  camera.lookAt(0, 0, 0);

  engine.addSystem(new SpinningCube(cube));
  return engine;
}
