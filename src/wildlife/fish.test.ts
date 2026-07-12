import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  FISH_BODY_HALF_LENGTH,
  FISH_COUNT,
  FISH_SWAY_SPEED,
  FISH_SWAY_WRAP_PERIOD,
  FLEE_DURATION,
  FLEE_RADIUS,
  FishSystem,
  MIN_POOL_DEPTH,
  fishSwayPhase,
  initialFishState,
  makeFishSwayPatch,
  selectPools,
  stepFish,
} from "./fish.ts";
import { buildTerrain } from "../world/terrain.ts";
import { LAGOON } from "../world/worldConfig.ts";

const FRAME = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), dt: 1 / 60, elapsed: 0 };

function player(x: number, z: number) {
  return { state: { position: new THREE.Vector3(x, 0, z) } };
}

describe("selectPools", () => {
  it("keeps only points deeper than MIN_POOL_DEPTH", () => {
    const depthAt = (x: number, z: number) => (x === LAGOON.x && z === LAGOON.z ? 5 : 0.1);
    const pools = selectPools(depthAt);
    expect(pools).toEqual([{ x: LAGOON.x, z: LAGOON.z }]);
  });

  it("against the real world, finds the lagoon and river pools", () => {
    const terrain = buildTerrain();
    const waterDepthAt = (x: number, z: number) => 0 - terrain.heightAt(x, z);
    const pools = selectPools(waterDepthAt);
    expect(pools.length).toBeGreaterThan(0);
    expect(pools.some((p) => p.x === LAGOON.x && p.z === LAGOON.z)).toBe(true);
    for (const p of pools) expect(waterDepthAt(p.x, p.z)).toBeGreaterThan(MIN_POOL_DEPTH);
  });
});

describe("stepFish (patrol/flee state machine)", () => {
  const pool = { x: 0, z: 0 };

  it("patrols when the player is far away", () => {
    let s = initialFishState(pool, 0);
    for (let i = 0; i < 60; i++) s = stepFish(s, 1 / 60, pool, { x: 1000, z: 1000 });
    expect(s.mode).toBe("patrol");
  });

  it("flees the instant the player comes within FLEE_RADIUS", () => {
    const s0 = initialFishState(pool, 0);
    const s1 = stepFish(s0, 1 / 60, pool, { x: s0.x, z: s0.z + FLEE_RADIUS - 0.5 });
    expect(s1.mode).toBe("flee");
  });

  it("moves AWAY from the player while fleeing (distance increases)", () => {
    const s0 = initialFishState(pool, 0);
    const playerPos = { x: s0.x, z: s0.z + 1 }; // very close
    const s1 = stepFish(s0, 1 / 60, pool, playerPos);
    const before = Math.hypot(s0.x - playerPos.x, s0.z - playerPos.z);
    const after = Math.hypot(s1.x - playerPos.x, s1.z - playerPos.z);
    expect(after).toBeGreaterThan(before);
  });

  it("returns to patrol only after FLEE_DURATION AND the player is clear again", () => {
    let s = initialFishState(pool, 0);
    const closePlayer = { x: s.x, z: s.z + 1 };
    s = stepFish(s, 0, pool, closePlayer); // enters flee
    // Not enough time has passed yet, even though the fish has darted off.
    let probe = stepFish(s, FLEE_DURATION - 0.1, pool, { x: 1000, z: 1000 });
    expect(probe.mode).toBe("flee");
    // Enough time AND clear: resumes patrol.
    probe = stepFish(s, FLEE_DURATION + 0.1, pool, { x: 1000, z: 1000 });
    expect(probe.mode).toBe("patrol");
  });

  it("is deterministic: identical inputs produce identical output", () => {
    const s = initialFishState(pool, 2);
    const a = stepFish(s, 1 / 60, pool, { x: 3, z: 4 });
    const b = stepFish(s, 1 / 60, pool, { x: 3, z: 4 });
    expect(a).toEqual(b);
  });
});

