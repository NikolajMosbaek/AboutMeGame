// Fish (pivot slice F, wildlife #184): dark shadow shapes patrolling the
// lagoon and river pools, darting away when the player wades close — sells
// the water as alive. One draw call (a single InstancedMesh of flattened
// cones); the patrol/flee state machine is a pure step function so it is
// fully headless-testable (`stepFish`), and `FishSystem` only integrates it
// into instance matrices each frame.

import * as THREE from "three";
import type { FrameContext, System } from "../engine/types.ts";
import { glslFloat } from "../world/glslFormat.ts";
import { LAGOON, RIVER, WORLD } from "../world/worldConfig.ts";
import { mergeOrThrow, stampVertexColor } from "./geometry.ts";
import { COMIC_TIMING, PLAIN_TIMING, overshoot, type ReactionTiming } from "./reactions.ts";

/** Where the player is and how fast they're moving — the explorer satisfies
 *  it (speed feeds the wading-splash startle, J1 #219). */
export interface PositionSource {
  readonly state: { position: THREE.Vector3; speed: number };
}

/** Live reduced-motion flag — a `SettingsStore` satisfies it. Optional: when
 *  absent, full comic timing applies. */
export interface ReducedMotionSource {
  getSnapshot(): { reducedMotion: boolean };
}

/** Hold all movement while true — the shared session pause flag satisfies it. */
export interface PauseSource {
  readonly paused: boolean;
}

/** Still-water depth at a ground point, metres (`World.waterDepthAt` satisfies
 *  it) — the ONE definition of "where water is," reused rather than re-derived. */
export type WaterDepthAt = (x: number, z: number) => number;

export const FISH_COUNT = 12;
/** Only water at least this deep counts as a fish pool — matches the spec's
 *  "deeper than 0.8" and keeps fish off the shallow, wade-able banks. */
export const MIN_POOL_DEPTH = 0.8;
export const FLEE_RADIUS = 6;
export const FLEE_DURATION = 1.4;
export const FLEE_SPEED = 5.5;
export const PATROL_SPEED = 0.6;
export const PATROL_RADIUS = 3.5;
/** Fish swim just under the still-water plane — a constant offset below
 *  `WORLD.seaLevel`, not tied to the (carved, uneven) river bed. */
export const SWIM_DEPTH = 0.45;

export interface Pool {
  x: number;
  z: number;
}

/** Extra lagoon-basin candidates over the kelp beds (#184): fish are dealt to
 *  pools round-robin, so more lagoon pools = more fish where the player now
 *  swims. Offsets stay well inside `LAGOON.radius`, at full basin depth. */
const LAGOON_POOL_OFFSETS = [
  { dx: 0, dz: 0 },
  { dx: 10, dz: -6 },
  { dx: -9, dz: 7 },
] as const;

/**
 * Candidate pool centres deep enough to hold fish: the lagoon (weighted with
 * the kelp-bed offsets above, so the swimmable water reads alive) plus every
 * river-course point (`RIVER.points`, the channel's own centreline, always at
 * full bed depth). Filtered live against `waterDepthAt` rather than hardcoded,
 * so a future reshape of the river/lagoon keeps this correct for free.
 */
export function selectPools(waterDepthAt: WaterDepthAt): Pool[] {
  const candidates: Pool[] = [
    ...LAGOON_POOL_OFFSETS.map((o) => ({ x: LAGOON.x + o.dx, z: LAGOON.z + o.dz })),
    ...RIVER.points,
  ];
  return candidates.filter((p) => waterDepthAt(p.x, p.z) > MIN_POOL_DEPTH);
}

/** A wading splash (player moving in water) startles the WHOLE pool when it
 *  lands within this of the pool centre — every fish, not just the near ones
 *  (J1 #219). The dart that follows outruns a plain flee by this multiple. */
export const SPLASH_RADIUS = 8;
export const DART_SPEED_MULT = 1.5;

