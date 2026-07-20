import { describe, expect, it, vi } from "vitest";
import { AudioSystem, nearestWaterDistance } from "./AudioSystem.ts";
import type { AudioEngine } from "./AudioEngine.ts";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import type { FrameContext } from "../engine/types.ts";

// A fake AudioEngine: every public method is a spy, so the system's wiring can
// be asserted without real Web Audio.
function fakeEngine() {
  return {
    chime: vi.fn(),
    completion: vi.fn(),
    breathe: vi.fn(),
    footstep: vi.fn(),
    gulp: vi.fn(),
    bite: vi.fn(),
    hurtThud: vi.fn(),
    digThud: vi.fn(),
    snakeAlert: vi.fn(),
    growl: vi.fn(),
    fanfare: vi.fn(),
    deathSting: vi.fn(),
    birdChirp: vi.fn(),
    owlHoot: vi.fn(),
    startMusic: vi.fn(),
    stopMusic: vi.fn(),
    setAmbientPhase: vi.fn(),
    setRiverProximity: vi.fn(),
    squawkCascade: vi.fn(),
    monkeyChitter: vi.fn(),
    monkeyRaspberry: vi.fn(),
    jaguarYelp: vi.fn(),
    splashScatter: vi.fn(),
    setRainLevel: vi.fn(),
    thunder: vi.fn(),
    setMuted: vi.fn(),
    setVolume: vi.fn(),
    resume: vi.fn(),
    recoverIfInterrupted: vi.fn(),
    dispose: vi.fn(),
  } as unknown as AudioEngine & Record<string, ReturnType<typeof vi.fn>>;
}

const CTX = (dt = 0.016): FrameContext => ({ scene: {} as never, camera: {} as never, dt, elapsed: 0 });

function explorerSource(state: {
  x?: number;
  z?: number;
  speed?: number;
  sprinting?: boolean;
  wading?: boolean;
  mode?: "walk" | "swim";
}) {
  const s = {
    position: { x: state.x ?? 0, z: state.z ?? 0 },
    speed: state.speed ?? 0,
    sprinting: state.sprinting ?? false,
    wading: state.wading ?? false,
    mode: state.mode ?? "walk",
  };
  return { state: s };
}

function mutedSource(muted: boolean, volume = 1) {
  return { getSnapshot: () => ({ muted, volume }) };
}

function dayPhaseSource(phase: number) {
  return { getPhase: () => phase, set(p: number) {
    phase = p;
  } };
}

const NO_WATER = () => -1;

function survivalSource(snap: { thirst: number; health: number; alive: boolean; stamina?: number }) {
  const full = Object.assign(snap, { stamina: snap.stamina ?? 100 });
  return { getSnapshot: () => full };
}
function forageSource(snap: { eaten: number }) {
  return { getSnapshot: () => snap };
}
function questSource(snap: {
  digProgress: number | null;
  finaleActive: boolean;
  treasureFound: boolean;
}) {
  return { getSnapshot: () => snap };
}
function snakeSource(alert: boolean) {
  return { anyAlert: () => alert };
}
function jaguarSource(stalking: boolean) {
  return { isStalking: () => stalking, justStartled: () => false };
}

// A fully-neutral rig — nothing rises, nothing moves — for tests that only
// care about one seam.
function neutralArgs() {
  return {
    explorer: explorerSource({}),
    muted: mutedSource(false),
    dayPhase: dayPhaseSource(0.25),
    waterDepthAt: NO_WATER,
    survival: survivalSource({ thirst: 50, health: 100, alive: true, stamina: 100 }),
    forage: forageSource({ eaten: 0 }),
    quest: questSource({ digProgress: null, finaleActive: false, treasureFound: false }),
    snakes: snakeSource(false),
    jaguar: jaguarSource(false),
  };
}

