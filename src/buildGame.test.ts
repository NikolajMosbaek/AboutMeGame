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