export type FishMode = "patrol" | "flee" | "freeze" | "dart";

export interface FishState {
  x: number;
  z: number;
  mode: FishMode;
  /** Seconds spent fleeing (patrol mode keeps this at 0). */
  timer: number;
  /** Patrol wander CLOCK, radians — drifts continuously while patrolling. This
   *  is the Lissajous drive angle, NOT the fish's facing (see {@link heading}):
   *  the actual velocity also carries the centre-pull term, so it is not
   *  simply `(cos(angle), sin(angle))`. */
  angle: number;
  /**
   * The direction this step's motion actually points, `atan2(vx, vz)` of the
   * frame's real velocity — ONE convention for both patrol and flee, fed
   * straight to the render `Euler(0, heading, 0)` Y-rotation. three's yaw maps
   * local +Z forward to world `(sin heading, cos heading)`, which is exactly
   * `(vx, vz)` normalized when `heading = atan2(vx, vz)` — so the rendered
   * forward always matches the true motion vector, never just the wander
   * clock (review finding 1: using `angle` directly as heading made the fish
   * swim sideways/backwards over the wander cycle, since velocity is
   * `(cos(angle), sin(angle))` but yaw-forward is `(sin(angle), cos(angle))`
   * — those only agree at `sin(2*angle) = 1`).
   */
  heading: number;
}

export function initialFishState(pool: Pool, index: number): FishState {
  const angle = (index / FISH_COUNT) * Math.PI * 2;
  return {
    x: pool.x + Math.cos(angle) * 2,
    z: pool.z + Math.sin(angle) * 2,
    mode: "patrol",
    timer: 0,
    angle,
    // First frame's dominant velocity term is (cos(angle), sin(angle)) *
    // PATROL_SPEED (the centre-pull is a small correction at this radius), so
    // seed heading with the SAME atan2(vx, vz) convention `stepFish` uses.
    heading: Math.atan2(Math.cos(angle), Math.sin(angle)),
  };
}

/**
 * Advance one fish's state by `dt`. Pure: given the same prior state, `dt`,
 * pool centre and player position, always returns the same next state.
 *
 * `patrol`: wanders in a loose Lissajous path around its pool centre, gently
 * pulled back when it strays past {@link PATROL_RADIUS}. The instant the
 * player is within {@link FLEE_RADIUS}, it darts directly away from the
 * player's CURRENT position (re-aimed every frame, so a moving player is
 * still evaded) at {@link FLEE_SPEED}. `flee` holds for at least
 * {@link FLEE_DURATION}; once that has elapsed AND the player is clear again,
 * it resumes patrol. Fish never leave their pool for good — the flee burst is
 * short and patrol's centre-pull brings them back.
 */
