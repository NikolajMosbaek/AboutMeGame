import { afterEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../engine/Engine.ts";
import type { RendererLike, System } from "../engine/types.ts";
import { QUALITY_TIERS } from "../perf/quality.ts";

// Spy the ShadowFrustumSystem constructor (mirrors buildWorld.dayCycle.test.ts's
// DayCycleSystem spy) so we can assert HOW buildWorld constructs it — the real
// sun handle plus the resolved tier's shadowMapSize — while still exercising
// the real registration path.
const ctorArgs: unknown[][] = [];
vi.mock("./shadowFrustumSystem.ts", async (importActual) => {
  const actual = await importActual<typeof import("./shadowFrustumSystem.ts")>();
  return {
    ...actual,
    ShadowFrustumSystem: class extends actual.ShadowFrustumSystem {
      constructor(...args: ConstructorParameters<typeof actual.ShadowFrustumSystem>) {
        ctorArgs.push(args);
        super(...args);
      }
    },
  };
});

const { buildWorld } = await import("./buildWorld.ts");

function stubRenderer(): RendererLike {
  return {
    render: vi.fn(),
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    dispose: vi.fn(),
    info: { render: { calls: 0, triangles: 0 } },
  };
}

function addedSystems(engine: Engine): System[] {
  const added: System[] = [];
  const real = engine.addSystem.bind(engine);
  vi.spyOn(engine, "addSystem").mockImplementation((s) => {
    added.push(s);
    return real(s);
  });
  return added;
}

describe("buildWorld → ShadowFrustumSystem registration (visual-overhaul slice 2)", () => {
  afterEach(() => {
    ctorArgs.length = 0;
    vi.restoreAllMocks();
  });

  it("registers exactly one 'shadowFrustum' system on tiers with shadows on (medium/high)", () => {
    const engine = new Engine({ renderer: stubRenderer() });
    const added = addedSystems(engine);
    const world = buildWorld(engine, QUALITY_TIERS.high);

    const shadowFrustum = added.filter((s) => s.id === "shadowFrustum");
    expect(shadowFrustum).toHaveLength(1);
    expect(engine.getSystem("shadowFrustum")).toBe(shadowFrustum[0]);

    expect(ctorArgs).toHaveLength(1);
    const [sun, sunDirection, config] = ctorArgs[0] as [
      unknown,
      { getSunDirection(): unknown },
      { halfExtent: number; mapSize: number },
    ];
    expect(sun).toBe(world.sky.sun);
    // The direction seam (review fix): must be the SAME live DayCycleSystem
    // instance backing `world.dayCycle`, not a re-derivation from the scene
    // graph — asserted structurally via the accessor it exposes.
    expect(typeof sunDirection.getSunDirection).toBe("function");
    expect(config.mapSize).toBe(QUALITY_TIERS.high.shadowMapSize);
    expect(config.halfExtent).toBeGreaterThanOrEqual(60);
    expect(config.halfExtent).toBeLessThanOrEqual(90);

    world.dispose();
    engine.dispose();
  });

  it("registers NO shadowFrustum system on the low tier (shadows off — nothing to sharpen)", () => {
    expect(QUALITY_TIERS.low.shadows).toBe(false);
    const engine = new Engine({ renderer: stubRenderer() });
    const added = addedSystems(engine);
    const world = buildWorld(engine, QUALITY_TIERS.low);

    expect(added.filter((s) => s.id === "shadowFrustum")).toHaveLength(0);
    expect(ctorArgs).toHaveLength(0);

    world.dispose();
    engine.dispose();
  });

  it("threads the resolved tier's shadowMapSize (medium vs high differ)", () => {
    const engineMedium = new Engine({ renderer: stubRenderer() });
    const worldMedium = buildWorld(engineMedium, QUALITY_TIERS.medium);
    const mediumConfig = ctorArgs[0][2] as { mapSize: number };
    expect(mediumConfig.mapSize).toBe(QUALITY_TIERS.medium.shadowMapSize);
    worldMedium.dispose();
    engineMedium.dispose();
    ctorArgs.length = 0;

    const engineHigh = new Engine({ renderer: stubRenderer() });
    const worldHigh = buildWorld(engineHigh, QUALITY_TIERS.high);
    const highConfig = ctorArgs[0][2] as { mapSize: number };
    expect(highConfig.mapSize).toBe(QUALITY_TIERS.high.shadowMapSize);
    worldHigh.dispose();
    engineHigh.dispose();
  });

  it("registers shadowFrustum immediately after the day cycle (visual-only, sky-adjacent order)", () => {
    const engine = new Engine({ renderer: stubRenderer() });
    const added = addedSystems(engine);
    const world = buildWorld(engine, QUALITY_TIERS.high);

    const ids = added.map((s) => s.id);
    const dayCycleIdx = ids.indexOf("dayCycle");
    const shadowFrustumIdx = ids.indexOf("shadowFrustum");
    expect(dayCycleIdx).toBeGreaterThanOrEqual(0);
    expect(shadowFrustumIdx).toBe(dayCycleIdx + 1);

    world.dispose();
    engine.dispose();
  });
});
