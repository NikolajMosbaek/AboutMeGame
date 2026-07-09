import { describe, expect, it, vi } from "vitest";
import { AudioSystem } from "./AudioSystem.ts";
import type { AudioEngine } from "./AudioEngine.ts";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import type { FrameContext } from "../engine/types.ts";

// A fake AudioEngine: every public method is a spy, so the system's wiring can
// be asserted without real Web Audio.
function fakeEngine() {
  return {
    chime: vi.fn(),
    boost: vi.fn(),
    startMusic: vi.fn(),
    stopMusic: vi.fn(),
    setMuted: vi.fn(),
    resume: vi.fn(),
    dispose: vi.fn(),
  } as unknown as AudioEngine & {
    chime: ReturnType<typeof vi.fn>;
    boost: ReturnType<typeof vi.fn>;
    startMusic: ReturnType<typeof vi.fn>;
    setMuted: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  };
}

const CTX: FrameContext = { scene: {} as never, camera: {} as never, dt: 0.016, elapsed: 0 };

function sprintSource(sprint: boolean) {
  return { state: { sprint } };
}
function mutedSource(muted: boolean) {
  return { getSnapshot: () => ({ muted }) };
}

describe("AudioSystem", () => {
  it("chimes once per new discovery, not for restored progress", () => {
    const engine = fakeEngine();
    const store = createDiscoveryStore(3);
    store.setDiscovered(["a"]); // pre-existing saved progress before the system mounts
    const sys = new AudioSystem(engine, store, sprintSource(false), mutedSource(false));

    expect(engine.chime).not.toHaveBeenCalled(); // mount didn't re-chime saved progress
    store.setDiscovered(["a", "b"]); // a new find
    expect(engine.chime).toHaveBeenCalledTimes(1);
    store.setDiscovered(["a", "b", "c"]); // another
    expect(engine.chime).toHaveBeenCalledTimes(2);
    store.setDiscovered(["a", "b", "c"]); // no change ⇒ no chime
    expect(engine.chime).toHaveBeenCalledTimes(2);

    sys.dispose();
  });

  it("fires the sprint cue on the rising edge only", () => {
    const engine = fakeEngine();
    const store = createDiscoveryStore(3);
    const sprint = sprintSource(false);
    const sys = new AudioSystem(engine, store, sprint, mutedSource(false));

    sys.update(CTX);
    expect(engine.boost).not.toHaveBeenCalled();
    sprint.state.sprint = true;
    sys.update(CTX);
    expect(engine.boost).toHaveBeenCalledTimes(1);
    sys.update(CTX); // held — no re-fire
    expect(engine.boost).toHaveBeenCalledTimes(1);
    sprint.state.sprint = false;
    sys.update(CTX);
    sprint.state.sprint = true;
    sys.update(CTX);
    expect(engine.boost).toHaveBeenCalledTimes(2);
  });

  it("starts the ambient bed once on the first frame", () => {
    const engine = fakeEngine();
    const store = createDiscoveryStore(3);
    const sys = new AudioSystem(engine, store, sprintSource(false), mutedSource(false));
    sys.update(CTX);
    sys.update(CTX);
    expect(engine.startMusic).toHaveBeenCalledTimes(1);
  });

  it("keeps the engine mute synced to the live setting each frame", () => {
    const engine = fakeEngine();
    const store = createDiscoveryStore(3);
    let muted = false;
    const muteSrc = { getSnapshot: () => ({ muted }) };
    const sys = new AudioSystem(engine, store, sprintSource(false), muteSrc);

    expect(engine.setMuted).toHaveBeenLastCalledWith(false); // applied at construction
    muted = true;
    sys.update(CTX);
    expect(engine.setMuted).toHaveBeenLastCalledWith(true);
  });

  it("disposes the engine and unsubscribes from the store", () => {
    const engine = fakeEngine();
    const store = createDiscoveryStore(3);
    const sys = new AudioSystem(engine, store, sprintSource(false), mutedSource(false));
    sys.dispose();
    expect(engine.dispose).toHaveBeenCalled();
    // After dispose, a discovery change must not chime.
    store.setDiscovered(["a"]);
    expect(engine.chime).not.toHaveBeenCalled();
  });
});
