import { describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./AudioEngine.ts";
import type {
  AudioContextLike,
  BiquadFilterNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
} from "./AudioEngine.ts";

// A fake Web Audio context that records every node it hands out and every
// connection made, so we can assert the engine's graph without real audio
// (jsdom has no `AudioContext`). Each node is a vi.fn-backed stub.

function fakeParam() {
  return {
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  };
}

function fakeContext() {
  const oscillators: OscillatorNodeLike[] = [];
  const gains: GainNodeLike[] = [];
  const filters: BiquadFilterNodeLike[] = [];
  const connections: Array<[unknown, unknown]> = [];

  // Mix the connect/disconnect spies INTO `node` (not a spread copy) so the
  // object stored in `connections` is the same reference the engine holds.
  const withNode = <T extends object>(node: T): T => {
    Object.assign(node, {
      connect: vi.fn((target: unknown) => connections.push([node, target])),
      disconnect: vi.fn(),
    });
    return node;
  };

  let state = "suspended";
  const ctx: AudioContextLike = {
    currentTime: 0,
    destination: withNode({}) as unknown as AudioContextLike["destination"],
    get state() {
      return state;
    },
    createGain() {
      const g = withNode({ gain: fakeParam() }) as unknown as GainNodeLike;
      gains.push(g);
      return g;
    },
    createOscillator() {
      const o = withNode({
        type: "sine",
        frequency: fakeParam(),
        detune: fakeParam(),
        start: vi.fn(),
        stop: vi.fn(),
      }) as unknown as OscillatorNodeLike;
      oscillators.push(o);
      return o;
    },
    createBiquadFilter() {
      const f = withNode({
        type: "lowpass",
        frequency: fakeParam(),
        Q: fakeParam(),
      }) as unknown as BiquadFilterNodeLike;
      filters.push(f);
      return f;
    },
    resume: vi.fn(async () => {
      state = "running";
    }),
    suspend: vi.fn(async () => {
      state = "suspended";
    }),
    close: vi.fn(async () => {
      state = "closed";
    }),
  };
  return { ctx, oscillators, gains, filters, connections };
}

describe("AudioEngine", () => {
  it("resumes the context on construction (autoplay unlock)", () => {
    const { ctx } = fakeContext();
    new AudioEngine(() => ctx);
    expect(ctx.resume).toHaveBeenCalled();
  });

  it("connects a master gain to the destination at full volume", () => {
    const { ctx, gains, connections } = fakeContext();
    new AudioEngine(() => ctx);
    // First gain created is the master.
    const master = gains[0];
    expect(master.gain.value).toBeGreaterThan(0);
    // Reference check (not deep equal) — the nodes hold circular spies.
    expect(connections.some(([from, to]) => from === master && to === ctx.destination)).toBe(true);
  });

  it("creates and starts oscillators when a chime plays", () => {
    const { ctx, oscillators } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.chime();
    // The chime is two blips ⇒ two oscillators, each started + stopped.
    expect(oscillators.length).toBe(2);
    for (const o of oscillators) {
      expect(o.start).toHaveBeenCalled();
      expect(o.stop).toHaveBeenCalled();
    }
  });

  it("plays whoosh and boost as one-shot voices", () => {
    const { ctx, oscillators } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.whoosh();
    engine.boost();
    expect(oscillators.length).toBe(2);
    for (const o of oscillators) expect(o.start).toHaveBeenCalled();
  });

  it("does not synthesise SFX while muted", () => {
    const { ctx, oscillators } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.setMuted(true);
    engine.chime();
    engine.whoosh();
    engine.boost();
    expect(oscillators.length).toBe(0);
  });

  it("zeroes the master gain and suspends when muted", () => {
    const { ctx, gains } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    const master = gains[0];
    engine.setMuted(true);
    // Ramps the master toward zero.
    expect(master.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, expect.any(Number));
    expect(ctx.suspend).toHaveBeenCalled();
  });

  it("ramps the master back up and resumes when unmuted", () => {
    const { ctx, gains } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    const master = gains[0];
    engine.setMuted(true);
    (ctx.resume as ReturnType<typeof vi.fn>).mockClear();
    engine.setMuted(false);
    const ramps = (master.gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>).mock.calls;
    expect(ramps.some(([v]) => v > 0)).toBe(true);
    expect(ctx.resume).toHaveBeenCalled();
  });

  it("starts a seamless ambient bed and is idempotent", () => {
    const { ctx, oscillators } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.startMusic();
    const afterFirst = oscillators.length;
    expect(afterFirst).toBeGreaterThanOrEqual(3); // root + fifth + LFO
    for (const o of oscillators) expect(o.start).toHaveBeenCalled();
    engine.startMusic(); // no-op while playing
    expect(oscillators.length).toBe(afterFirst);
  });

  it("stops the ambient voices on stopMusic", () => {
    const { ctx, oscillators } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.startMusic();
    engine.stopMusic();
    for (const o of oscillators) expect(o.stop).toHaveBeenCalled();
  });

  it("tears down on dispose: stops music, disconnects master, closes the context", () => {
    const { ctx, gains, oscillators } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.startMusic();
    engine.dispose();
    const master = gains[0];
    expect(master.disconnect).toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
    for (const o of oscillators) expect(o.stop).toHaveBeenCalled();
  });

  it("does not play after dispose", () => {
    const { ctx, oscillators } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.dispose();
    const before = oscillators.length;
    engine.chime();
    expect(oscillators.length).toBe(before);
  });
});
