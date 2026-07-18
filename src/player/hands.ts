// First-person hands (E1 #233) — a single procedural forearm+hand that rises
// into view for the survival verbs: a drink (thirst-rise edge), a bite (eaten
// edge), the dig's rhythmic pump. Pure pose math (`handPose`) + a thin
// `HandsSystem` that reads the same store edges `AudioSystem` does and places
// the mesh from the camera's WORLD transform every frame — no scene-graph
// parenting, so the camera setup stays untouched. ~60 tris, one draw call,
// zero asset bytes. Reduced motion: the hand appears at a static raised pose
// for the action's duration — presence without animation.

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import { mergeOrThrow, stampVertexColor } from "../wildlife/geometry.ts";

export type HandAction = "idle" | "drink" | "eat" | "dig";

/** One-shot action lengths (seconds). Dig loops for as long as the dig runs. */
export const DRINK_SECONDS = 1.0;
export const EAT_SECONDS = 0.9;
/** Parked pose: fully below the view frustum. */
const PARKED_Y = -0.62;
/** Raised pose: lower-centre of the view, close to the camera. */
const RAISED_Y = -0.26;
const HAND_Z = -0.55;
const HAND_X = 0.18;

export interface HandPose {
  x: number;
  y: number;
  z: number;
  rotX: number;
  rotZ: number;
  fruitVisible: boolean;
}

/** Smooth rise-and-settle bell over a one-shot action: 0→1→0. */
function bell(p: number): number {
  const t = Math.min(1, Math.max(0, p));
  return Math.sin(t * Math.PI);
}

/**
 * Camera-space pose for the hand, pure in (action, progress01, reduced).
 * `progress01` is elapsed/duration for one-shots, or the raw dig clock for
 * the looping dig pump.
 */
export function handPose(action: HandAction, progress01: number, reduced = false): HandPose {
  if (action === "idle") {
    return { x: HAND_X, y: PARKED_Y, z: HAND_Z, rotX: 0, rotZ: 0, fruitVisible: false };
  }
  // Reduced motion: static raised pose, no bell/pump theatrics.
  const lift = reduced ? 1 : bell(progress01);
  if (action === "drink") {
    return {
      x: HAND_X * 0.4,
      y: PARKED_Y + (RAISED_Y - PARKED_Y) * lift,
      z: HAND_Z,
      rotX: -0.9 * lift, // cups toward the mouth
      rotZ: 0.15 * lift,
      fruitVisible: false,
    };
  }
  if (action === "eat") {
    return {
      x: HAND_X * 0.5,
      y: PARKED_Y + (RAISED_Y - PARKED_Y) * lift,
      z: HAND_Z + 0.06 * lift, // tips slightly toward the camera
      rotX: -0.6 * lift,
      rotZ: -0.1 * lift,
      fruitVisible: true,
    };
  }
  // dig: a rhythmic pump — two swings per second, forever, until the dig ends.
  const pump = reduced ? 0 : Math.sin(progress01 * Math.PI * 4) * 0.12;
  return {
    x: HAND_X,
    y: RAISED_Y - 0.08 + pump,
    z: HAND_Z,
    rotX: -0.35 + (reduced ? 0 : pump * 2),
    rotZ: 0.3,
    fruitVisible: false,
  };
}

const SKIN = 0xc08a5f;
const SLEEVE = 0x6b6a4f; // expedition khaki
const FRUIT = 0xe8c93f;

function buildArmGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const sleeve = stampVertexColor(new THREE.CylinderGeometry(0.055, 0.07, 0.28, 6), SLEEVE);
  sleeve.rotateX(Math.PI / 2 - 0.35);
  sleeve.translate(0, -0.1, 0.14);
  parts.push(sleeve);
  const wrist = stampVertexColor(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6), SKIN);
  wrist.rotateX(Math.PI / 2 - 0.35);
  wrist.translate(0, 0.02, -0.02);
  parts.push(wrist);
  const palm = stampVertexColor(new THREE.BoxGeometry(0.09, 0.04, 0.11), SKIN);
  palm.translate(0, 0.05, -0.09);
  parts.push(palm);
  // Four merged finger stubs — a mitt reads fine at this scale.
  const fingers = stampVertexColor(new THREE.BoxGeometry(0.085, 0.032, 0.07), SKIN);
  fingers.translate(0, 0.055, -0.17);
  parts.push(fingers);
  const thumb = stampVertexColor(new THREE.BoxGeometry(0.028, 0.03, 0.06), SKIN);
  thumb.translate(0.055, 0.045, -0.1);
  parts.push(thumb);
  const merged = mergeOrThrow(parts);
  for (const g of parts) g.dispose();
  return merged;
}

