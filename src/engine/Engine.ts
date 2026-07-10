import * as THREE from "three";
import type {
  EngineState,
  FrameContext,
  FrameScheduler,
  RenderDelegate,
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
  /** Optional render delegate that presents the frame instead of the bare
   *  renderer — the seam the post-processing compositor (bloom) plugs into.
   *  When present, `render()` calls `compositor.render`, `resize()` forwards to
   *  `compositor.setSize`, and `dispose()` calls `compositor.dispose`. Omitted on
   *  the plain (low-quality / test) path, which uses `renderer.render` directly.
   *  Can also be attached later via {@link Engine.setCompositor} — the lazy
   *  post-processing chunk arrives after mount on the bloom tiers. Injected,
   *  never constructed here — keeps the postprocessing library out of Engine. */
  compositor?: RenderDelegate;
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
  /** When set, owns presenting the frame (post-processing). Undefined ⇒ the
   *  Engine presents directly via `renderer.render`. Mutable: on the bloom
   *  tiers the compositor arrives via `setCompositor` once its lazy chunk
   *  loads, a few frames after the loop starts. */
  private compositor?: RenderDelegate;
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
    this.compositor = opts.compositor;
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

  /**
   * Attach (or replace) the render delegate after construction — the seam the
   * LAZY post-processing compositor lands on. On the bloom (medium/high) tiers
   * `GameCanvas` renders bare-renderer frames while the `postprocessing` chunk
   * downloads, then attaches the built compositor here; from the next frame,
   * presentation routes through it. The newcomer is immediately sized to the
   * current drawing dimensions so it never renders a stale-sized first frame
   * (resizes that happened while the chunk was in flight would otherwise be
   * lost). Replacing an existing delegate disposes the old one first.
   */
  setCompositor(compositor: RenderDelegate): void {
    if (this.compositor === compositor) return;
    this.compositor?.dispose();
    this.compositor = compositor;
    compositor.setSize(this.width, this.height);
  }

  /** Resize the drawing buffer and keep the camera aspect correct. */
  resize(width: number, height: number): void {
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    // Propagate to the compositor AFTER the renderer/camera so it can resize its
    // composer buffers (and re-apply any per-tier bloom-buffer override) against
    // the now-current drawing-buffer dimensions.
    this.compositor?.setSize(this.width, this.height);
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
    // If a live loop is running, force the next frame to recompute dt from
    // scratch (dt=0) rather than charging it the wall-clock gap that elapsed
    // during this synchronous burst. Keeps live + harness stepping decoupled.
    this.lastTimeMs = null;
  }

  /**
   * Place the camera at `eye` looking at `target` and present ONE frame, without
   * ticking any system. The live loop is halted first, so the framed view
   * persists — a camera-following system (Epic 3's `CameraRigSystem`) can't
   * overwrite it before the screenshot is taken. This is a pure
   * verification/automation seam (the develop-web-game convention, like
   * `advanceTime`): the Playwright smoke verifier calls it to frame each landmark
   * deterministically. It changes no simulation state — it only re-aims the
   * camera and renders — and adds no per-frame cost, since it runs only when the
   * harness invokes it.
   */
  renderFromView(eye: [number, number, number], target: [number, number, number]): void {
    this.stop();
    this.camera.position.set(eye[0], eye[1], eye[2]);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(target[0], target[1], target[2]);
    this.camera.updateProjectionMatrix();
    this.render();
  }

  /** One simulation step: clamp dt, update fps, advance every system, render. */
  private tick(rawDt: number, render = true): void {
    const dt = Math.min(Math.max(rawDt, 0), this.maxDt);
    this.elapsed += dt;
    // Only live frames (render=true) feed the fps read-out. The deterministic
    // `advanceTime` sub-steps (render=false) use synthetic maxDt-sized dts that
    // would otherwise drag the displayed fps down to ~1/maxDt.
    if (dt > 0 && render) {
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
    // The compositor (when injected) owns presenting the frame — it runs the
    // post-processing chain and presents. Otherwise the renderer presents directly.
    if (this.compositor) {
      this.compositor.render(this.scene, this.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
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
    // Free the compositor's GPU targets before the renderer it draws into.
    this.compositor?.dispose();
    this.renderer.dispose();
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
