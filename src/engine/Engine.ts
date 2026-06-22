import * as THREE from "three";
import type {
  EngineState,
  FrameContext,
  FrameScheduler,
  RendererLike,
  System,
} from "./types.ts";

export interface EngineOptions {
  /** The renderer to draw with. Production passes a `THREE.WebGLRenderer`; tests
   *  pass a stub (jsdom has no WebGL). Injected, never constructed here. */
  renderer: RendererLike;
  /** Optional pre-built scene/camera; defaults are created if omitted. */
  scene?: THREE.Scene;
  camera?: THREE.PerspectiveCamera;
  /** Frame scheduler. Defaults to the real rAF; tests inject a manual one. */
  scheduler?: FrameScheduler;
  /** Upper bound on per-frame dt (seconds). Guards against the giant dt a
   *  backgrounded tab produces, which would otherwise tunnel physics. */
  maxDt?: number;
}

const DEFAULT_MAX_DT = 1 / 15; // 66ms — never step more than this in one frame.

function defaultScheduler(): FrameScheduler {
  // Fall back to a setTimeout shim where rAF is unavailable (e.g. some tests).
  const raf =
    typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) =>
          setTimeout(() => cb(performance.now()), 16) as unknown as number;
  const caf =
    typeof cancelAnimationFrame === "function"
      ? cancelAnimationFrame
      : (id: number) => clearTimeout(id);
  return { request: (cb) => raf(cb), cancel: (id) => caf(id) };
}

/**
 * Engine — owns the Three.js scene graph, the active camera, the renderer and
 * the single rAF render loop. It is deliberately a plain injectable class (no
 * singleton, no module-global): `GameCanvas` constructs one per mount and
 * disposes it on unmount, and tests construct one with stubs.
 *
 * Game behaviour lives in `System`s registered via `addSystem`; the Engine just
 * sequences them. The same `tick` powers both the live loop and `advanceTime`,
 * so what the Playwright harness steps deterministically is exactly what runs.
 */
export class Engine {
  readonly scene: THREE.Scene;
  /** Mutable so a camera system (Epic 3) can install its own rig camera. */
  camera: THREE.PerspectiveCamera;

  private readonly renderer: RendererLike;
  private readonly scheduler: FrameScheduler;
  private readonly maxDt: number;

  private systems: System[] = [];
  private elapsed = 0;
  private running = false;
  private rafId: number | null = null;
  private lastTimeMs: number | null = null;
  private width = 1;
  private height = 1;

  // Exponential moving average of frame time, for a stable fps read-out.
  private emaFrameMs = 1000 / 60;

  constructor(opts: EngineOptions) {
    this.renderer = opts.renderer;
    this.scheduler = opts.scheduler ?? defaultScheduler();
    this.maxDt = opts.maxDt ?? DEFAULT_MAX_DT;
    this.scene = opts.scene ?? new THREE.Scene();
    this.camera =
      opts.camera ?? new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
  }

  /** Register a system. Returns an unregister fn that also disposes it. */
  addSystem(system: System): () => void {
    this.systems.push(system);
    return () => {
      const i = this.systems.indexOf(system);
      if (i !== -1) {
        this.systems.splice(i, 1);
        system.dispose?.();
      }
    };
  }

  getSystem(id: string): System | undefined {
    return this.systems.find((s) => s.id === id);
  }

  /** Resize the drawing buffer and keep the camera aspect correct. */
  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  /** Begin the live render loop (idempotent). */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTimeMs = null;
    const loop = (timeMs: number) => {
      if (!this.running) return;
      if (this.lastTimeMs === null) this.lastTimeMs = timeMs;
      const dt = (timeMs - this.lastTimeMs) / 1000;
      this.lastTimeMs = timeMs;
      this.tick(dt);
      this.rafId = this.scheduler.request(loop);
    };
    this.rafId = this.scheduler.request(loop);
  }

  /** Pause the live loop (idempotent). Systems and GPU state are retained. */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.rafId !== null) {
      this.scheduler.cancel(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Advance the world by `ms` milliseconds and render once. Deterministic: it
   * subdivides into fixed sub-steps so a large jump produces the same result
   * regardless of frame pacing. This is the hook the Playwright harness calls.
   */
  advanceTime(ms: number): void {
    let remaining = Math.max(0, ms) / 1000;
    const step = this.maxDt;
    // Guard against an absurd request looping forever.
    let guard = 0;
    while (remaining > 1e-6 && guard < 10000) {
      const dt = Math.min(step, remaining);
      this.tick(dt, /* render */ false);
      remaining -= dt;
      guard++;
    }
    this.render();
  }

  /** One simulation step: clamp dt, update fps, advance every system, render. */
  private tick(rawDt: number, render = true): void {
    const dt = Math.min(Math.max(rawDt, 0), this.maxDt);
    this.elapsed += dt;
    if (dt > 0) {
      // EMA smoothing (~0.1 weight) keeps the fps read-out from flickering.
      this.emaFrameMs += (dt * 1000 - this.emaFrameMs) * 0.1;
    }
    const ctx: FrameContext = {
      scene: this.scene,
      camera: this.camera,
      dt,
      elapsed: this.elapsed,
    };
    for (const system of this.systems) system.update(ctx);
    if (render) this.render();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Serialisable snapshot for `render_game_to_text` and debugging. */
  getState(): EngineState {
    const systems: Record<string, Record<string, unknown>> = {};
    for (const s of this.systems) {
      if (s.describe) systems[s.id] = s.describe();
    }
    const info = this.renderer.info?.render;
    return {
      running: this.running,
      elapsed: round(this.elapsed),
      fps: round(1000 / Math.max(this.emaFrameMs, 1e-6)),
      drawCalls: info?.calls ?? 0,
      triangles: info?.triangles ?? 0,
      systems,
    };
  }

  /** Tear everything down: stop the loop, dispose systems, free the renderer. */
  dispose(): void {
    this.stop();
    for (const s of this.systems) s.dispose?.();
    this.systems = [];
    this.renderer.dispose();
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