/** Thirst rises on a drink — the survival store satisfies it. */
export interface DrinkSource {
  getSnapshot(): { thirst: number };
}
/** Eaten count rises on a bite — the forage store satisfies it. */
export interface EatSource {
  getSnapshot(): { eaten: number };
}
/** Dig progress is non-null while digging — the quest store satisfies it. */
export interface DigSource {
  getSnapshot(): { digProgress: number | null };
}
export interface ReducedMotionSource {
  getSnapshot(): { reducedMotion: boolean };
}

export class HandsSystem implements System {
  readonly id = "hands";

  private readonly group = new THREE.Group();
  private readonly armGeo: THREE.BufferGeometry;
  private readonly armMat: THREE.MeshStandardMaterial;
  private readonly fruitMesh: THREE.Mesh;
  private readonly fruitGeo: THREE.SphereGeometry;
  private readonly fruitMat: THREE.MeshStandardMaterial;

  private action: HandAction = "idle";
  private actionT = 0;
  private lastThirst: number;
  private lastEaten: number;

  private readonly offset = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly survival: DrinkSource,
    private readonly forage: EatSource,
    private readonly quest: DigSource,
    private readonly reducedMotion?: ReducedMotionSource,
  ) {
    this.armGeo = buildArmGeometry();
    this.armMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
    const arm = new THREE.Mesh(this.armGeo, this.armMat);
    this.fruitGeo = new THREE.SphereGeometry(0.045, 6, 5);
    this.fruitMat = new THREE.MeshStandardMaterial({ color: FRUIT, flatShading: true, roughness: 0.7 });
    this.fruitMesh = new THREE.Mesh(this.fruitGeo, this.fruitMat);
    this.fruitMesh.position.set(0, 0.09, -0.13);
    this.group.add(arm, this.fruitMesh);
    this.group.name = "fp-hands";
    this.group.visible = false;
    // Always in front of the player, never culled away mid-raise.
    this.group.frustumCulled = false;
    scene.add(this.group);

    this.lastThirst = this.survival.getSnapshot().thirst;
    this.lastEaten = this.forage.getSnapshot().eaten;
  }

  update(ctx: FrameContext): void {
    // Edges (mount baselines captured, the AudioSystem posture).
    const thirst = this.survival.getSnapshot().thirst;
    if (thirst > this.lastThirst) this.start("drink");
    this.lastThirst = thirst;
    const eaten = this.forage.getSnapshot().eaten;
    if (eaten > this.lastEaten) this.start("eat");
    this.lastEaten = eaten;

    const digging = this.quest.getSnapshot().digProgress !== null;
    if (digging && this.action !== "dig") this.start("dig");
    if (!digging && this.action === "dig") this.action = "idle";

    if (this.action === "idle") {
      this.group.visible = false;
      return;
    }
    this.actionT += ctx.dt;
    const duration = this.action === "drink" ? DRINK_SECONDS : EAT_SECONDS;
    if (this.action !== "dig" && this.actionT >= duration) {
      this.action = "idle";
      this.group.visible = false;
      return;
    }

    const reduced = this.reducedMotion?.getSnapshot().reducedMotion ?? false;
    const progress = this.action === "dig" ? this.actionT : this.actionT / duration;
    const pose = handPose(this.action, progress, reduced);

    // Place from the camera's world transform: local offset rotated into
    // world space — no parenting, no scene-graph surgery.
    const cam = ctx.camera;
    this.offset.set(pose.x, pose.y, pose.z).applyQuaternion(cam.quaternion);
    this.group.position.copy(cam.position).add(this.offset);
    this.group.quaternion.copy(cam.quaternion);
    this.group.rotateX(pose.rotX);
    this.group.rotateZ(pose.rotZ);
    this.fruitMesh.visible = pose.fruitVisible;
    this.group.visible = true;
  }

  private start(action: HandAction): void {
    this.action = action;
    this.actionT = 0;
  }

  describe(): Record<string, unknown> {
    return { action: this.action };
  }

  dispose(): void {
    this.group.parent?.remove(this.group);
    this.armGeo.dispose();
    this.armMat.dispose();
    this.fruitGeo.dispose();
    this.fruitMat.dispose();
  }
}