export function stepFish(
  state: FishState,
  dt: number,
  pool: Pool,
  player: { x: number; z: number },
  wadingSplash = false,
  timing: ReactionTiming = COMIC_TIMING,
): FishState {
  const distToPlayer = Math.hypot(state.x - player.x, state.z - player.z);
  let mode = state.mode;
  let timer = state.timer;

  if (mode === "patrol") {
    if (distToPlayer < FLEE_RADIUS) {
      mode = "flee";
      timer = 0;
    } else if (wadingSplash && Math.hypot(player.x - pool.x, player.z - pool.z) < SPLASH_RADIUS) {
      // The splash startles the WHOLE pool through the grammar's comic beat:
      // an instant of held stillness, then an overshooting radial dart.
      mode = timing.freezeSeconds <= 0 ? "dart" : "freeze";
      timer = 0;
    }
  } else if (mode === "freeze") {
    timer += dt;
    if (timer >= timing.freezeSeconds) {
      mode = "dart";
      timer = 0;
    } else {
      // Held dead-still — the "…!" beat (position, heading, wander all frozen).
      return { ...state, mode, timer };
    }
  } else {
    timer += dt;
    if (timer >= FLEE_DURATION && distToPlayer >= FLEE_RADIUS) {
      mode = "patrol";
      timer = 0;
    }
  }

  let vx: number;
  let vz: number;
  let angle = state.angle;

  if (mode === "flee" || mode === "dart") {
    const awayX = state.x - player.x;
    const awayZ = state.z - player.z;
    const len = Math.hypot(awayX, awayZ) || 1;
    const speed =
      mode === "dart"
        ? FLEE_SPEED * DART_SPEED_MULT * overshoot(timer / timing.reactSeconds)
        : FLEE_SPEED;
    vx = (awayX / len) * speed;
    vz = (awayZ / len) * speed;
  } else {
    angle += dt * 0.6;
    const toCenterX = pool.x - state.x;
    const toCenterZ = pool.z - state.z;
    const distFromCenter = Math.hypot(toCenterX, toCenterZ);
    const pull = distFromCenter > PATROL_RADIUS ? 1 : 0.15;
    vx = Math.cos(angle) * PATROL_SPEED + toCenterX * pull * 0.4;
    vz = Math.sin(angle) * PATROL_SPEED + toCenterZ * pull * 0.4;
  }

  // ONE heading convention for both modes — the actual velocity direction,
  // never a raw state field re-purposed as facing (review finding 1).
  const heading = Math.atan2(vx, vz);

  return { x: state.x + vx * dt, z: state.z + vz * dt, mode, timer, angle, heading };
}

const FISH_COLOR = 0x121f26;
/** Fins a touch lighter than the body — reads as translucent fin membrane
 *  against the dark body silhouette. */
const FIN_COLOR = 0x24404d;

/**
 * Body (the original flattened-cone shadow-shape) + a caudal (tail) fin
 * flaring out behind the pointed rear + a small dorsal fin along the spine,
 * merged to ONE geometry (still the SAME single `InstancedMesh` draw call) —
 * Objects slice 2: the prior body was a bare flattened cone with no fins at
 * all, reading as a shadow blob rather than a fish. The cone's WIDE end (the
 * base disc, local z = +0.5) is the head — confirmed empirically against
 * `FishSystem`'s own heading convention (`Euler(0, heading, 0)` applied to a
 * local +Z point lands it in the SAME world direction `stepFish` moves the
 * fish for that heading), not the pointed apex the geometry's own prior
 * comment claimed; the apex (z = -0.5) is the tail end, which is where the
 * new fins attach. No CC0 tropical-fish model was found through this
 * codebase's OWN scriptable-download conventions: poly.pizza gates its
 * search API behind a paid key with mixed per-model licences; Kenney's
 * Survival Kit (already vendored for Objects slice 1) ships exactly two fish
 * meshes, but as a fishing-minigame prop pair, not something reusable as a
 * swimming school; Quaternius's itch.io mirror of "Fish Pack Animated" IS CC0
 * and its browse/csrf/signed-download-page flow IS scriptable this far — but
 * the final `/file/<id>` download step 404s off that flow (an itch.io
 * private-endpoint quirk, not documented anywhere the way Kenney's stable zip
 * URLs are), and the source models are SKINNED (rigged for itch's own
 * animation clips) — stripping the skin down to a single bind-pose mesh for
 * this pipeline would be real extra engineering against an unverified
 * download path. So — per the slice's own licence — this is a procedural
 * upgrade, kept cheap (all-new geometry is 3 extra triangles) since it
 * multiplies by every one of `FISH_COUNT` instances.
 */
