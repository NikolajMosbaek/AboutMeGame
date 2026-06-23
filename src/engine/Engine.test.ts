import { describe, expect, it, vi } from "vitest";
import { Engine, type EngineOptions } from "./Engine.ts";
import type { FrameContext, FrameScheduler, RendererLike, System } from "./types.ts";

/** A renderer that records how often it drew, with no WebGL involved. */
function stubRenderer() {
  const render = vi.fn();
  const renderer: RendererLike = {
    render,
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    dispose: vi.fn(),
    info: { render: { calls: 7, triangles: 1234 } },
  };
  return { renderer, render };
}

/** A scheduler the test flushes by hand, so frames are fully deterministic. */
function manualScheduler() {
  const cbs = new Map<number, (t: number) => void>();
  let nextId = 0;
  const scheduler: FrameScheduler = {
    request: (cb) => {
      const id = ++nextId;
      cbs.set(id, cb);
      return id;
    },
    cancel: (id) => {
      cbs.delete(id);
    },
  };
  return {
    scheduler,
    /** Fire all pending callbacks once at simulated time `t` ms. */
    flush(t: number) {
      const pending = [...cbs.values()];
      cbs.clear();
      for (const cb of pending) cb(t);
    },
    get pending() {
      return cbs.size;
    },
  };
}

class RecordingSystem implements System {
  readonly id: string;
  readonly dts: number[] = [];
  disposed = false;
  constructor(id = "rec") {
    this.id = id;
  }
  update(ctx: FrameContext): void {
    this.dts.push(ctx.dt);
  }
  describe(): Record<string, unknown> {
    return { ticks: this.dts.length };
  }
  dispose(): void {
    this.disposed = true;
  }
  get total(): number {
    return this.dts.reduce((a, b) => a + b, 0);
  }
}

function makeEngine(extra: Partial<EngineOptions> = {}) {
  const { renderer, render } = stubRenderer();
  const sched = manualScheduler();
  const engine = new Engine({ renderer, scheduler: sched.scheduler, ...extra });
  return { engine, render, sched, renderer };
}