describe("FishSystem", () => {
  const terrain = buildTerrain();
  const waterDepthAt = (x: number, z: number) => 0 - terrain.heightAt(x, z);

  function rig(px = 0, pz = 0) {
    const scene = new THREE.Scene();
    const session = { paused: false };
    const sys = new FishSystem(scene, waterDepthAt, player(px, pz), session);
    return { scene, session, sys };
  }

  it("builds exactly 1 draw call for all fish", () => {
    const { scene } = rig();
    let meshes = 0;
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) meshes++;
    });
    expect(meshes).toBe(1);
    let count = 0;
    scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) count = o.count;
    });
    expect(count).toBe(FISH_COUNT);
  });

  it("reports fish fleeing near a fish's pool and none fleeing far away", () => {
    const far = rig(10000, 10000);
    far.sys.update(FRAME);
    expect((far.sys.describe() as { fleeing: number }).fleeing).toBe(0);

    const close = rig(LAGOON.x, LAGOON.z);
    close.sys.update(FRAME);
    expect((close.sys.describe() as { fleeing: number }).fleeing).toBeGreaterThan(0);
  });

  it("holds all movement while the session is paused", () => {
    const { session, sys } = rig(LAGOON.x, LAGOON.z);
    session.paused = true;
    const before = sys.describe();
    for (let i = 0; i < 200; i++) sys.update(FRAME);
    expect(sys.describe()).toEqual(before);
  });

  it("disposes without throwing, and detaches from the scene", () => {
    const { scene, sys } = rig();
    expect(() => sys.dispose()).not.toThrow();
    expect(scene.children.find((o) => o.name === "wildlife-fish")).toBeUndefined();
  });

  it("merges the fish body with fins into one geometry (still one draw call)", () => {
    const { scene } = rig();
    const mesh = scene.children.find((o) => o.name === "wildlife-fish") as THREE.InstancedMesh;
    // The prior bare cone was 10 triangles; the merged body+tailFin+dorsalFin
    // geometry adds the fins' 3 extra triangles (13 total) — cheap per-fish,
    // but real (never 0, confirming the fins actually merged in).
    const tris = mesh.geometry.getAttribute("position").count / 3;
    expect(tris).toBeGreaterThan(10);
    expect(tris).toBeLessThan(20);
  });

  it("attaches the tail-sway onBeforeCompile/customProgramCacheKey to the shared material", () => {
    const { scene } = rig();
    const mesh = scene.children.find((o) => o.name === "wildlife-fish") as THREE.InstancedMesh;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(typeof mat.onBeforeCompile).toBe("function");
    expect(typeof mat.customProgramCacheKey).toBe("function");
  });
});