function makeSystem(
  overrides: Partial<ReturnType<typeof neutralArgs>> = {},
  // Pass a pre-seeded store to model restored saved progress at mount.
  store = createDiscoveryStore(3),
) {
  const engine = fakeEngine();
  const args = { ...neutralArgs(), ...overrides };
  const sys = new AudioSystem(
    engine,
    store,
    args.explorer,
    args.muted,
    args.dayPhase,
    args.waterDepthAt,
    args.survival,
    args.forage,
    args.quest,
    args.snakes,
    args.jaguar,
  );
  return { engine, store, sys, args };
}

describe("nearestWaterDistance", () => {
  it("is 0 when the point itself is wet", () => {
    expect(nearestWaterDistance((x, z) => (x === 0 && z === 0 ? 1 : -1), 0, 0)).toBe(0);
  });

  it("finds the ring radius of the nearest wet point", () => {
    // Wet everywhere at distance 10 from the origin, dry elsewhere.
    const waterDepthAt = (x: number, z: number) => (Math.abs(Math.hypot(x, z) - 10) < 0.5 ? 1 : -1);
    expect(nearestWaterDistance(waterDepthAt, 0, 0)).toBe(10);
  });

  it("is Infinity when nothing within the outermost ring is wet", () => {
    expect(nearestWaterDistance(NO_WATER, 0, 0)).toBe(Infinity);
  });
});

