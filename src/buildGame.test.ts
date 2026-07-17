import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { Engine } from "./engine/Engine.ts";
import { buildGame } from "./buildGame.ts";
import type { RendererLike } from "./engine/types.ts";
import type { AudioContextLike } from "./audio/AudioEngine.ts";

// A bare renderer stub (jsdom has no WebGL). buildGame constructs the real world
// + movement + discovery against it, so this exercises the whole composition.
function stubRenderer(): RendererLike {
  return {
    render: vi.fn(),
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    dispose: vi.fn(),
    info: { render: { calls: 0, triangles: 0 } },
  };
}

// A minimal fake AudioContext: every node is a self-referential stub, enough for
// the AudioEngine to build its graph and for us to assert close() on teardown.
function fakeCtx(): { ctx: AudioContextLike; close: ReturnType<typeof vi.fn> } {
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  const close = vi.fn(async () => {});
  const ctx = {
    currentTime: 0,
    destination: node(),
    state: "running",
    createGain: () => ({ ...node(), gain: param() }),
    createOscillator: () => ({
      ...node(),
      type: "sine",
      frequency: param(),
      detune: param(),
      start: vi.fn(),
      stop: vi.fn(),
    }),
    createBiquadFilter: () => ({ ...node(), type: "lowpass", frequency: param(), Q: param() }),
    resume: vi.fn(async () => {}),
    suspend: vi.fn(async () => {}),
    close,
  } as unknown as AudioContextLike;
  return { ctx, close };
}

function makeEngineAndOverlay() {
  const engine = new Engine({ renderer: stubRenderer() });
  const overlay = document.createElement("div");
  return { engine, overlay };
}

describe("buildGame audio/fx wiring", () => {
  it("registers the discovery-burst FX system regardless of audio", () => {
    const { engine, overlay } = makeEngineAndOverlay();
    buildGame(engine, overlay, undefined, undefined);
    expect(engine.getSystem("fx-burst")).toBeDefined();
    engine.dispose();
  });

  it("registers the audio system when a context factory is provided", () => {
    const { engine, overlay } = makeEngineAndOverlay();
    const { ctx } = fakeCtx();
    buildGame(engine, overlay, undefined, () => ctx);
    expect(engine.getSystem("audio")).toBeDefined();
    expect(engine.getSystem("audio-resume")).toBeDefined();
    engine.dispose();
  });

  it("skips audio entirely when no context factory is available", () => {
    const { engine, overlay } = makeEngineAndOverlay();
    buildGame(engine, overlay, undefined, undefined);
    expect(engine.getSystem("audio")).toBeUndefined();
    expect(engine.getSystem("audio-resume")).toBeUndefined();
    engine.dispose();
  });

  it("closes the audio context when the engine is disposed", () => {
    const { engine, overlay } = makeEngineAndOverlay();
    const { ctx, close } = fakeCtx();
    buildGame(engine, overlay, undefined, () => ctx);
    engine.dispose();
    expect(close).toHaveBeenCalled();
  });

  it("adds the discovery-burst Points object to the scene", () => {
    const { engine, overlay } = makeEngineAndOverlay();
    buildGame(engine, overlay, undefined, undefined);
    const burst = engine.scene.children.find(
      (o) => o instanceof THREE.Points && o.name === "discovery-burst",
    );
    expect(burst).toBeDefined();
    engine.dispose();
  });
});