// The tail-sway `onBeforeCompile` patch builder (Objects slice 2) — verified
// against the REAL three MeshStandard shader source (the `windPatch.test.ts`
// idiom), not a fabricated stub. No WebGL context needed.
describe("makeFishSwayPatch", () => {
  function freshShader() {
    return {
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: {} as Record<string, { value: unknown }>,
    };
  }

  it("injects the sway block into the vertex stage only (no fragment change)", () => {
    const shader = freshShader();
    const fragBefore = shader.fragmentShader;
    makeFishSwayPatch({ uTime: { value: 0 } }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    expect(shader.fragmentShader).toBe(fragBefore);
    expect(shader.vertexShader).toMatch(/transformed\.x\s*\+=.*tailWeight/);
  });

  it("guards the sway block behind #ifdef USE_INSTANCING", () => {
    const shader = freshShader();
    makeFishSwayPatch({ uTime: { value: 0 } }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    const ifdefIdx = shader.vertexShader.indexOf("#ifdef USE_INSTANCING");
    const swayIdx = shader.vertexShader.indexOf("tailWeight");
    expect(ifdefIdx).toBeGreaterThanOrEqual(0);
    expect(swayIdx).toBeGreaterThan(ifdefIdx);
  });

  it("weights the sway toward the tail (rear, -z), zero at the head (+z)", () => {
    const shader = freshShader();
    makeFishSwayPatch({ uTime: { value: 0 } }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    expect(shader.vertexShader).toContain(
      `const float FISH_BODY_HALF_LENGTH = ${FISH_BODY_HALF_LENGTH.toFixed(1)};`,
    );
    expect(shader.vertexShader).toMatch(/FISH_BODY_HALF_LENGTH\s*-\s*transformed\.z/);
  });

  it("bakes FISH_SWAY_SPEED as a GLSL float constant and merges the caller's uTime uniform", () => {
    const shader = freshShader();
    const uTime = { value: 2.5 };
    makeFishSwayPatch({ uTime }).onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms);
    expect(shader.vertexShader).toContain(`const float FISH_SWAY_SPEED = ${FISH_SWAY_SPEED};`);
    expect(shader.uniforms.uTime).toBe(uTime);
  });

  it("returns a stable customProgramCacheKey", () => {
    const a = makeFishSwayPatch({ uTime: { value: 0 } }).customProgramCacheKey();
    const b = makeFishSwayPatch({ uTime: { value: 0 } }).customProgramCacheKey();
    expect(a).toBe(b);
    expect(typeof a).toBe("string");
  });

  // Review finding 2: the sway phase must be a STABLE per-fish value, not a
  // hash of the fish's (constantly moving) instance-matrix translation.
  it("reads the phase from a per-instance aSwayPhase attribute, not a hash of instanceMatrix translation", () => {
    const shader = freshShader();
    makeFishSwayPatch({ uTime: { value: 0 } }).onBeforeCompile(
      shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    );
    expect(shader.vertexShader).toContain("attribute float aSwayPhase;");
    expect(shader.vertexShader).toMatch(/sin\(\s*uTime \* FISH_SWAY_SPEED \+ aSwayPhase\s*\)/);
    // The old bug: hashing instanceMatrix[3] (the fish's CURRENT position) is
    // gone entirely — never re-derived per frame from something that moves.
    expect(shader.vertexShader).not.toContain("instanceMatrix[3]");
  });
});

describe("fishSwayPhase (per-fish-index tail-sway phase, review finding 2)", () => {
  it("is deterministic and index-seeded, not position-seeded", () => {
    expect(fishSwayPhase(0)).toBe(fishSwayPhase(0));
    expect(fishSwayPhase(3)).toBe(fishSwayPhase(3));
  });

  it("spreads phases across [0, 2π) rather than clustering", () => {
    const phases = Array.from({ length: FISH_COUNT }, (_, i) => fishSwayPhase(i));
    for (const p of phases) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(Math.PI * 2);
    }
    expect(new Set(phases).size).toBe(FISH_COUNT); // no two fish share a phase
  });
});

describe("FishSystem's aSwayPhase attribute (review finding 2)", () => {
  const terrain = buildTerrain();
  const waterDepthAt = (x: number, z: number) => 0 - terrain.heightAt(x, z);

  it("is created once at construction and never rewritten by update()", () => {
    const scene = new THREE.Scene();
    const session = { paused: false };
    const sys = new FishSystem(scene, waterDepthAt, player(0, 0), session);
    const mesh = scene.children.find((o) => o.name === "wildlife-fish") as THREE.InstancedMesh;

    const attr = mesh.geometry.getAttribute("aSwayPhase") as THREE.InstancedBufferAttribute;
    expect(attr).toBeDefined();
    expect(attr.count).toBe(FISH_COUNT);
    const before = attr.array.slice();
    const versionBefore = attr.version;

    for (let i = 0; i < 120; i++) sys.update(FRAME);

    // Same attribute object, untouched contents, untouched version — no
    // per-frame re-hash/re-upload (the bug this replaces re-derived the phase
    // from a moving position every frame).
    expect(mesh.geometry.getAttribute("aSwayPhase")).toBe(attr);
    expect(attr.array).toEqual(before);
    expect(attr.version).toBe(versionBefore);
  });
});

// Review finding 3: the GLSL clock (`uTime`) must wrap on a period that
// closes the sway's own sine term on a whole cycle, exactly like
// windSystem/waterSystem/starfield already do — an unwrapped accumulator
// loses float32 precision on a long-lived tab.
describe("FISH_SWAY_WRAP_PERIOD (review finding 3)", () => {
  it("closes the single sine term on exactly one whole 2π cycle", () => {
    const cycles = (FISH_SWAY_WRAP_PERIOD * FISH_SWAY_SPEED) / (Math.PI * 2);
    expect(cycles).toBeCloseTo(1, 10);
  });

  it("keeps the sway offset continuous across the wrap, for any per-fish phase", () => {
    const phase = fishSwayPhase(7);
    const t = 1.2345;
    const before = Math.sin(t * FISH_SWAY_SPEED + phase);
    const after = Math.sin((t + FISH_SWAY_WRAP_PERIOD) * FISH_SWAY_SPEED + phase);
    expect(after).toBeCloseTo(before, 6);
  });

  it("FishSystem wraps its live uTime modulo FISH_SWAY_WRAP_PERIOD instead of growing unbounded", () => {
    const terrain = buildTerrain();
    const waterDepthAt = (x: number, z: number) => 0 - terrain.heightAt(x, z);
    const scene = new THREE.Scene();
    const session = { paused: false };
    const sys = new FishSystem(scene, waterDepthAt, player(0, 0), session);
    // The uTime `{value}` bag is a private field, but it's the SAME object
    // identity `makeFishSwayPatch`'s `onBeforeCompile` merges onto the real
    // compiled shader (`Object.assign(shader.uniforms, uniforms)`) — reading
    // it here is reading exactly what the GPU would see, the `starfield.test.ts`
    // "peek at the live uniform" idiom, just without a real WebGL compile.
    const sysWithUniforms = sys as unknown as { swayUniforms: { uTime: { value: number } } };

    // A single big step, several whole periods long: an unwrapped accumulator
    // would just keep growing; a wrapped one lands back inside [0, PERIOD).
    sys.update({ ...FRAME, dt: FISH_SWAY_WRAP_PERIOD * 2.5 });
    expect(sysWithUniforms.swayUniforms.uTime.value).toBeGreaterThanOrEqual(0);
    expect(sysWithUniforms.swayUniforms.uTime.value).toBeLessThan(FISH_SWAY_WRAP_PERIOD);
    expect(sysWithUniforms.swayUniforms.uTime.value).toBeCloseTo(0.5 * FISH_SWAY_WRAP_PERIOD, 6);

    // Landing exactly on a whole period wraps back to (very close to) 0, the
    // same "closes seamlessly" invariant asserted algebraically above.
    const sys2 = new FishSystem(scene, waterDepthAt, player(0, 0), { paused: false });
    const sys2WithUniforms = sys2 as unknown as { swayUniforms: { uTime: { value: number } } };
    sys2.update({ ...FRAME, dt: FISH_SWAY_WRAP_PERIOD });
    expect(sys2WithUniforms.swayUniforms.uTime.value).toBeCloseTo(0, 6);
  });
});

// Review finding 1: the rendered heading must always point along the fish's
// ACTUAL frame-to-frame motion, in both patrol and flee — not just the flee
// branch. Runs the REAL FishSystem (not stepFish in isolation) so the
// assertion covers the full render pipeline (instance quaternion vs the
// position delta read back off the instance matrix).
describe("facing matches actual velocity direction (review finding 1)", () => {
  const terrain = buildTerrain();
  const waterDepthAt = (x: number, z: number) => 0 - terrain.heightAt(x, z);

  it("keeps rendered forward aligned with real motion through a full patrol wander cycle AND a flee burst", () => {
    const scene = new THREE.Scene();
    const session = { paused: false };
    const farPlayer = player(10_000, 10_000);
    const sys = new FishSystem(scene, waterDepthAt, farPlayer, session);
    const mesh = scene.children.find((o) => o.name === "wildlife-fish") as THREE.InstancedMesh;

    const dt = 1 / 60;
    const fishIndex = 0; // pools[0] === {LAGOON.x, LAGOON.z} (LAGOON_POOL_OFFSETS[0] is {0,0})
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const prevPos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const vel = new THREE.Vector3();
    let minDot = Infinity;
    let checked = 0;

    function step() {
      sys.update({ scene, camera: new THREE.PerspectiveCamera(), dt, elapsed: 0 });
      mesh.getMatrixAt(fishIndex, m);
      m.decompose(pos, quat, scale);
    }

    step();
    prevPos.copy(pos);

    const checkFrame = () => {
      vel.subVectors(pos, prevPos);
      if (vel.lengthSq() > 1e-10) {
        vel.normalize();
        forward.set(0, 0, 1).applyQuaternion(quat).normalize();
        minDot = Math.min(minDot, forward.dot(vel));
        checked++;
      }
      prevPos.copy(pos);
    };

    // Patrol: run past one full wander cycle (~10.5s at the reviewer's own
    // measured period) so every phase of the Lissajous drift is sampled.
    for (let i = 0; i < Math.ceil(11 / dt); i++) {
      step();
      checkFrame();
    }

    // Flee burst: move the player onto the fish's own pool.
    farPlayer.state.position.set(LAGOON.x, 0, LAGOON.z);
    for (let i = 0; i < Math.ceil(2 / dt); i++) {
      step();
      checkFrame();
    }

    expect(checked).toBeGreaterThan(0);
    expect(minDot).toBeGreaterThanOrEqual(0.95);
  });
});

describe("lagoon bias + colour variation (#184)", () => {
  it("selectPools offers several pools inside the lagoon zone (the kelp beds), plus the river", () => {
    const terrain = buildTerrain();
    const waterDepthAt = (x: number, z: number) => 0 - terrain.heightAt(x, z);
    const pools = selectPools(waterDepthAt);
    const lagoonReach = LAGOON.radius + LAGOON.shoreRamp;
    const inLagoon = pools.filter((p) => Math.hypot(p.x - LAGOON.x, p.z - LAGOON.z) < lagoonReach);
    expect(inLagoon.length).toBeGreaterThanOrEqual(3); // the round-robin assignment favours the lagoon
    expect(pools.length).toBeGreaterThan(inLagoon.length); // the river pools survive
  });

  it("gives fish subtle per-instance colour variation", () => {
    const terrain = buildTerrain();
    const scene = new THREE.Scene();
    new FishSystem(scene, (x, z) => 0 - terrain.heightAt(x, z), player(0, 0), { paused: false });
    const mesh = scene.children.find((o) => o.name === "wildlife-fish") as THREE.InstancedMesh;
    expect(mesh.instanceColor).not.toBeNull();
    const a = new THREE.Color().fromArray(mesh.instanceColor!.array, 0);
    let varies = false;
    for (let i = 1; i < mesh.count; i++) {
      const b = new THREE.Color().fromArray(mesh.instanceColor!.array, i * 3);
      if (!a.equals(b)) varies = true;
    }
    expect(varies).toBe(true);
  });
});
