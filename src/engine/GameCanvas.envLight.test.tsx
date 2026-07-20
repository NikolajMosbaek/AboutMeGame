import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { act, render } from "@testing-library/react";
import { QUALITY_TIERS } from "../perf/quality.ts";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import { createHudStore } from "../ui/hudStore.ts";
import { createSession } from "../gameSession.ts";
import { createSettingsStore } from "../settings/settingsStore.ts";
import type { GameHandle } from "./GameCanvas.tsx";

// The sky-driven env-light wiring contract (visual-overhaul slice 2): GameCanvas
// builds `EnvLightSystem` directly (like the compositor, it needs the real
// renderer `PMREMGenerator` requires) whenever the built game exposes
// `dayCycle`, passing the live renderer/scene/dayCycle/quality — and does
// nothing at all when a minimal build omits `dayCycle`. Proven against a SPY
// constructor so no real WebGL/PMREM ever runs.
vi.mock("./createRenderer.ts", () => ({
  createRenderer: () => rendererStub,
  applyRendererQuality: () => {},
}));

// Sibling to createRenderer: the bloom compositor builds WebGL-only
// postprocessing effects, reached through a dynamic import() (the lazy
// postfx chunk) on the medium/high tiers this file also exercises. Mocking it
// keeps this shell test WebGL/N8AO-free (mirrors GameCanvas.journal.test.tsx).
// Args are captured (visual-overhaul slice 5) so a test here can prove the
// built handle's `dayCycle` is forwarded through — the god-rays seam.
const compositorCtorArgs: unknown[][] = [];
vi.mock("./createCompositor.ts", () => ({
  createBloomCompositor: vi.fn((...args: unknown[]) => {
    compositorCtorArgs.push(args);
    return { render() {}, setSize() {}, dispose() {} };
  }),
}));

const rendererStub = { shadowMap: { enabled: false }, setPixelRatio() {} };

const envLightCtorArgs: unknown[][] = [];
const envLightInstance = { id: "envLight", update() {}, dispose() {} };
vi.mock("../world/envLightSystem.ts", () => ({
  EnvLightSystem: vi.fn((...args: unknown[]) => {
    envLightCtorArgs.push(args);
    return envLightInstance;
  }),
}));

const addSystem = vi.fn();
const engineStub = {
  resize() {},
  start() {},
  stop() {},
  advanceTime() {},
  renderFromView() {},
  setCompositor: vi.fn(),
  addSystem,
  getState: () => ({}),
  dispose() {},
};
vi.mock("./Engine.ts", () => ({
  Engine: vi.fn(() => engineStub),
}));

import { EnvLightSystem } from "../world/envLightSystem.ts";
import { GameCanvas } from "./GameCanvas.tsx";

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function forceQualitySetting(quality: "low" | "high") {
  localStorage.setItem("aboutmegame.settings.v1", JSON.stringify({ quality }));
}

const dayCycleAccessor = {
  getPhase: () => 0.25,
  getPalette: () => ({
    sunColor: [1, 1, 1] as const,
    sunIntensity: 1.6,
    sunElevation: 1,
    sunAzimuth: 0,
    domeTop: [0, 0, 1] as const,
    domeBottom: [1, 1, 1] as const,
    fogColor: [1, 1, 1] as const,
  }),
  getSunDirection: () => new THREE.Vector3(0, 1, 0),
};

const POIS = [{ id: "poi-alpha", order: 1, title: "Alpha" }];

/** A minimal but genuinely FUNCTIONING GameHandle (real stores, mirroring
 *  GameCanvas.journal.test.tsx's `makeHandle`), so the Hud/NavMarkers/
 *  RevealPanel shell — which mounts once `game` state is set — has real
 *  `subscribe`/`getSnapshot` stores to read instead of throwing. */
function makeHandle(withDayCycle: boolean): GameHandle {
  return {
    discovery: {
      store: createDiscoveryStore(POIS.length),
      pois: POIS,
      journalPois: POIS.map((p) => ({ ...p, teaser: "t", body: "b", color: 0xffffff })),
      reset() {},
      consumeInteract: () => false,
    },
    hud: createHudStore(),
    settings: createSettingsStore(),
    session: createSession(),
    dayCycle: withDayCycle ? dayCycleAccessor : undefined,
  };
}

describe("GameCanvas — EnvLightSystem wiring (visual-overhaul slice 2)", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    envLightCtorArgs.length = 0;
    compositorCtorArgs.length = 0;
    localStorage.clear();
  });

  it("builds EnvLightSystem against the live renderer/scene/dayCycle/quality and registers it", async () => {
    forceQualitySetting("high");
    const handle = makeHandle(true);

    render(<GameCanvas build={() => handle} showStats={false} />);
    await act(async () => {});

    expect(EnvLightSystem).toHaveBeenCalledTimes(1);
    const [renderer, scene, dayCycle, quality] = envLightCtorArgs[0] as [
      unknown,
      unknown,
      unknown,
      { dynamic: boolean },
    ];
    expect(renderer).toBe(rendererStub);
    expect(dayCycle).toBe(dayCycleAccessor);
    expect(quality.dynamic).toBe(QUALITY_TIERS.high.envDynamic);
    expect(scene).toBeDefined();
    expect(addSystem).toHaveBeenCalledWith(envLightInstance);
  });

  it("threads envDynamic:false on the low tier", async () => {
    forceQualitySetting("low");
    const handle = makeHandle(true);

    render(<GameCanvas build={() => handle} showStats={false} />);
    await act(async () => {});

    expect(EnvLightSystem).toHaveBeenCalledTimes(1);
    const [, , , quality] = envLightCtorArgs[0] as [unknown, unknown, unknown, { dynamic: boolean }];
    expect(quality.dynamic).toBe(false);
    expect(QUALITY_TIERS.low.envDynamic).toBe(false);
  });

  it("does NOT construct EnvLightSystem when the built handle has no dayCycle (minimal preview/test build)", async () => {
    forceQualitySetting("high");
    const handle = makeHandle(false);

    render(<GameCanvas build={() => handle} showStats={false} />);
    await act(async () => {});

    expect(EnvLightSystem).not.toHaveBeenCalled();
  });
});

describe("GameCanvas — god-rays sun-direction forwarding (visual-overhaul slice 5)", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    envLightCtorArgs.length = 0;
    compositorCtorArgs.length = 0;
    localStorage.clear();
  });

  it("forwards the built handle's dayCycle accessor to createBloomCompositor as the 5th arg", async () => {
    forceQualitySetting("high");
    const handle = makeHandle(true);

    render(<GameCanvas build={() => handle} showStats={false} />);
    await act(async () => {});

    expect(compositorCtorArgs).toHaveLength(1);
    const [renderer, , , quality, sunSource] = compositorCtorArgs[0] as [
      unknown,
      unknown,
      unknown,
      { tier: string },
      unknown,
    ];
    expect(renderer).toBe(rendererStub);
    expect(quality.tier).toBe("high");
    expect(sunSource).toBe(dayCycleAccessor);
  });

  it("passes undefined when the built handle has no dayCycle (minimal preview/test build)", async () => {
    forceQualitySetting("high");
    const handle = makeHandle(false);

    render(<GameCanvas build={() => handle} showStats={false} />);
    await act(async () => {});

    expect(compositorCtorArgs).toHaveLength(1);
    expect(compositorCtorArgs[0][4]).toBeUndefined();
  });
});
