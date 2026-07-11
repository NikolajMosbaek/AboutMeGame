import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import type { CompositorLoader } from "./GameCanvas.tsx";
import type { Compositor } from "./createCompositor.ts";
import { QUALITY_TIERS } from "../perf/quality.ts";

// The lazy-compositor gating contract (visual-overhaul slice 1, review
// finding): the postprocessing module is a LAZY chunk loaded through the
// injectable `loadCompositor` seam, and only the bloom (medium/high) tiers may
// ever request it — the low tier must never download a byte of it. This file
// proves the gate, the attach handshake and the unmount race against a SPY
// loader, so no dynamic import (and no WebGL) ever actually runs; the real
// chunk split is asserted by the build (`vite.config.ts`'s `postfx` bucket)
// and exercised end-to-end by `npm run verify`.
vi.mock("./createRenderer.ts", () => ({
  createRenderer: () => rendererStub,
  applyRendererQuality: () => {},
}));

const rendererStub = { shadowMap: { enabled: false }, setPixelRatio() {} };

const engineStub = {
  resize() {},
  start() {},
  stop() {},
  advanceTime() {},
  renderFromView() {},
  setCompositor: vi.fn(),
  getState: () => ({}),
  dispose() {},
};
vi.mock("./Engine.ts", () => ({
  Engine: vi.fn(() => engineStub),
}));

import { Engine } from "./Engine.ts";
import { GameCanvas } from "./GameCanvas.tsx";

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

/** Persist a forced quality setting the way the pause menu would, so
 *  GameCanvas's own `resolveQuality(createSettingsStore()...)` resolves the
 *  tier under test — no store internals are reached around. */
function forceQualitySetting(quality: "low" | "high") {
  localStorage.setItem("aboutmegame.settings.v1", JSON.stringify({ quality }));
}

/** A controllable loader: resolves with a spy `createBloomCompositor` factory
 *  only when the test says so, so the unmount race is steerable. */
function deferredLoader() {
  const compositor: Compositor = { render() {}, setSize() {}, dispose() {} };
  const createBloomCompositor = vi.fn(() => compositor);
  let resolve!: () => void;
  const gate = new Promise<void>((r) => (resolve = r));
  const loader: CompositorLoader = vi.fn(async () => {
    await gate;
    return { createBloomCompositor: createBloomCompositor as never };
  });
  return { loader, resolve, createBloomCompositor, compositor };
}

function mountCanvas(loader: CompositorLoader) {
  return render(<GameCanvas build={() => {}} loadCompositor={loader} showStats={false} />);
}

describe("GameCanvas — lazy compositor tier gate", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("LOW tier: never requests the postprocessing module at all", async () => {
    forceQualitySetting("low");
    const { loader, resolve, createBloomCompositor } = deferredLoader();

    mountCanvas(loader);
    resolve(); // even a ready-to-resolve loader must not have been asked
    await act(async () => {});

    expect(loader).not.toHaveBeenCalled();
    expect(createBloomCompositor).not.toHaveBeenCalled();
    expect(engineStub.setCompositor).not.toHaveBeenCalled();
    // And the Engine was constructed bare — no compositor option either.
    const opts = vi.mocked(Engine).mock.calls[0][0];
    expect(opts.compositor).toBeUndefined();
  });

  it("HIGH tier: loads, builds against the live renderer/scene/camera/quality, attaches", async () => {
    forceQualitySetting("high");
    const { loader, resolve, createBloomCompositor, compositor } = deferredLoader();

    mountCanvas(loader);
    expect(loader).toHaveBeenCalledTimes(1); // requested at mount, not lazily-on-render

    // The engine runs bare until the chunk arrives…
    expect(engineStub.setCompositor).not.toHaveBeenCalled();

    await act(async () => resolve());

    // …then the factory is invoked with the SAME renderer + scene + camera the
    // Engine renders with, the resolved tier config, and (visual-overhaul
    // slice 5) the built handle's `dayCycle` — `undefined` here since this
    // test's `build` returns void — and the result is attached through the
    // Engine's late seam (which sizes it; Engine.test.ts pins that half of
    // the handshake).
    const engineOpts = vi.mocked(Engine).mock.calls[0][0];
    expect(createBloomCompositor).toHaveBeenCalledTimes(1);
    expect(createBloomCompositor).toHaveBeenCalledWith(
      rendererStub,
      engineOpts.scene,
      engineOpts.camera,
      QUALITY_TIERS.high,
      undefined,
    );
    expect(engineStub.setCompositor).toHaveBeenCalledTimes(1);
    expect(engineStub.setCompositor).toHaveBeenCalledWith(compositor);
  });

  it("unmount before the chunk resolves: nothing is built, attached, or thrown", async () => {
    forceQualitySetting("high");
    const { loader, resolve, createBloomCompositor } = deferredLoader();

    const { unmount } = mountCanvas(loader);
    expect(loader).toHaveBeenCalledTimes(1);

    unmount(); // the world is gone before the network delivered the chunk
    await act(async () => resolve());

    // The guarded then-block bails before construction, so there is no orphan
    // compositor to leak and no attach onto a disposed engine.
    expect(createBloomCompositor).not.toHaveBeenCalled();
    expect(engineStub.setCompositor).not.toHaveBeenCalled();
  });
});
