import { describe, expect, it, vi } from "vitest";
import { AudioSystem } from "./AudioSystem.ts";
import type { AudioEngine } from "./AudioEngine.ts";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import type { FrameContext } from "../engine/types.ts";
import type { DriveMode } from "../movement/vehicle.ts";

// A fake AudioEngine: every public method is a spy, so the system's wiring can
// be asserted without real Web Audio.
function fakeEngine() {
  return {
    chime: vi.fn(),
    whoosh: vi.fn(),
    boost: vi.fn(),
    startMusic: vi.fn(),
    stopMusic: vi.fn(),
    setMuted: vi.fn(),
    resume: vi.fn(),
    dispose: vi.fn(),
  } as unknown as AudioEngine & {
    chime: ReturnType<typeof vi.fn>;
    whoosh: ReturnType<typeof vi.fn>;
    boost: ReturnType<typeof vi.fn>;
    startMusic: ReturnType<typeof vi.fn>;
    setMuted: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
}

const CTX: FrameContext = { scene: {} as never, camera: {} as never, dt: 0.016, elapsed: 0 };

function modeSource(mode: DriveMode) {
  return { state: { mode } };
}
function boostSource(boost: boolean) {
  return { state: { boost } };
}
function mutedSource(muted: boolean) {
  return { getSnapshot: () => ({ muted }) };
}

describe("AudioSystem", () => {
  it("chimes once per new discovery, not for restored progress", () => {
    const engine = fakeEngine();
    const store = createDiscoveryStore(3);
    store.setDiscovered(["a"]); // pre-existing saved progress before the system mounts
    const sys = new AudioSystem(engine, store, modeSource("drive"), boostSource(false), mutedSource(false));

    expect(engine.chime).not.toHaveBeenCalled(); // mount didn't re-chime saved progress
    store.setDiscovered(["a", "b"]); // a new find
    expect(engine.chime).toHaveBeenCalledTimes(1);
    store.setDiscovered(["a", "b", "c"]); // another
    expect(engine.chime).toHaveBeenCalledTimes(2);
    store.setDiscovered(["a", "b", "c"]); // no change ⇒ no chime
    expect(engine.chime).toHaveBeenCalledTimes(2);

    sys.dispose();
  });

  it("whooshes on a mode change but not on the first frame", () => {
    const engine = fakeEngine();
    const store = createDiscoveryStore(3);
    const mode = modeSource("drive");
    const sys = new AudioSystem(engine, store, mode, boostSource(false), mutedSource(false));

    sys.update(CTX); // first observation — no whoosh
    expect(engine.whoosh).not.toHaveBeenCalled();
    mode.state.mode = "fly";
    sys.update(CTX);
    expect(engine.whoosh).toHaveBeenCalledTimes(1);
    sys.update(CTX); // unchanged
    expect(engine.whoosh).toHaveBeenCalledTimes(1);
    mode.state.mode = "drive";
    sys.update(CTX);
    expect(engine.whoosh).toHaveBeenCalledTimes(2);
  });

  it("fires the boost cue on the rising edge only", () => {
    const engine = fakeEngine();
    const store = createDiscoveryStore(3);
    const boost = boostSource(false);
    const sys = new AudioSystem(engine, store, modeSource("drive"), boost, mutedSource(false));

    sys.update(CTX);
    expect(engine.boost).not.toHaveBeenCalled();
    boost.state.boost = true;
    sys.update(CTX);
    expect(engine.boost).toHaveBeenCalledTimes(1);
    sys.update(CTX); // held — no re-fire
    expect(engine.boost).toHaveBeenCalledTimes(1);
    boost.state.boost = false;
    sys.update(CTX);
    boost.state.boost = true;
    sys.update(CTX);
    expect(engine.boost).toHaveBeenCalledTimes(2);
  });

  it("starts the ambient bed once on the first frame", () => {
    const engine = fakeEngine();
    const store = createDiscoveryStore(3);
    const sys = new AudioSystem(engine, store, modeSource("drive"), boostSource(false), mutedSource(false));
    sys.update(CTX);
    sys.update(CTX);
    expect(engine.startMusic).toHaveBeenCalledTimes(1);
  });

  it("keeps the engine mute synced to the live setting each frame", () => {
    const engine = fakeEngine();
    const store = createDiscoveryStore(3);
    let muted = false;
    const muteSrc = { getSnapshot: () => ({ muted }) };
    const sys = new AudioSystem(engine, store, modeSource("drive"), boostSource(false), muteSrc);

    expect(engine.setMuted).toHaveBeenLastCalledWith(false); // applied at construction
    muted = true;
    sys.update(CTX);
    expect(engine.setMuted).toHaveBeenLastCalledWith(true);
  });

  it("disposes the engine and unsubscribes from the store", () => {
    const engine = fakeEngine();
    const store = createDiscoveryStore(3);
    const sys = new AudioSystem(engine, store, modeSource("drive"), boostSource(false), mutedSource(false));
    sys.dispose();
    expect(engine.dispose).toHaveBeenCalled();
    // After dispose, a discovery change must not chime.
    store.setDiscovered(["a"]);
    expect(engine.chime).not.toHaveBeenCalled();
  });
});