describe("AudioSystem", () => {
  it("chimes once per new discovery, not for restored progress", () => {
    const seeded = createDiscoveryStore(3);
    seeded.setDiscovered(["a"]); // pre-existing saved progress before the system mounts
    const { engine, store, sys } = makeSystem({}, seeded);

    expect(engine.chime).not.toHaveBeenCalled(); // mount didn't re-chime saved progress
    store.setDiscovered(["a", "b"]); // a new find
    expect(engine.chime).toHaveBeenCalledTimes(1);
    store.setDiscovered(["a", "b", "c"]); // the final find completes the set —
    expect(engine.chime).toHaveBeenCalledTimes(1); // — the sting replaces the chime (S2)
    expect(engine.completion).toHaveBeenCalledTimes(1);
    store.setDiscovered(["a", "b", "c"]); // no change ⇒ no chime, no re-sting
    expect(engine.chime).toHaveBeenCalledTimes(1);
    expect(engine.completion).toHaveBeenCalledTimes(1);

    sys.dispose();
  });

  it("stings on the completed rising edge, replacing the ordinary chime on the final find (S2 #98)", () => {
    const { engine, store } = makeSystem(); // total = 3
    store.setDiscovered(["a"]);
    store.setDiscovered(["a", "b"]);
    expect(engine.chime).toHaveBeenCalledTimes(2);
    expect(engine.completion).not.toHaveBeenCalled();

    store.setDiscovered(["a", "b", "c"]); // the payoff moment
    expect(engine.completion).toHaveBeenCalledTimes(1);
    expect(engine.chime).toHaveBeenCalledTimes(2); // the sting IS the final find's sound

    store.setDiscovered(["a", "b", "c"]); // no change ⇒ no re-sting
    expect(engine.completion).toHaveBeenCalledTimes(1);
  });

  it("never re-stings a mount/reload already at full completion (S2 #98)", () => {
    const seeded = createDiscoveryStore(2);
    seeded.setDiscovered(["a", "b"]); // saved progress: already completed
    const { engine, store, sys } = makeSystem({}, seeded);

    expect(engine.completion).not.toHaveBeenCalled();
    store.setDiscovered(["a", "b"]); // a no-op write after mount
    expect(engine.completion).not.toHaveBeenCalled();
    sys.dispose();
  });

  it("fires a footstep immediately on the first moving frame, then paces by interval", () => {
    const explorer = explorerSource({ speed: 4 });
    const { engine, sys } = makeSystem({ explorer });

    sys.update(CTX(0.001)); // timer starts at 0 ⇒ the very first step lands now
    expect(engine.footstep).toHaveBeenCalledTimes(1);
    sys.update(CTX(0.2)); // well short of the walk interval
    expect(engine.footstep).toHaveBeenCalledTimes(1);
    sys.update(CTX(0.3)); // crosses it
    expect(engine.footstep).toHaveBeenCalledTimes(2);
  });

  it("paces sprinting footsteps faster than walking", () => {
    const runFor = (sprinting: boolean) => {
      const explorer = explorerSource({ speed: sprinting ? 7 : 4, sprinting });
      const { engine, sys } = makeSystem({ explorer });
      for (let i = 0; i < 18; i++) sys.update(CTX(0.05)); // 0.9s total, in small steps
      return (engine.footstep as ReturnType<typeof vi.fn>).mock.calls.length;
    };
    expect(runFor(true)).toBeGreaterThan(runFor(false));
  });

  it("passes the wading flag through to the footstep tone", () => {
    const dry = explorerSource({ speed: 4, wading: false });
    const wet = explorerSource({ speed: 4, wading: true });
    const dryRig = makeSystem({ explorer: dry });
    const wetRig = makeSystem({ explorer: wet });

    dryRig.sys.update(CTX(0.001));
    expect(dryRig.engine.footstep).toHaveBeenLastCalledWith(false);
    wetRig.sys.update(CTX(0.001));
    expect(wetRig.engine.footstep).toHaveBeenLastCalledWith(true);
  });

  it("plays no footsteps while stopped", () => {
    const explorer = explorerSource({ speed: 0 });
    const { engine, sys } = makeSystem({ explorer });
    for (let i = 0; i < 50; i++) sys.update(CTX(0.1));
    expect(engine.footstep).not.toHaveBeenCalled();
  });

  it("plays no footsteps while swimming, even at cruise speed", () => {
    // Swim speed clears the footstep floor, but strokes are not footsteps.
    const explorer = explorerSource({ speed: 2.6, mode: "swim" });
    const { engine, sys } = makeSystem({ explorer });
    for (let i = 0; i < 20; i++) sys.update(CTX(0.1)); // 2s of swimming
    expect(engine.footstep).not.toHaveBeenCalled();
  });

  it("fires the breathing cue on the sprint rising edge only", () => {
    const explorer = explorerSource({ sprinting: false });
    const { engine, sys } = makeSystem({ explorer });

    sys.update(CTX());
    expect(engine.breathe).not.toHaveBeenCalled();
    explorer.state.sprinting = true;
    sys.update(CTX());
    expect(engine.breathe).toHaveBeenCalledTimes(1);
    sys.update(CTX()); // held — no re-fire
    expect(engine.breathe).toHaveBeenCalledTimes(1);
    explorer.state.sprinting = false;
    sys.update(CTX());
    explorer.state.sprinting = true;
    sys.update(CTX());
    expect(engine.breathe).toHaveBeenCalledTimes(2);
  });

  it("starts the ambient bed once on the first frame", () => {
    const { engine, sys } = makeSystem();
    sys.update(CTX());
    sys.update(CTX());
    expect(engine.startMusic).toHaveBeenCalledTimes(1);
  });

  it("drives the day/night bed crossfade from the world's day phase every frame", () => {
    const dayPhase = dayPhaseSource(0.25);
    const { engine, sys } = makeSystem({ dayPhase });
    sys.update(CTX());
    expect(engine.setAmbientPhase).toHaveBeenLastCalledWith(0.25);
    dayPhase.set(0.75);
    sys.update(CTX());
    expect(engine.setAmbientPhase).toHaveBeenLastCalledWith(0.75);
  });

  it("drives the river layer from distance to the nearest wet point", () => {
    // Wet right at the player's feet ⇒ full proximity (1).
    const explorer = explorerSource({ x: 0, z: 0 });
    const wet = () => 1;
    const { engine, sys } = makeSystem({ explorer, waterDepthAt: wet });
    sys.update(CTX());
    expect(engine.setRiverProximity).toHaveBeenLastCalledWith(1);
  });

  it("silences the river layer beyond the silence distance", () => {
    const explorer = explorerSource({ x: 0, z: 0 });
    const { engine, sys } = makeSystem({ explorer, waterDepthAt: NO_WATER });
    sys.update(CTX());
    expect(engine.setRiverProximity).toHaveBeenLastCalledWith(0);
  });

  it("asks the engine to recover an interrupted context every frame (S4 #107)", () => {
    const { engine, sys } = makeSystem();
    sys.update(CTX());
    sys.update(CTX());
    expect(engine.recoverIfInterrupted).toHaveBeenCalledTimes(2);
  });

  it("keeps the engine mute synced to the live setting each frame", () => {
    let muted = false;
    const muteSrc = { getSnapshot: () => ({ muted, volume: 1 }) };
    const { engine, sys } = makeSystem({ muted: muteSrc });

    expect(engine.setMuted).toHaveBeenLastCalledWith(false); // applied at construction
    muted = true;
    sys.update(CTX());
    expect(engine.setMuted).toHaveBeenLastCalledWith(true);
  });

  it("keeps the engine volume synced to the live setting each frame", () => {
    let volume = 1;
    const src = { getSnapshot: () => ({ muted: false, volume }) };
    const { engine, sys } = makeSystem({ muted: src });

    expect(engine.setVolume).toHaveBeenLastCalledWith(1); // applied at construction
    volume = 0.3;
    sys.update(CTX());
    expect(engine.setVolume).toHaveBeenLastCalledWith(0.3);
  });

  it("fires drink/eat/hurt/death exactly once per edge", () => {
    const survival = survivalSource({ thirst: 50, health: 100, alive: true });
    const forage = forageSource({ eaten: 0 });
    const { engine, sys } = makeSystem({ survival, forage });

    sys.update(CTX());
    expect(engine.gulp).not.toHaveBeenCalled();
    survival.getSnapshot().thirst = 60; // drink
    sys.update(CTX());
    expect(engine.gulp).toHaveBeenCalledTimes(1);
    sys.update(CTX()); // no further rise ⇒ no re-fire
    expect(engine.gulp).toHaveBeenCalledTimes(1);

    forage.getSnapshot().eaten = 1; // eat
    sys.update(CTX());
    expect(engine.bite).toHaveBeenCalledTimes(1);

    survival.getSnapshot().health = 90; // sharp drop (>5)
    sys.update(CTX());
    expect(engine.hurtThud).toHaveBeenCalledTimes(1);

    survival.getSnapshot().health = 88; // small further drain ⇒ no thud
    sys.update(CTX());
    expect(engine.hurtThud).toHaveBeenCalledTimes(1);

    survival.getSnapshot().alive = false; // death
    sys.update(CTX());
    expect(engine.deathSting).toHaveBeenCalledTimes(1);
    sys.update(CTX()); // still dead ⇒ no re-fire
    expect(engine.deathSting).toHaveBeenCalledTimes(1);
  });

  it("does not gulp on the respawn refill (thirst jumps up as alive flips true)", () => {
    const survival = survivalSource({ thirst: 10, health: 100, alive: true });
    const { engine, sys } = makeSystem({ survival });
    sys.update(CTX());

    survival.getSnapshot().alive = false; // death
    sys.update(CTX());
    expect(engine.gulp).not.toHaveBeenCalled();

    // Wake: thirst refills to 75 in the same frame alive flips back true — a
    // respawn, not a drink, so no gulp.
    survival.getSnapshot().alive = true;
    survival.getSnapshot().thirst = 75;
    sys.update(CTX());
    expect(engine.gulp).not.toHaveBeenCalled();

    // A genuine post-respawn drink still gulps.
    survival.getSnapshot().thirst = 95;
    sys.update(CTX());
    expect(engine.gulp).toHaveBeenCalledTimes(1);
  });

  it("fires the fanfare at finale START, not again when treasureFound lands at its end", () => {
    const quest = questSource({ digProgress: null, finaleActive: false, treasureFound: false });
    const { engine, sys } = makeSystem({ quest });

    sys.update(CTX());
    expect(engine.fanfare).not.toHaveBeenCalled();

    // Dig completes ⇒ the finale begins — the fanfare lands HERE, with the
    // motes and the startled birds, not 4.5 s later behind the panel.
    quest.getSnapshot().finaleActive = true;
    sys.update(CTX());
    expect(engine.fanfare).toHaveBeenCalledTimes(1);

    // Finale ends: treasureFound flips as finaleActive drops — same
    // celebration, no second fanfare.
    quest.getSnapshot().finaleActive = false;
    quest.getSnapshot().treasureFound = true;
    sys.update(CTX());
    sys.update(CTX());
    expect(engine.fanfare).toHaveBeenCalledTimes(1);
  });

  it("thuds each dig third exactly once and fanfares once on treasure found", () => {
    const quest = questSource({ digProgress: null, finaleActive: false, treasureFound: false });
    const { engine, sys } = makeSystem({ quest });

    sys.update(CTX());
    expect(engine.digThud).not.toHaveBeenCalled();

    quest.getSnapshot().digProgress = 0.1;
    sys.update(CTX());
    expect(engine.digThud).not.toHaveBeenCalled(); // still in the first third

    quest.getSnapshot().digProgress = 0.35;
    sys.update(CTX());
    expect(engine.digThud).toHaveBeenCalledTimes(1);
    sys.update(CTX()); // held in the same third ⇒ no re-fire
    expect(engine.digThud).toHaveBeenCalledTimes(1);

    quest.getSnapshot().digProgress = 0.7;
    sys.update(CTX());
    expect(engine.digThud).toHaveBeenCalledTimes(2);

    quest.getSnapshot().digProgress = null; // cancelled — resets the baseline
    sys.update(CTX());
    quest.getSnapshot().digProgress = 0.4;
    sys.update(CTX());
    expect(engine.digThud).toHaveBeenCalledTimes(3);

    quest.getSnapshot().treasureFound = true;
    sys.update(CTX());
    expect(engine.fanfare).toHaveBeenCalledTimes(1);
    sys.update(CTX());
    expect(engine.fanfare).toHaveBeenCalledTimes(1);
  });

  it("growls once on the jaguar's stalk rising edge, and again for a fresh stalk", () => {
    let stalking = false;
    const jaguar = { isStalking: () => stalking, justStartled: () => false };
    const { engine, sys } = makeSystem({ jaguar });

    sys.update(CTX());
    expect(engine.growl).not.toHaveBeenCalled();

    stalking = true; // the jaguar commits — the warning IS the mechanic
    sys.update(CTX());
    expect(engine.growl).toHaveBeenCalledTimes(1);
    sys.update(CTX()); // held stalk ⇒ no re-fire
    expect(engine.growl).toHaveBeenCalledTimes(1);

    stalking = false; // broke off (camp, water, distance)
    sys.update(CTX());
    stalking = true; // a new hunt, a new warning
    sys.update(CTX());
    expect(engine.growl).toHaveBeenCalledTimes(2);
  });

  it("rattles once on the snake-alert rising edge", () => {
    let alert = false;
    const snakes = { anyAlert: () => alert };
    const { engine, sys } = makeSystem({ snakes });

    sys.update(CTX());
    expect(engine.snakeAlert).not.toHaveBeenCalled();
    alert = true;
    sys.update(CTX());
    expect(engine.snakeAlert).toHaveBeenCalledTimes(1);
    sys.update(CTX()); // held — no re-fire
    expect(engine.snakeAlert).toHaveBeenCalledTimes(1);
    alert = false;
    sys.update(CTX());
    alert = true;
    sys.update(CTX());
    expect(engine.snakeAlert).toHaveBeenCalledTimes(2);
  });

  it("pants on a cadence while exhausted and moving; stops on recovery or standing still (E1 #234)", () => {
    const survival = survivalSource({ thirst: 50, health: 100, alive: true, stamina: 5 });
    const explorer = explorerSource({ speed: 4 });
    const { engine, sys } = makeSystem({ survival, explorer });
    for (let t = 0; t < 3.5; t += 0.1) sys.update(CTX(0.1));
    // Rising-edge breath count over 3.5 s of exhausted movement: ≥2 pants.
    expect((engine.breathe as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
    const before = (engine.breathe as ReturnType<typeof vi.fn>).mock.calls.length;
    survival.getSnapshot().stamina = 100; // recovered
    for (let t = 0; t < 3.5; t += 0.1) sys.update(CTX(0.1));
    expect((engine.breathe as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
    sys.dispose();
  });

  it("plays each comedy one-shot exactly once per drained edge (J1 #221)", () => {
    let startled = true;
    let flushed = true;
    let scattered = true;
    let stole = true;
    let taunted = true;
    const engine = fakeEngine();
    const store = createDiscoveryStore(3);
    const args = neutralArgs();
    const sys = new AudioSystem(
      engine,
      store,
      args.explorer,
      args.muted,
      args.dayPhase,
      args.waterDepthAt,
      args.survival,
      args.forage,
      args.quest,
      args.snakes,
      { isStalking: () => false, justStartled: () => { const e = startled; startled = false; return e; } },
      { justFlushed: () => { const e = flushed; flushed = false; return e; } },
      { justScattered: () => { const e = scattered; scattered = false; return e; } },
      {
        justStole: () => { const e = stole; stole = false; return e; },
        justTaunted: () => { const e = taunted; taunted = false; return e; },
      },
    );

    sys.update(CTX());
    sys.update(CTX()); // edges drained — nothing may re-fire
    expect(engine.jaguarYelp).toHaveBeenCalledTimes(1);
    expect(engine.squawkCascade).toHaveBeenCalledTimes(1);
    expect(engine.splashScatter).toHaveBeenCalledTimes(1);
    expect(engine.monkeyChitter).toHaveBeenCalledTimes(1);
    expect(engine.monkeyRaspberry).toHaveBeenCalledTimes(1);
    sys.dispose();
  });

  it("drives the rain bed from the weather snapshot and rumbles once per thunder edge (W1 #228)", () => {
    let thundered = true;
    const engine = fakeEngine();
    const store = createDiscoveryStore(3);
    const args = neutralArgs();
    const sys = new AudioSystem(
      engine,
      store,
      args.explorer,
      args.muted,
      args.dayPhase,
      args.waterDepthAt,
      args.survival,
      args.forage,
      args.quest,
      args.snakes,
      { isStalking: () => false, justStartled: () => false },
      undefined,
      undefined,
      undefined,
      {
        snapshot: () => ({ rain01: 0.7 }),
        justThundered: () => { const e = thundered; thundered = false; return e; },
      },
    );
    sys.update(CTX());
    sys.update(CTX());
    expect(engine.setRainLevel).toHaveBeenLastCalledWith(0.7);
    expect(engine.thunder).toHaveBeenCalledTimes(1);
    sys.dispose();
  });

  it("stays silent on the comedy seams when the reactive sources are absent", () => {
    const { engine, sys } = makeSystem();
    sys.update(CTX());
    expect(engine.jaguarYelp).not.toHaveBeenCalled();
    expect(engine.squawkCascade).not.toHaveBeenCalled();
    sys.dispose();
  });

  it("disposes the engine and unsubscribes from the store", () => {
    const { engine, store, sys } = makeSystem();
    sys.dispose();
    expect(engine.dispose).toHaveBeenCalled();
    // After dispose, a discovery change must not chime.
    store.setDiscovered(["a"]);
    expect(engine.chime).not.toHaveBeenCalled();
  });
});