describe("buildGame audio survival net (S4)", () => {
  // jsdom has no real media pipeline — stub play/pause so the silent unlock
  // element can be driven without "Not implemented" noise.
  const stubMedia = () => {
    const play = vi
      .spyOn(window.HTMLMediaElement.prototype, "play")
      .mockImplementation(async () => {});
    const pause = vi
      .spyOn(window.HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    return { play, pause };
  };

  it("keeps resuming on every gesture — the net is persistent, not one-shot (#105)", () => {
    const { engine, overlay } = makeEngineAndOverlay();
    const { ctx } = fakeCtx();
    const { play, pause } = stubMedia();
    buildGame(engine, overlay, undefined, () => ctx);
    (ctx.resume as ReturnType<typeof vi.fn>).mockClear();

    window.dispatchEvent(new Event("pointerdown"));
    window.dispatchEvent(new Event("pointerdown"));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    expect(ctx.resume).toHaveBeenCalledTimes(3);

    engine.dispose();
    play.mockRestore();
    pause.mockRestore();
  });

  it("resumes when the tab becomes visible again (#105)", () => {
    const { engine, overlay } = makeEngineAndOverlay();
    const { ctx } = fakeCtx();
    const { play, pause } = stubMedia();
    buildGame(engine, overlay, undefined, () => ctx);
    (ctx.resume as ReturnType<typeof vi.fn>).mockClear();

    // jsdom's visibilityState is "visible" — the event exercises the
    // foreground branch of the handler.
    document.dispatchEvent(new Event("visibilitychange"));
    expect(ctx.resume).toHaveBeenCalledTimes(1);

    engine.dispose();
    play.mockRestore();
    pause.mockRestore();
  });

  it("mounts a looping silent unlock element and plays it on the first gesture (#106)", () => {
    const { engine, overlay } = makeEngineAndOverlay();
    const { ctx } = fakeCtx();
    const { play, pause } = stubMedia();
    buildGame(engine, overlay, undefined, () => ctx);

    const el = overlay.querySelector<HTMLAudioElement>("audio[data-silent-unlock]");
    expect(el).not.toBeNull();
    expect(el?.loop).toBe(true);
    // 0 download bytes: the loop is an inline data-URI, not a fetched asset.
    expect(el?.src.startsWith("data:audio/wav;base64,")).toBe(true);
    // No autoplay before a gesture.
    expect(play).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pointerdown"));
    expect(play).toHaveBeenCalled();

    engine.dispose();
    play.mockRestore();
    pause.mockRestore();
  });

  it("skips the unlock element when no audio is wired (headless)", () => {
    const { engine, overlay } = makeEngineAndOverlay();
    buildGame(engine, overlay, undefined, undefined);
    expect(overlay.querySelector("audio[data-silent-unlock]")).toBeNull();
    engine.dispose();
  });

  it("tears the whole net down on dispose: listeners unbound, element gone (#105/#106)", () => {
    const { engine, overlay } = makeEngineAndOverlay();
    const { ctx } = fakeCtx();
    const { play, pause } = stubMedia();
    buildGame(engine, overlay, undefined, () => ctx);

    engine.dispose();
    expect(overlay.querySelector("audio[data-silent-unlock]")).toBeNull();

    (ctx.resume as ReturnType<typeof vi.fn>).mockClear();
    window.dispatchEvent(new Event("pointerdown"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(ctx.resume).not.toHaveBeenCalled();

    play.mockRestore();
    pause.mockRestore();
  });
});

describe("buildGame discovery.journalPois seam", () => {
  it("exposes a position-free journalPois projection of all 6 sites, while pois keeps position", () => {
    const { engine, overlay } = makeEngineAndOverlay();
    const game = buildGame(engine, overlay, undefined, undefined);

    const { journalPois, pois } = game.discovery;

    // All 6 sites, in the same order as the position-bearing array.
    expect(journalPois).toHaveLength(6);
    expect(pois).toHaveLength(6);
    expect(journalPois.map((p) => p.id)).toEqual(pois.map((p) => p.id));

    for (const entry of journalPois) {
      // Carries the React-facing content + color.
      expect(typeof entry.id).toBe("string");
      expect(typeof entry.order).toBe("number");
      expect(typeof entry.title).toBe("string");
      expect(typeof entry.teaser).toBe("string");
      expect(typeof entry.body).toBe("string");
      expect(typeof entry.color).toBe("number");
      // NO THREE.Vector3 leaks into the React-facing shape.
      expect("position" in entry).toBe(false);
    }

    // The position-bearing array still carries the THREE.Vector3 NavSystem reads.
    for (const poi of pois) {
      expect(poi.position).toBeInstanceOf(THREE.Vector3);
    }

    engine.dispose();
  });
});

describe("buildGame discovery.consumeInteract seam", () => {
  it("drains the queued interact edge: returns true once then false", () => {
    const { engine, overlay } = makeEngineAndOverlay();
    const game = buildGame(engine, overlay, undefined, undefined);

    // Simulate an Enter keydown — input.ts sets interactQueued on the edge.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    // The handle drains the SAME edge DiscoverySystem.update would consume.
    expect(game.discovery.consumeInteract()).toBe(true);
    expect(game.discovery.consumeInteract()).toBe(false);

    engine.dispose();
  });
});

describe("buildGame input seam (mobile-controls upgrade)", () => {
  it("game.input.pressInteract() queues the same edge discovery.consumeInteract() drains", () => {
    const { engine, overlay } = makeEngineAndOverlay();
    const game = buildGame(engine, overlay, undefined, undefined);

    game.input.pressInteract();
    expect(game.discovery.consumeInteract()).toBe(true);
    expect(game.discovery.consumeInteract()).toBe(false);

    engine.dispose();
  });

  it("game.input.touchActive mirrors the player input controller's live signal", () => {
    const { engine, overlay } = makeEngineAndOverlay();
    const game = buildGame(engine, overlay, undefined, undefined);

    expect(game.input.touchActive).toBe(game.player.input.touchActive);

    engine.dispose();
  });
});
