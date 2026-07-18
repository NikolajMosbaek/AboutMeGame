import { afterEach, describe, expect, it, vi } from "vitest";
import { Engine } from "../engine/Engine.ts";
import type { RendererLike, System } from "../engine/types.ts";
import { QUALITY_TIERS } from "../perf/quality.ts";

// Spy the DayCycleSystem constructor so we can assert HOW buildWorld constructs
// it (G3, T4): the three live sky handles passed INDIVIDUALLY (never the whole
// World/Sky) plus the same reduced-motion source the other systems get.
// importActual keeps the real class — we capture the ctor args and still build a
// genuine, registerable instance, so the "exactly one 'dayCycle' system" and
// "null fog does not throw" assertions exercise the real registration path.
const dayCycleCtorArgs: unknown[][] = [];
vi.mock("./dayCycleSystem.ts", async (importActual) => {
  const actual = await importActual<typeof import("./dayCycleSystem.ts")>();
  return {
    ...actual,
    DayCycleSystem: class extends actual.DayCycleSystem {
      constructor(...args: ConstructorParameters<typeof actual.DayCycleSystem>) {
        dayCycleCtorArgs.push(args);
        super(...args);
      }
    },
  };
});

const { buildWorld } = await import("./buildWorld.ts");

// jsdom has no WebGL — a bare renderer stub is all buildWorld needs.
function stubRenderer(): RendererLike {
  return {
    render: vi.fn(),
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    dispose: vi.fn(),
    info: { render: { calls: 0, triangles: 0 } },
  };
}

/** Every system added to the engine, in registration order, captured via a spy
 *  on `addSystem` (the real registration still happens — the spy only records). */
function addedSystems(engine: Engine): System[] {
  const added: System[] = [];
  const real = engine.addSystem.bind(engine);
  vi.spyOn(engine, "addSystem").mockImplementation((s) => {
    added.push(s);
    return real(s);
  });
  return added;
}

describe("buildWorld → DayCycleSystem registration (G3, T4)", () => {
  afterEach(() => {
    dayCycleCtorArgs.length = 0;
    vi.restoreAllMocks();
  });

  it("registers exactly one 'dayCycle' system on the HIGH tier, fed sky.sun/dome/fog", () => {
    const engine = new Engine({ renderer: stubRenderer() });
    const added = addedSystems(engine);
    const world = buildWorld(engine, QUALITY_TIERS.high);

    // Registered exactly once, and it is the single thing advancing the cycle.
    const dayCycle = added.filter((s) => s.id === "dayCycle");
    expect(dayCycle).toHaveLength(1);
    expect(engine.getSystem("dayCycle")).toBe(dayCycle[0]);

    // Constructed with the three LIVE handles passed individually — the real
    // sun/dome/fog objects the running scene reads, NOT the World or Sky wrapper.
    expect(dayCycleCtorArgs).toHaveLength(1);
    const [sun, dome, fog, reducedMotion] = dayCycleCtorArgs[0];
    expect(sun).toBe(world.sky.sun);
    expect(dome).toBe(world.sky.dome);
    expect(fog).toBe(world.sky.fog);
    // High tier draws fog, so the live handle is a real FogExp2, not null.
    expect(world.sky.fog).not.toBeNull();
    // The reduced-motion source is forwarded (here: none was passed to buildWorld).
    expect(reducedMotion).toBeUndefined();

    world.dispose();
    engine.dispose();
  });

  it("registers the 'dayCycle' system on the LOW tier too, with null fog, without throwing", () => {
    // Not tier-gated (unlike WaterSystem): the sun and dome exist on every tier,
    // and the fog handle is null on low (fog disabled) — the System null-guards it.
    expect(QUALITY_TIERS.low.fog).toBe(false);
    const engine = new Engine({ renderer: stubRenderer() });
    const added = addedSystems(engine);

    let world!: ReturnType<typeof buildWorld>;
    expect(() => {
      world = buildWorld(engine, QUALITY_TIERS.low);
    }).not.toThrow();

    const dayCycle = added.filter((s) => s.id === "dayCycle");
    expect(dayCycle).toHaveLength(1);

    // The fog handle handed to the System is null on low — the regression we
    // guard against is buildWorld passing a non-null fog or the ctor choking on null.
    const [sun, dome, fog] = dayCycleCtorArgs[0];
    expect(sun).toBe(world.sky.sun);
    expect(dome).toBe(world.sky.dome);
    expect(fog).toBeNull();
    expect(world.sky.fog).toBeNull();

    world.dispose();
    engine.dispose();
  });

  it("forwards the SAME reduced-motion source it received to the day cycle", () => {
    // The cycle pins to golden hour / holds when the player asks for less motion,
    // so it must read the exact same live source the beacon pulse and water do.
    const reducedMotion = { getSnapshot: () => ({ reducedMotion: true }) };
    const engine = new Engine({ renderer: stubRenderer() });
    const world = buildWorld(engine, QUALITY_TIERS.high, reducedMotion);

    expect(dayCycleCtorArgs).toHaveLength(1);
    expect(dayCycleCtorArgs[0][3]).toBe(reducedMotion);

    world.dispose();
    engine.dispose();
  });

  it("registers the day cycle immediately after the water clock on medium/high", () => {
    // Mirrors the BeaconPulseSystem placement contract: the cycle block sits right
    // after the WaterSystem block. On a tier with water, that means dayCycle is the
    // registration immediately following 'water'.
    const engine = new Engine({ renderer: stubRenderer() });
    const added = addedSystems(engine);
    const world = buildWorld(engine, QUALITY_TIERS.high);

    const ids = added.map((s) => s.id);
    const waterIdx = ids.indexOf("water");
    const dayCycleIdx = ids.indexOf("dayCycle");
    expect(waterIdx).toBeGreaterThanOrEqual(0);
    // W1 (#226): the cloud layer now registers between water and the day
    // cycle (its storm-dark knob must exist before WeatherSystem constructs).
    expect(dayCycleIdx).toBe(waterIdx + 2);
    expect(ids[waterIdx + 1]).toBe("clouds");

    world.dispose();
    engine.dispose();
  });
});
