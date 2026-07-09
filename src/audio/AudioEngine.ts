// Procedural audio engine (#51 SFX, #52 music).
//
// Every sound here is *synthesised* at runtime from oscillators, gain and filter
// envelopes — there are NO audio files to download, which keeps the asset budget
// (docs/perf-budget.md) untouched. The whole Web Audio surface is reached
// through an injected `ctxFactory`, so this is a plain injectable class with no
// singleton and no module-global: production passes `() => new AudioContext()`,
// and a test passes a fake context to assert what gets created/connected without
// real Web Audio (jsdom has no `AudioContext`).
//
// Signal graph: every voice connects to a shared `master` GainNode, which feeds
// the context destination. Mute zeroes the master gain (and suspends the context
// when idle), so a single switch silences SFX and music together.

/** The minimal Web Audio surface the engine constructs. A real `AudioContext`
 *  satisfies it; tests pass a fake that records calls. Kept structural (not the
 *  DOM lib type) so the fake needn't implement the entire interface. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  readonly state: string;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

export interface AudioNodeLike {
  connect(target: AudioNodeLike | AudioParamLike): void;
  disconnect(): void;
}

export interface AudioParamLike {
  value: number;
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, time: number): void;
  exponentialRampToValueAtTime(value: number, time: number): void;
}

export interface GainNodeLike extends AudioNodeLike {
  readonly gain: AudioParamLike;
}

export interface OscillatorNodeLike extends AudioNodeLike {
  type: string;
  readonly frequency: AudioParamLike;
  readonly detune: AudioParamLike;
  start(when?: number): void;
  stop(when?: number): void;
}

export interface BiquadFilterNodeLike extends AudioNodeLike {
  type: string;
  readonly frequency: AudioParamLike;
  readonly Q: AudioParamLike;
}

/** Build the real context. The default `ctxFactory`; tests inject their own. */
export type AudioContextFactory = () => AudioContextLike;

/** Master level the un-muted engine settles at. SFX are mixed under it and the
 *  ambient bed well under that (see `MUSIC_GAIN`) so chimes read over the pad. */
const MASTER_GAIN = 0.7;
/** Ambient bed level relative to master — deliberately quiet background. */
const MUSIC_GAIN = 0.12;
/** Short ramp used to fade the master in/out on mute so it never clicks. */
const MUTE_RAMP = 0.04;

/**
 * AudioEngine — synthesises the game's whole soundscape. SFX (`chime`,
 * `boost`) are one-shot voices; the ambient bed (`startMusic`/`stopMusic`) is a
 * pair of detuned pads through a low-pass filter with a slow LFO, seamless by
 * construction (no loop point, so no seam). `setMuted` gates everything at the
 * master gain. Browsers spawn a context "suspended" until a user gesture, so the
 * constructor resumes it (GameCanvas mounts after the title click) — callers
 * should also call `resume()` from the first pointer/key event as a fallback.
 */
export class AudioEngine {
  private readonly ctx: AudioContextLike;
  private readonly master: GainNodeLike;
  private muted = false;
  private disposed = false;

  /** Live oscillators that must be stopped on dispose (the ambient bed + LFO). */
  private musicVoices: OscillatorNodeLike[] = [];
  private musicGain: GainNodeLike | null = null;

  constructor(ctxFactory: AudioContextFactory) {
    this.ctx = ctxFactory();
    this.master = this.ctx.createGain();
    this.master.gain.value = MASTER_GAIN;
    this.master.connect(this.ctx.destination);
    // Spawned suspended by autoplay policy — resume now (we mount post-gesture)
    // and rely on the pointer/key fallback if the policy still holds it.
    void this.ctx.resume().catch(() => {});
  }

  /** Resume the underlying context (idempotent). Wire this to the first
   *  pointerdown/keydown so a still-suspended context unlocks on real input. */
  resume(): void {
    if (this.disposed) return;
    void this.ctx.resume().catch(() => {});
  }

  /** Mute/unmute the whole mix by ramping the master gain. When muting we also
   *  suspend the context so an idle muted game costs no audio thread; unmuting
   *  resumes it. Reads from the settings store live via the controller. */
  setMuted(muted: boolean): void {
    if (this.disposed || muted === this.muted) return;
    this.muted = muted;
    const t = this.ctx.currentTime;
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(muted ? 0 : MASTER_GAIN, t + MUTE_RAMP);
    if (muted) void this.ctx.suspend().catch(() => {});
    else void this.ctx.resume().catch(() => {});
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Discovery "chime" (#51) — a bright two-note arpeggio on a landmark reveal. */
  chime(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    this.blip(880, t, 0.12, 0.35, "triangle");
    this.blip(1320, t + 0.09, 0.22, 0.3, "triangle");
  }

  /** Soft "boost" cue (#51) — a quick rising blip when boost engages. */
  boost(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(540, t + 0.18);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.16, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.26);
  }

  /**
   * Start the procedural ambient bed (#52): two slightly detuned oscillators
   * (a low root + a fifth) through a shared low-pass filter, with a slow LFO
   * gently sweeping the cutoff. There is no loop point, so it is seamless by
   * construction — it just sustains. Idempotent: a second call is a no-op while
   * already playing. CPU is trivial (four oscillators, one filter).
   */
  startMusic(): void {
    if (this.disposed || this.musicGain) return;
    const t = this.ctx.currentTime;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(MUSIC_GAIN, t + 2); // gentle fade-in
    gain.connect(this.master);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 600;
    filter.Q.value = 4;
    filter.connect(gain);

    // Slow cutoff LFO: an oscillator driving the filter frequency param.
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.type = "sine";
    lfo.frequency.value = 0.06; // ~17s sweep
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start(t);

    // The pads: a root + a detuned fifth for a warm, slightly shifting chord.
    const root = this.ctx.createOscillator();
    root.type = "sawtooth";
    root.frequency.value = 110; // A2
    root.detune.value = -6;
    root.connect(filter);
    root.start(t);

    const fifth = this.ctx.createOscillator();
    fifth.type = "sawtooth";
    fifth.frequency.value = 164.81; // E3
    fifth.detune.value = 7;
    fifth.connect(filter);
    fifth.start(t);

    this.musicGain = gain;
    this.musicVoices = [lfo, root, fifth];
  }

  /** Fade out and tear down the ambient bed. Idempotent. */
  stopMusic(): void {
    if (!this.musicGain) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, t);
    this.musicGain.gain.linearRampToValueAtTime(0.0001, t + 0.6);
    for (const v of this.musicVoices) {
      v.stop(t + 0.7);
    }
    this.musicVoices = [];
    this.musicGain = null;
  }

  /** Stop the music, kill the master, and close the context. Safe to call once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopMusic();
    this.master.disconnect();
    void this.ctx.close().catch(() => {});
  }

  /** A short percussive tone — the building block of the chime. */
  private blip(
    freq: number,
    at: number,
    dur: number,
    peak: number,
    type: OscillatorNodeLike["type"],
  ): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  /** One-shot SFX play only when un-muted and not disposed. */
  private canPlay(): boolean {
    return !this.disposed && !this.muted;
  }
}