function buildFishGeometry(): THREE.BufferGeometry {
  const cone = new THREE.ConeGeometry(0.3, 1, 5);
  cone.rotateX(-Math.PI / 2);
  cone.scale(1, 0.32, 1); // flatten into a shadow-shape silhouette
  cone.deleteAttribute("uv"); // the fins below carry no UVs — mergeGeometries
  // requires an identical attribute set across every source.
  const body = stampVertexColor(cone, FISH_COLOR);

  // Caudal (tail) fin: a flattened diamond flaring out from the pointed rear
  // (local z = -0.5) further back, forking into an upper/lower lobe.
  const tailFin = new THREE.BufferGeometry();
  tailFin.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([
        0, 0, -0.5, 0, 0.22, -0.92, 0, 0, -1.08,
        0, 0, -0.5, 0, 0, -1.08, 0, -0.22, -0.92,
      ]),
      3,
    ),
  );
  tailFin.computeVertexNormals();
  const tail = stampVertexColor(tailFin, FIN_COLOR);

  // Dorsal fin: one small triangle standing up from the spine, roughly
  // mid-body.
  const dorsalFin = new THREE.BufferGeometry();
  dorsalFin.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array([-0.05, 0.08, -0.02, 0.05, 0.08, -0.02, 0, 0.3, -0.18]), 3),
  );
  dorsalFin.computeVertexNormals();
  const dorsal = stampVertexColor(dorsalFin, FIN_COLOR);

  const merged = mergeOrThrow([body, tail, dorsal]);
  body.dispose();
  tail.dispose();
  dorsal.dispose();
  return merged;
}

// --- Tail sway (Objects slice 2) --------------------------------------------
//
// A modelled tail fin held perfectly rigid would read STIFFER than the prior
// bare-cone fish (which at least turned/darted as a whole body) — the
// wildlife spec's own "judge motion honestly" bar. Rather than animate the
// fin as a second mesh (a second draw call, and `stepFish`/the behaviour
// contract must stay untouched), this patches the ONE fish `InstancedMesh`
// material with the SAME cheap `onBeforeCompile` vertex-bend idiom
// `windPatch.ts` uses for foliage: a sinusoidal lateral bend, weighted by how
// far a vertex sits toward the REAR of the body (local -Z, where the tail fin
// attaches), so only the tail/rear third visibly wags while the head stays
// put — a swimming beat, not a rigid glide. Every fish shares one `uTime`
// (this system's own held clock, mirroring `BirdsSystem`'s).
//
// Per-instance phase (review finding 2): `windPatch.ts`'s hash-from-
// `instanceMatrix[3].xz` idiom only decorrelates neighbours that never move —
// static props. A fish's translation changes every frame, so hashing it fed a
// DIFFERENT, uncorrelated phase into the sine each frame — noise, not a
// stable per-fish beat. Fixed the `starfield.ts` way instead: a per-instance
// `aSwayPhase` `InstancedBufferAttribute`, seeded once (by the fish's STABLE
// array index, via {@link fishSwayPhase}, the same sine-hash trick as
// `windSway.ts`'s `windPhase` but on an index rather than a re-randomizing
// world position) at construction and never rewritten in `update()`.
export const FISH_SWAY_SPEED = 5.2; // rad/s-ish beat frequency
export const FISH_SWAY_STRENGTH = 0.1; // world-unit lateral sway at the tail tip
export const FISH_SWAY_EXPONENT = 2; // biases the wag toward the rear third only
/** Local-Z span the cone's body occupies (±0.5, see `buildFishGeometry`) —
 *  the tail-weight ramp's zero point (nose) vs full point (tail). */
export const FISH_BODY_HALF_LENGTH = 0.5;

// --- Time wrap (float32 precision guard — the windSystem/waterSystem/
// starfield precedent) ---
// The sway is a single sine term, `sin(uTime * FISH_SWAY_SPEED + aSwayPhase)`
// — exactly `windSway.ts`'s single-term case, not `waterSurface.ts`'s two-term
// GCD derivation. It completes one whole cycle every `2π / FISH_SWAY_SPEED`
// time units, so wrapping the live accumulator modulo that period is
// seamless: `sin((t + P) * FISH_SWAY_SPEED + phase) === sin(t *
// FISH_SWAY_SPEED + phase)` for ANY per-fish `phase`, since `phase` is
// additive inside the same sine argument the wrap divides out of cleanly —
// per-fish continuity holds regardless of which fish's phase is plugged in.
/** Shared continuous wrap period (seconds) for the tail-sway clock — the
 *  smallest `T` with `T * FISH_SWAY_SPEED` a whole multiple of `2π`. */