describe("Engine", () => {
  it("advanceTime steps systems deterministically and renders once", () => {
    const { engine, render } = makeEngine();
    const sys = new RecordingSystem();
    engine.addSystem(sys);

    engine.advanceTime(1000); // 1.0s

    // Sum of clamped sub-steps equals the requested duration exactly.
    expect(sys.total).toBeCloseTo(1.0, 5);
    // Subdivided into maxDt-sized steps (default 1/15s ⇒ 15 steps).
    expect(sys.dts.length).toBe(15);
    // No sub-step exceeds the clamp.
    expect(Math.max(...sys.dts)).toBeLessThanOrEqual(1 / 15 + 1e-9);
    // Rendered exactly once at the end, not per sub-step.
    expect(render).toHaveBeenCalledTimes(1);
    expect(engine.getState().elapsed).toBeCloseTo(1.0, 2);
  });

  it("clamps a huge frame dt (e.g. a backgrounded tab) to maxDt", () => {
    const { engine, sched } = makeEngine({ maxDt: 0.1 });
    const sys = new RecordingSystem();
    engine.addSystem(sys);
    engine.start();

    sched.flush(0); // first frame: lastTime set, dt = 0
    sched.flush(5000); // 5s gap — must be clamped, not passed through

    expect(sys.dts[0]).toBe(0);
    expect(sys.dts[1]).toBeCloseTo(0.1, 6);
  });

  it("getState reports running, fps, renderer info and each system's describe()", () => {
    const { engine } = makeEngine();
    const sys = new RecordingSystem("worldA");
    engine.addSystem(sys);
    engine.advanceTime(100);

    const state = engine.getState();
    expect(state.drawCalls).toBe(7);
    expect(state.triangles).toBe(1234);
    expect(state.fps).toBeGreaterThan(0);
    expect(state.systems.worldA).toEqual({ ticks: expect.any(Number) });
  });

  it("resize updates the renderer size and camera aspect", () => {
    const { engine, renderer } = makeEngine();
    engine.resize(800, 400);
    expect(renderer.setSize).toHaveBeenCalledWith(800, 400, false);
    expect(engine.camera.aspect).toBeCloseTo(2, 5);
  });

  it("start is idempotent and stop halts the loop", () => {
    const { engine, sched } = makeEngine();
    const sys = new RecordingSystem();
    engine.addSystem(sys);
    engine.start();
    engine.start(); // second call must not double-schedule
    expect(sched.pending).toBe(1);

    sched.flush(0);
    sched.flush(16);
    const after = sys.dts.length;
    engine.stop();
    sched.flush(32); // nothing pending ⇒ no further ticks
    expect(sys.dts.length).toBe(after);
  });

  it("addSystem returns an unregister that removes and disposes the system", () => {
    const { engine } = makeEngine();
    const sys = new RecordingSystem();
    const remove = engine.addSystem(sys);
    expect(engine.getSystem("rec")).toBe(sys);
    remove();
    expect(engine.getSystem("rec")).toBeUndefined();
    expect(sys.disposed).toBe(true);
  });

  it("dispose stops the loop, disposes systems and the renderer", () => {
    const { engine, renderer } = makeEngine();
    const sys = new RecordingSystem();
    engine.addSystem(sys);
    engine.start();
    engine.dispose();
    expect(sys.disposed).toBe(true);
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });

  describe("injected compositor render delegate", () => {
    function stubCompositor() {
      return {
        render: vi.fn(),
        setSize: vi.fn(),
        dispose: vi.fn(),
      };
    }

    it("routes rendering through compositor.render, never renderer.render", () => {
      const compositor = stubCompositor();
      const { engine, render } = makeEngine({ compositor });
      const sys = new RecordingSystem();
      engine.addSystem(sys);

      engine.advanceTime(1000); // renders once at the end

      expect(compositor.render).toHaveBeenCalledTimes(1);
      expect(compositor.render).toHaveBeenCalledWith(engine.scene, engine.camera);
      // The plain renderer path is bypassed entirely on the compositor path.
      expect(render).not.toHaveBeenCalled();
    });

    it("routes live-loop frames through compositor.render too", () => {
      const compositor = stubCompositor();
      const { engine, render, sched } = makeEngine({ compositor });
      const sys = new RecordingSystem();
      engine.addSystem(sys);
      engine.start();

      sched.flush(0); // first frame: dt = 0 but still renders
      sched.flush(16);

      expect(compositor.render).toHaveBeenCalled();
      expect(compositor.render).toHaveBeenLastCalledWith(engine.scene, engine.camera);
      expect(render).not.toHaveBeenCalled();
    });

    it("resize calls compositor.setSize(width,height) AFTER renderer.setSize", () => {
      const compositor = stubCompositor();
      const { engine, renderer } = makeEngine({ compositor });
      const order: string[] = [];
      (renderer.setSize as ReturnType<typeof vi.fn>).mockImplementation(() => {
        order.push("renderer.setSize");
      });
      compositor.setSize.mockImplementation(() => {
        order.push("compositor.setSize");
      });

      engine.resize(800, 400);

      expect(renderer.setSize).toHaveBeenCalledWith(800, 400, false);
      expect(compositor.setSize).toHaveBeenCalledWith(800, 400);
      // The compositor must propagate size only after the renderer/camera resize.
      expect(order).toEqual(["renderer.setSize", "compositor.setSize"]);
      expect(engine.camera.aspect).toBeCloseTo(2, 5);
    });

    it("dispose calls compositor.dispose BEFORE renderer.dispose", () => {
      const compositor = stubCompositor();
      const { engine, renderer } = makeEngine({ compositor });
      const order: string[] = [];
      compositor.dispose.mockImplementation(() => {
        order.push("compositor.dispose");
      });
      (renderer.dispose as ReturnType<typeof vi.fn>).mockImplementation(() => {
        order.push("renderer.dispose");
      });

      engine.dispose();

      expect(compositor.dispose).toHaveBeenCalledOnce();
      expect(renderer.dispose).toHaveBeenCalledOnce();
      expect(order).toEqual(["compositor.dispose", "renderer.dispose"]);
    });

    it("with NO compositor injected, the existing renderer path is unchanged", () => {
      const { engine, render, renderer } = makeEngine(); // no compositor
      const sys = new RecordingSystem();
      engine.addSystem(sys);

      engine.advanceTime(1000);
      expect(render).toHaveBeenCalledTimes(1);
      expect(render).toHaveBeenCalledWith(engine.scene, engine.camera);

      engine.resize(640, 480);
      expect(renderer.setSize).toHaveBeenCalledWith(640, 480, false);

      engine.dispose();
      expect(renderer.dispose).toHaveBeenCalledOnce();
    });
  });
});
