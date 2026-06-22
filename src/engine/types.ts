// The engine's public contract — the DI seam every later epic plugs into.
//
// Nothing here imports a real WebGL renderer. The world (Epic 2), movement
// (Epic 3), discovery (Epic 4) and shell (Epic 5) each implement `System` and
// register on the Engine, so a test or preview can register a stub system and a
// stub renderer (jsdom has no WebGL) and still exercise the whole update loop.

import type * as THREE from "three";

/** Per-frame context handed to every system's `update`. */
export interface FrameContext {
  /** The shared scene graph systems add their objects to. */
  scene: THREE.Scene;
  /** The active camera. A camera system (Epic 3) may swap `engine.camera`; this
   *  always reflects the current one. */
  camera: THREE.Camera;
  /** Seconds since the previous frame, already clamped to `maxDt`. */
  dt: number;
  /** Total seconds the engine has been running (sum of clamped dts). */
  elapsed: number;
}

/** A pluggable unit of game behaviour, updated once per frame in registration
 *  order. The world, vehicle, flight, camera rig and discovery tracker are all
 *  systems. */
export interface System {
  /** Stable id, used for ordering hints and `getState()` keys. */
  readonly id: string;
  /** Advance this system. Called once per frame and once per `advanceTime` step. */
  update(ctx: FrameContext): void;
  /** Optional: contribute a serialisable slice of state for `render_game_to_text`
   *  and debugging. Keep it small and biased toward currently-relevant state. */
  describe?(): Record<string, unknown>;
  /** Optional: release GPU resources / listeners when the engine is disposed. */
  dispose?(): void;
}

/** The minimal renderer surface the Engine needs. A real `THREE.WebGLRenderer`
 *  satisfies it; tests inject a stub so the loop runs headless. */
export interface RendererLike {
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio(value: number): void;
  dispose(): void;
  /** Present on `WebGLRenderer`; absent on a bare stub — always read defensively. */
  readonly info?: {
    render: { calls: number; triangles: number };
    memory?: { geometries: number; textures: number };
  };
}

/** Injectable animation-frame scheduler, so tests drive frames deterministically
 *  instead of waiting on a real `requestAnimationFrame`. */
export interface FrameScheduler {
  request(cb: (timeMs: number) => void): number;
  cancel(id: number): void;
}

/** A serialisable snapshot of engine + system state. Exposed to the Playwright
 *  test harness via `window.render_game_to_text` and used in debugging. */
export interface EngineState {
  running: boolean;
  elapsed: number;
  fps: number;
  drawCalls: number;
  triangles: number;
  /** One entry per system that implements `describe()`, keyed by system id. */
  systems: Record<string, Record<string, unknown>>;
}