export const FISH_SWAY_WRAP_PERIOD = (2 * Math.PI) / FISH_SWAY_SPEED;

/**
 * Deterministic per-fish-index tail-sway phase, radians in `[0, 2π)` — the
 * same sine-hash ("hash11") trick `windSway.ts`'s `windPhase` uses, but seeded
 * by the fish's STABLE array index rather than its world position (a fish's
 * position changes every frame, which is exactly the bug this replaces — see
 * this section's header doc). Baked once per fish into the `aSwayPhase`
 * `InstancedBufferAttribute` at construction; never recomputed per frame.
 */
export function fishSwayPhase(index: number): number {
  const h = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return (h - Math.floor(h)) * Math.PI * 2;
}

interface FishSwayPatch {
  onBeforeCompile: (shader: THREE.WebGLProgramParametersWithUniforms) => void;
  customProgramCacheKey: () => string;
}

/** Pure (given the uniform bag) shader-patch builder — headless-testable
 *  against the real `THREE.ShaderLib` source, the `waterPatch.ts`/
 *  `windPatch.ts` discipline. */
export function makeFishSwayPatch(uniforms: { uTime: { value: number } }): FishSwayPatch {
  const decl =
    "attribute float aSwayPhase;\n" +
    "uniform float uTime;\n" +
    `const float FISH_SWAY_SPEED = ${glslFloat(FISH_SWAY_SPEED)};\n` +
    `const float FISH_SWAY_STRENGTH = ${glslFloat(FISH_SWAY_STRENGTH)};\n` +
    `const float FISH_SWAY_EXPONENT = ${glslFloat(FISH_SWAY_EXPONENT)};\n` +
    `const float FISH_BODY_HALF_LENGTH = ${glslFloat(FISH_BODY_HALF_LENGTH)};\n`;
  const body =
    "#ifdef USE_INSTANCING\n" +
    "\t{\n" +
    "\t\tfloat tailWeight = clamp( ( FISH_BODY_HALF_LENGTH - transformed.z ) / ( 2.0 * FISH_BODY_HALF_LENGTH ), 0.0, 1.0 );\n" +
    "\t\ttailWeight = pow( tailWeight, FISH_SWAY_EXPONENT );\n" +
    "\t\ttransformed.x += sin( uTime * FISH_SWAY_SPEED + aSwayPhase ) * FISH_SWAY_STRENGTH * tailWeight;\n" +
    "\t}\n" +
    "#endif\n";

  const onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = decl + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n" + body,
    );
  };
  const customProgramCacheKey = () => "fish-sway-v2";

  return { onBeforeCompile, customProgramCacheKey };
}

/**
 * One draw call (a single `InstancedMesh`) for all `FISH_COUNT` fish, however
 * many pools they're spread across — the wildlife budget's per-creature cap.
 */
export class FishSystem implements System {
  readonly id = "wildlife-fish";

  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly mesh: THREE.InstancedMesh;
  private readonly pools: Pool[];
  private states: FishState[];
  /** The tail-sway patch's shared clock ({@link makeFishSwayPatch}) — a
   *  system-owned `{value}` uniform (mirrors `WindUniforms`), advanced only
   *  while unpaused (`BirdsSystem`'s own-clock convention) so a held school
   *  resumes its beat exactly where it froze rather than jumping. */
  private readonly swayUniforms = { uTime: { value: 0 } };
  private swayElapsed = 0;

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly sc = new THREE.Vector3(1, 1, 1);
  private readonly posv = new THREE.Vector3();
  private readonly euler = new THREE.Euler();

