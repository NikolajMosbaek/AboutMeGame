import { describe, expect, it, vi } from "vitest";
import { AudioEngine, nightAmount } from "./AudioEngine.ts";
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
    cancelScheduledValues: vi.fn(),
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
  const bufferSources: Array<Record<string, unknown>> = [];
  const ctx: AudioContextLike = {
    currentTime: 0,
    sampleRate: 8000,
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
    createBuffer(_ch: number, length: number) {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
    createBufferSource() {
      const src = withNode({
        buffer: null,
        loop: false,
        start: vi.fn(),
        stop: vi.fn(),
      });
      bufferSources.push(src as Record<string, unknown>);
      return src as never;
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
  // `setState` forces states the fake's own resume/suspend never produce —
  // Safari's non-standard "interrupted" during a call or backgrounding.
  const setState = (s: string) => {
    state = s;
  };
  return { ctx, oscillators, gains, filters, connections, setState, bufferSources };
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

  it.each([
    ["breathe", 1],
    ["footstep", 1],
    ["gulp", 2],
    ["bite", 2],
    ["hurtThud", 1],
    ["digThud", 1],
    ["snakeAlert", 5],
    ["fanfare", 4],
    ["completion", 7],
    ["squawkCascade", 5],
    ["monkeyChitter", 6],
    ["monkeyRaspberry", 3],
    ["jaguarYelp", 1],
    ["splashScatter", 4],
    ["deathSting", 3],
    ["birdChirp", 1],
    ["owlHoot", 2],
  ] as const)("plays %s as one-shot voice(s)", (method, voiceCount) => {
    const { ctx, oscillators } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    (engine[method] as (arg?: boolean) => void)(false);
    expect(oscillators.length).toBe(voiceCount);
    for (const o of oscillators) {
      expect(o.start).toHaveBeenCalled();
      expect(o.stop).toHaveBeenCalled();
    }
  });

  it("footstep uses a duller, longer-tailed tone while wading", () => {
    const { ctx, filters } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.footstep(false);
    const dryFreq = filters[0].frequency.value;
    engine.footstep(true);
    const wetFreq = filters[1].frequency.value;
    expect(wetFreq).toBeLessThan(dryFreq);
  });

  it("does not synthesise SFX while muted", () => {
    const { ctx, oscillators } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.setMuted(true);
    engine.chime();
    engine.breathe();
    engine.footstep(false);
    engine.completion();
    engine.squawkCascade();
    engine.monkeyChitter();
    engine.monkeyRaspberry();
    engine.jaguarYelp();
    engine.splashScatter();
    expect(oscillators.length).toBe(0);
  });

  it("ducks the ambient bed under the completion sting and restores it (S2 #97)", () => {
    const { ctx, gains } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.startMusic();
    const bedGain = gains[1]; // master is gains[0]
    (bedGain.gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>).mockClear();

    engine.completion();
    const ramps = (bedGain.gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>).mock.calls;
    // Dips well under the bed's level, then comes back up to it.
    expect(ramps.length).toBeGreaterThanOrEqual(2);
    const [duckLevel] = ramps[0];
    const [restoreLevel, restoreAt] = ramps.at(-1)!;
    expect(duckLevel).toBeLessThan(restoreLevel);
    // Restored only after the sting has finished (~1.2 s).
    expect(restoreAt).toBeGreaterThanOrEqual(1);
    // An in-flight day/night crossfade is cancelled first — a leftover ramp
    // event would un-duck mid-sting and then hard-step back down (a pop).
    expect(bedGain.gain.cancelScheduledValues).toHaveBeenCalled();
  });

  it("completion() works (and doesn't throw) before the bed has started", () => {
    const { ctx, oscillators } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    expect(() => engine.completion()).not.toThrow();
    expect(oscillators.length).toBe(7);
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

  it("setVolume scales the un-muted master gain toward the requested level", () => {
    const { ctx, gains } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    const master = gains[0];
    const full = master.gain.value; // MASTER_GAIN at volume 1
    engine.setVolume(0.5);
    const ramps = (master.gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>).mock.calls;
    const target = ramps.at(-1)![0];
    expect(target).toBeGreaterThan(0);
    expect(target).toBeCloseTo(full * 0.5, 5); // half the un-muted level
  });

  it("setVolume while muted does not raise the gain (mute owns it until unmute)", () => {
    const { ctx, gains } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    const master = gains[0];
    const full = master.gain.value; // MASTER_GAIN at volume 1
    engine.setMuted(true);
    (master.gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>).mockClear();
    engine.setVolume(0.5); // changes the stored volume, not the live (muted) gain
    expect(master.gain.linearRampToValueAtTime).not.toHaveBeenCalled();

    // On unmute, the gain ramps to the NEW (half) volume, not the old full level.
    engine.setMuted(false);
    const ramps = (master.gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>).mock.calls;
    expect(ramps.at(-1)![0]).toBeCloseTo(full * 0.5, 5);
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

  it("starts a seamless two-layer ambient bed and is idempotent", () => {
    const { ctx, oscillators } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.startMusic();
    const afterFirst = oscillators.length;
    expect(afterFirst).toBe(3); // insect A + insect B + river
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

  it("crossfades the insect bed's filter frequency and level with the day phase", () => {
    const { ctx, filters, gains } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.startMusic();
    const insectFilter = filters[0]; // insect filter created first, ahead of the river's
    const bedGain = gains[1]; // master is gains[0]
    engine.setAmbientPhase(0.25); // noon: full day
    engine.setAmbientPhase(0.75); // evening: full "night"
    const freqRamps = (insectFilter.frequency.linearRampToValueAtTime as ReturnType<typeof vi.fn>)
      .mock.calls;
    const gainRamps = (bedGain.gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>).mock
      .calls;
    // Night ramps to a lower frequency and a lower level than day.
    expect(freqRamps.at(-1)?.[0]).toBeLessThan(freqRamps[0][0]);
    expect(gainRamps.at(-1)?.[0]).toBeLessThan(gainRamps[0][0]);
  });

  it("does nothing on setAmbientPhase/setRiverProximity before the bed starts", () => {
    const { ctx } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    expect(() => engine.setAmbientPhase(0.5)).not.toThrow();
    expect(() => engine.setRiverProximity(1)).not.toThrow();
  });

  it("ramps the river layer's gain toward full at the bank, silent when far", () => {
    const { ctx, gains } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.startMusic();
    const riverGain = gains[2]; // master, bed gain, then river gain
    engine.setRiverProximity(1);
    const ramps = (riverGain.gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>).mock.calls;
    expect(ramps.at(-1)?.[0]).toBeGreaterThan(0);
    engine.setRiverProximity(0);
    const after = (riverGain.gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>).mock.calls;
    expect(after.at(-1)?.[0]).toBe(0);
  });

  it("skips redundant scheduling for a near-identical repeated call", () => {
    const { ctx, gains } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.startMusic();
    const riverGain = gains[2];
    engine.setRiverProximity(0.5);
    const before = (riverGain.gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>).mock.calls
      .length;
    engine.setRiverProximity(0.501); // negligible change
    expect(
      (riverGain.gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(before);
  });

  it("resume() skips an already-running context — every tap/key-repeat hits it (S4 #105)", () => {
    const { ctx, setState } = fakeContext();
    const engine = new AudioEngine(() => ctx); // constructor resume ⇒ fake is "running"
    (ctx.resume as ReturnType<typeof vi.fn>).mockClear();
    engine.resume();
    expect(ctx.resume).not.toHaveBeenCalled();
    setState("suspended");
    engine.resume();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("resume() is a no-op while muted — mute's suspend is deliberate (S4 #105)", () => {
    const { ctx } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.setMuted(true);
    (ctx.resume as ReturnType<typeof vi.fn>).mockClear();
    engine.resume();
    expect(ctx.resume).not.toHaveBeenCalled();
    engine.setMuted(false); // unmute still resumes (the deliberate path)
    expect(ctx.resume).toHaveBeenCalled();
  });

  it("recoverIfInterrupted() resumes only an interrupted context (S4 #107)", () => {
    const { ctx, setState } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    (ctx.resume as ReturnType<typeof vi.fn>).mockClear();

    engine.recoverIfInterrupted(); // running ⇒ nothing to do
    expect(ctx.resume).not.toHaveBeenCalled();

    setState("suspended"); // pre-gesture autoplay hold ⇒ leave it to the gesture net
    engine.recoverIfInterrupted();
    expect(ctx.resume).not.toHaveBeenCalled();

    setState("interrupted"); // a call / backgrounding took the hardware
    engine.recoverIfInterrupted();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });

  it("recoverIfInterrupted() leaves a muted engine suspended (S4 #107)", () => {
    const { ctx, setState } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.setMuted(true);
    setState("interrupted");
    (ctx.resume as ReturnType<typeof vi.fn>).mockClear();
    engine.recoverIfInterrupted();
    expect(ctx.resume).not.toHaveBeenCalled();
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

describe("rain bed + thunder (W1 #228)", () => {
  it("builds the 3-node rain chain lazily, ramps with the level, tears down at 0", () => {
    const { ctx, gains, bufferSources } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.setRainLevel(0); // dry: nothing built
    expect(bufferSources.length).toBe(0);

    engine.setRainLevel(0.6);
    expect(bufferSources.length).toBe(1); // looped noise source exists
    expect((bufferSources[0] as { loop: boolean }).loop).toBe(true);
    const rainGain = gains.at(-1)!;
    const ramps = (rainGain.gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>).mock.calls;
    expect(ramps.at(-1)?.[0]).toBeGreaterThan(0.01);

    engine.setRainLevel(0.6); // redundant level: no extra chain
    expect(bufferSources.length).toBe(1);

    engine.setRainLevel(0);
    expect((bufferSources[0] as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalled();
    engine.setRainLevel(0.5); // a NEW shower builds a NEW chain
    expect(bufferSources.length).toBe(2);
    engine.dispose();
  });

  it("thunder is a one-shot noise burst + sub oscillator, gated by mute", () => {
    const { ctx, oscillators, bufferSources } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.thunder();
    expect(bufferSources.length).toBe(1);
    expect(oscillators.length).toBe(1); // the 45 Hz sub
    engine.setMuted(true);
    engine.thunder();
    expect(bufferSources.length).toBe(1); // muted: nothing
    engine.dispose();
  });

  it("the bed never runs muted: a live bed tears down, nothing builds, and unmute rebuilds fresh", () => {
    const { ctx, bufferSources } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.setRainLevel(0.8); // live bed
    engine.setMuted(true);
    engine.setRainLevel(0.8); // frozen clock: torn down, not ramped
    expect((bufferSources[0] as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalled();
    engine.setRainLevel(0.8); // still muted: nothing new
    expect(bufferSources.length).toBe(1);
    engine.setMuted(false);
    engine.setRainLevel(0.8); // unmuted: a fresh chain at the live clock
    expect(bufferSources.length).toBe(2);
    engine.dispose();
  });

  it("dispose stops a live rain bed", () => {
    const { ctx, bufferSources } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.setRainLevel(1);
    engine.dispose();
    expect((bufferSources[0] as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalled();
  });
});

describe("nightAmount", () => {
  it("is 0 at noon (full day) and 1 at evening (full night)", () => {
    expect(nightAmount(0.25)).toBeCloseTo(0, 5);
    expect(nightAmount(0.75)).toBeCloseTo(1, 5);
  });

  it("is continuous and periodic across the loop seam", () => {
    expect(nightAmount(0)).toBeCloseTo(nightAmount(1), 5);
    expect(nightAmount(-0.25)).toBeCloseTo(nightAmount(0.75), 5);
  });
});

describe("waterfall roar (living-water epic)", () => {
  it("builds the lowpassed roar chain lazily, ramps with distance level, tears down at 0", () => {
    const { ctx, gains, bufferSources } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.setWaterfallLevel(0); // out of range: nothing built
    expect(bufferSources.length).toBe(0);

    engine.setWaterfallLevel(0.7);
    expect(bufferSources.length).toBe(1);
    expect((bufferSources[0] as { loop: boolean }).loop).toBe(true);
    const roarGain = gains.at(-1)!;
    const ramps = (roarGain.gain.linearRampToValueAtTime as ReturnType<typeof vi.fn>).mock.calls;
    expect(ramps.at(-1)?.[0]).toBeGreaterThan(0.01);

    engine.setWaterfallLevel(0.7); // redundant: no extra chain
    expect(bufferSources.length).toBe(1);

    engine.setWaterfallLevel(0);
    expect((bufferSources[0] as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalled();
    engine.setWaterfallLevel(0.4); // walking back into range builds fresh
    expect(bufferSources.length).toBe(2);
    engine.dispose();
  });

  it("never runs muted — tears down live, builds nothing, rebuilds fresh on unmute", () => {
    const { ctx, bufferSources } = fakeContext();
    const engine = new AudioEngine(() => ctx);
    engine.setWaterfallLevel(0.9);
    engine.setMuted(true);
    engine.setWaterfallLevel(0.9);
    expect((bufferSources[0] as { stop: ReturnType<typeof vi.fn> }).stop).toHaveBeenCalled();
    engine.setWaterfallLevel(0.9);
    expect(bufferSources.length).toBe(1);
    engine.setMuted(false);
    engine.setWaterfallLevel(0.9);
    expect(bufferSources.length).toBe(2);
    engine.dispose();
  });
});