  constructor(
    scene: THREE.Scene,
    private readonly waterDepthAt: WaterDepthAt,
    private readonly player: PositionSource,
    private readonly session: PauseSource,
    private readonly reducedMotion?: ReducedMotionSource,
  ) {
    this.geo = buildFishGeometry();
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.6 });
    const swayPatch = makeFishSwayPatch(this.swayUniforms);
    this.mat.onBeforeCompile = swayPatch.onBeforeCompile;
    this.mat.customProgramCacheKey = swayPatch.customProgramCacheKey;
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, FISH_COUNT);
    this.mesh.name = "wildlife-fish";
    scene.add(this.mesh);

    // Safety net only: the real river/lagoon are always deep enough for at
    // least one pool, but a degenerate/flat test terrain must not crash.
    const found = selectPools(waterDepthAt);
    this.pools = found.length > 0 ? found : [{ x: LAGOON.x, z: LAGOON.z }];
    this.states = Array.from({ length: FISH_COUNT }, (_, i) =>
      initialFishState(this.pools[i % this.pools.length], i),
    );

    // Subtle per-instance shade variation (#184) — deterministic by index, so
    // the school doesn't read as twelve copies of one shadow. instanceColor
    // multiplies the stamped vertex colour; costs nothing per frame.
    const tint = new THREE.Color();
    for (let i = 0; i < FISH_COUNT; i++) {
      this.mesh.setColorAt(i, tint.setHex(0xffffff).offsetHSL(0, 0, ((i % 5) - 2) * 0.05));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

    // Per-instance tail-sway phase (review finding 2) — seeded once by index
    // via `fishSwayPhase`, NEVER rewritten afterward (no `.needsUpdate` write
    // in `update()`), so each fish keeps its own stable beat instead of
    // re-randomizing every frame off its (constantly moving) position.
    const swayPhases = new Float32Array(FISH_COUNT);
    for (let i = 0; i < FISH_COUNT; i++) swayPhases[i] = fishSwayPhase(i);
    this.geo.setAttribute("aSwayPhase", new THREE.InstancedBufferAttribute(swayPhases, 1));
  }

  update(ctx: FrameContext): void {
    if (this.session.paused) return; // HOLD the sway phase too — don't advance, don't reset.
    // Wrap modulo FISH_SWAY_WRAP_PERIOD (float32-precision discipline — the
    // windSystem/waterSystem/starfield precedent; see that constant's own doc
    // for why the per-fish `aSwayPhase` stays continuous across the wrap).
    this.swayElapsed = THREE.MathUtils.euclideanModulo(this.swayElapsed + ctx.dt, FISH_SWAY_WRAP_PERIOD);
    this.swayUniforms.uTime.value = this.swayElapsed;
    const p = this.player.state.position;
    // A "splash" is the player actually churning water: standing in it (any
    // depth) while moving at a real pace (J1 #219).
    const wadingSplash = this.player.state.speed > 1 && this.waterDepthAt(p.x, p.z) > 0.05;
    const timing = this.reducedMotion?.getSnapshot().reducedMotion ? PLAIN_TIMING : COMIC_TIMING;
    for (let i = 0; i < this.states.length; i++) {
      const pool = this.pools[i % this.pools.length];
      const next = stepFish(this.states[i], ctx.dt, pool, { x: p.x, z: p.z }, wadingSplash, timing);
      this.states[i] = next;

      this.posv.set(next.x, WORLD.seaLevel - SWIM_DEPTH, next.z);
      // Facing: ONE convention for both modes — `next.heading` is already
      // `atan2(vx, vz)` of the frame's real velocity (see `FishState.heading`
      // doc), so patrol and flee both render pointing where they're actually
      // moving, never sideways/backwards over the wander cycle.
      this.euler.set(0, next.heading, 0);
      this.q.setFromEuler(this.euler);
      this.m.compose(this.posv, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  describe(): Record<string, unknown> {
    const fleeing = this.states.filter((s) => s.mode === "flee").length;
    return { fish: this.states.length, fleeing };
  }

  dispose(): void {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.dispose();
    this.geo.dispose();
    this.mat.dispose();
  }
}
