// Procedural audio engine — the jungle palette (pivot slice H, #184; carries
// forward #51 SFX / #52 music's seam).
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
// when idle), so a single switch silences SFX and the ambient bed together.
//
// The ambient bed (`startMusic`/`stopMusic`) is TWO persistent layers, both
// started/stopped together: an insect/cicada drone (two detuned oscillators
// through a shared bandpass filter) that crossfades brightness with the day
// phase (`setAmbientPhase`), and a river-water texture (one oscillator through
// its own bandpass + gain) whose level tracks proximity to water
// (`setRiverProximity`). Sparse day/night accents (bird chirps, owl hoots) are
// scheduled as one-shots by `AudioSystem`, not persistent voices — keeping the
// whole bed at 7 persistent nodes (well inside the "≤ ~8" budget). Every other
// event (footstep, drink, eat, hurt, snake rattle, dig thud, fanfare, death
// sting) is a one-shot voice that stops + disconnects itself, so nothing leaks.

/** The minimal Web Audio surface the engine constructs. A real `AudioContext`
 *  satisfies it; tests pass a fake that records calls. Kept structural (not the
 *  DOM lib type) so the fake needn't implement the entire interface. */
export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: AudioNodeLike;
  readonly state: string;
  /** Sample rate for runtime-generated noise buffers (W1 #228). */
  readonly sampleRate: number;
  createGain(): GainNodeLike;
  createOscillator(): OscillatorNodeLike;
  createBiquadFilter(): BiquadFilterNodeLike;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBufferLike;
  createBufferSource(): AudioBufferSourceNodeLike;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
}

export interface AudioBufferLike {
  getChannelData(channel: number): Float32Array;
}

export interface AudioBufferSourceNodeLike extends AudioNodeLike {
  buffer: AudioBufferLike | null;
  loop: boolean;
  start(when?: number): void;
  stop(when?: number): void;
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
  cancelScheduledValues(time: number): void;
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

// --- Tuning (art-tunable constants, no magic numbers below) -----------------

/** Master level the un-muted engine settles at. SFX mix under it and the
 *  ambient bed well under that, so cues read over the bed. */
const MASTER_GAIN = 0.7;
/** Short ramp used to fade the master in/out on mute so it never clicks. */
const MUTE_RAMP = 0.04;

/** Insect/cicada bed level at full daytime brightness, and its night floor
 *  (quieter, not silent — a jungle at night is never dead quiet). */
const AMBIENT_DAY_GAIN = 0.1;
const AMBIENT_NIGHT_GAIN = 0.06;
/** Bandpass centre for the daytime "shimmer" vs. the lower night "drone". */
const AMBIENT_DAY_FREQ = 3200;
const AMBIENT_NIGHT_FREQ = 850;
/** Fade-in when the bed starts, and the crossfade duration for a day/night
 *  brightness change — long enough to glide, never a click. */
const AMBIENT_FADE_IN = 2;
const AMBIENT_CROSSFADE = 1.2;
/** Skip a re-schedule when the target hasn't moved enough to matter — avoids
 *  flooding the param timeline with a new ramp every single frame. */
const AMBIENT_EPSILON = 0.02;

/** The completion sting's total length, the fraction the ambient bed ducks to
 *  underneath it, and the dip/recover ramp times. There is no bus/duck
 *  backbone (S1 was closed out-of-scope, #115), so the duck is a direct,
 *  self-restoring dip of the bed's own gain. */
const COMPLETION_DUR = 1.2;
const COMPLETION_DUCK = 0.25;
const COMPLETION_DUCK_IN = 0.08;
const COMPLETION_DUCK_OUT = 0.35;

/** The insect bed's target level for a given night amount — the ONE source
 *  `setAmbientPhase`'s crossfade and `completion()`'s duck-restore share, so
 *  a retune can never desynchronise the two. */
function bedLevelFor(night: number): number {
  return AMBIENT_DAY_GAIN + (AMBIENT_NIGHT_GAIN - AMBIENT_DAY_GAIN) * night;
}

/** Rain bed (W1 #228): full-intensity level, ramp time, and bandpass centre.
 *  The bed's 3 nodes (noise source → bandpass → gain) exist ONLY while it
 *  rains — created at the 0→positive boundary, torn down at the return to 0 —
 *  so the persistent-node budget is only borrowed during a shower. */
const RAIN_MAX_GAIN = 0.14;
const RAIN_RAMP = 1.5;
const RAIN_FILTER_FREQ = 2400;
/** The waterfall roar (living-water epic): a deeper noise bed than rain —
 *  lowpassed rumble, gain driven by the player's distance to the falls
 *  (`waterfall.ts` `roarLevelAt`). Same lazy-build/teardown/muted contract
 *  as the rain bed. */
const WATERFALL_MAX_GAIN = 0.2;
const WATERFALL_RAMP = 0.6;
const WATERFALL_FILTER_FREQ = 520;
/** One second of looped white noise — generated at runtime, zero asset bytes. */
const NOISE_SECONDS = 1;

/** River water-texture level at the bank (`setRiverProximity(1)`). */
const RIVER_MAX_GAIN = 0.11;
/** Proximity ramp duration — smooth enough to glide as the player walks. */
const RIVER_FADE = 0.5;
const RIVER_EPSILON = 0.02;

/**
 * AudioEngine — synthesises the jungle's whole soundscape. One-shots (footstep,
 * drink, eat, hurt, snake rattle, jaguar growl, dig thud, fanfare, death sting,
 * clue chime, sprint breath, bird/owl accents) are single voices that stop and disconnect
 * themselves; the ambient bed (`startMusic`/`stopMusic`) is the two persistent
 * layers described above. `setMuted` gates everything at the master gain.
 * Browsers spawn a context "suspended" until a user gesture, so the constructor
 * resumes it (GameCanvas mounts after the title click) — callers should also
 * call `resume()` from the first pointer/key event as a fallback.
 */
export class AudioEngine {
  private readonly ctx: AudioContextLike;
  private readonly master: GainNodeLike;
  private muted = false;
  private disposed = false;

  /** Live oscillators that must be stopped on dispose (the ambient bed). */
  private musicVoices: OscillatorNodeLike[] = [];
  private musicGain: GainNodeLike | null = null;
  private insectFilter: BiquadFilterNodeLike | null = null;
  private riverGain: GainNodeLike | null = null;
  /** Last scheduled targets, so `setAmbientPhase`/`setRiverProximity` can skip
   *  a redundant ramp when called every frame with a near-identical value. */
  private lastNight = -1;
  private lastRiverAmount = -1;

  constructor(ctxFactory: AudioContextFactory) {
    this.ctx = ctxFactory();
    this.master = this.ctx.createGain();
    this.master.gain.value = MASTER_GAIN;
    this.master.connect(this.ctx.destination);
    // Spawned suspended by autoplay policy — resume now (we mount post-gesture)
    // and rely on the pointer/key fallback if the policy still holds it.
    void this.ctx.resume().catch(() => {});
  }

  /** Resume the underlying context. Wired to the persistent gesture/visibility
   *  net (`resumeNet`) so a suspended context unlocks on real input and comes
   *  back after backgrounding. Guarded three ways: a muted engine stays
   *  suspended (that suspend is `setMuted`'s deliberate idle economy, and
   *  `setMuted(false)` is the one path that undoes it), and an
   *  already-running context is left alone — the net fires on every tap and
   *  key-repeat, so this must cost a string compare, not a Promise. */
  resume(): void {
    if (this.disposed || this.muted || this.ctx.state === "running") return;
    void this.ctx.resume().catch(() => {});
  }

  /** Recover a context iOS left `interrupted`. Called every frame by
   *  `AudioSystem` — rAF itself is throttled while hidden, so the first
   *  foreground frame lands exactly when recovery is wanted. `suspended` is
   *  deliberately NOT recovered here: pre-gesture autoplay holds belong to the
   *  gesture net, and mute's suspend to `setMuted`. */
  recoverIfInterrupted(): void {
    if (this.ctx.state === "interrupted") this.resume();
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

  /** Clue "chime" — a bright two-note arpeggio on reading a site/finding a page. */
  chime(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    this.blip(880, t, 0.12, 0.35, "triangle");
    this.blip(1320, t + 0.09, 0.22, 0.3, "triangle");
  }

  /** Soft panting breath — a quick two-note exhale when sprint engages. */
  breathe(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    filter.type = "bandpass";
    filter.frequency.value = 500;
    filter.Q.value = 0.8;
    osc.frequency.setValueAtTime(220, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.3);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.07, t + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.34);
  }

  /** A soft filtered tick — one footstep. `wading` picks a duller, splashier
   *  tone (lower tick + longer tail) over the dry-land click. */
  footstep(wading: boolean): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = wading ? "square" : "triangle";
    filter.type = "bandpass";
    filter.frequency.value = wading ? 260 : 700;
    filter.Q.value = 1.2;
    osc.frequency.setValueAtTime(wading ? 140 : 180, t);
    const dur = wading ? 0.14 : 0.08;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(wading ? 0.09 : 0.06, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** Two quick descending blips — a "glug" on drinking. */
  gulp(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    this.blip(300, t, 0.1, 0.18, "sine");
    this.blip(260, t + 0.09, 0.12, 0.16, "sine");
  }

  /** A tiny crunchy double-blip on eating a fruit. */
  bite(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    this.blip(500, t, 0.05, 0.2, "square");
    this.blip(340, t + 0.04, 0.06, 0.15, "square");
  }

  /** A low percussive thud — a sharp health drop. */
  hurtThud(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(60, t + 0.18);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.28);
  }

  /** A duller, shorter low thud — one third of dig progress. */
  digThud(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(90, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  /** A rapid five-blip trill — the snake's rattle warning (the mechanic IS the
   *  warning: hearing this means back off before the strike radius). */
  snakeAlert(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 5; i++) {
      const freq = i % 2 === 0 ? 1700 : 1500;
      this.blip(freq, t + i * 0.045, 0.03, 0.12, "square");
    }
  }

  /** A long low rumble sliding downward — the jaguar has committed to you.
   *  One-shot on the stalk's rising edge; like the rattle, the warning IS the
   *  mechanic: hearing it means make for the camp, the water, or distance. */
  growl(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    filter.type = "lowpass";
    filter.frequency.value = 220;
    filter.Q.value = 2;
    osc.frequency.setValueAtTime(70, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.9);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 1.05);
  }

  /** Five staggered falling chirps — a whole flock exploding out of a tree
   *  (J1 #221). Frequencies descend across the cascade so it reads as birds
   *  peeling away, not an alarm clock. */
  squawkCascade(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 5; i++) {
      this.blip(1750 - i * 160, t + i * 0.055, 0.09, 0.16, "square");
    }
  }

  /** A rapid high chitter — the thief's giddy getaway (J1 #221). */
  monkeyChitter(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      this.blip(i % 2 === 0 ? 1500 : 1750, t + i * 0.04, 0.035, 0.12, "triangle");
    }
  }

  /** A low, rude little burr from the perch — the taunt (J1 #221). Three
   *  overlapping low square blips read as a raspberry without ever being a
   *  cartoon sound: it stays a plausible primate noise. */
  monkeyRaspberry(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    this.blip(130, t, 0.16, 0.14, "square");
    this.blip(110, t + 0.05, 0.16, 0.13, "square");
    this.blip(95, t + 0.1, 0.18, 0.12, "square");
  }

  /** One rising startled yelp — the apex predator meets a snake (J1 #221). */
  jaguarYelp(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(300, t);
    osc.frequency.exponentialRampToValueAtTime(720, t + 0.22);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.22, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  /** A quick descending plip-cluster — a pool of fish scattering from a
   *  wading splash (J1 #221). */
  splashScatter(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    this.blip(880, t, 0.07, 0.12, "sine");
    this.blip(700, t + 0.05, 0.07, 0.11, "sine");
    this.blip(560, t + 0.1, 0.08, 0.1, "sine");
    this.blip(430, t + 0.16, 0.1, 0.09, "sine");
  }

  /** A bright four-note ascending fanfare — the idol comes out of the ground. */
  fanfare(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    this.blip(523, t, 0.16, 0.3, "triangle");
    this.blip(659, t + 0.12, 0.16, 0.32, "triangle");
    this.blip(784, t + 0.24, 0.16, 0.34, "triangle");
    this.blip(1046, t + 0.36, 0.3, 0.38, "triangle");
  }

  /**
   * The completion sting (S2 #97) — every site found, the game's single
   * largest emotional beat. A three-note ascent (C5–E5–G5) resolving into a
   * held C-major chord with the octave on top: unmistakably bigger than the
   * per-find `chime` and warmer than the finale `fanfare`. ~1.2 s total.
   * While it plays, the ambient bed ducks to a fraction of its level and
   * restores itself — a direct dip of the bed gain, since there is no bus
   * backbone (S1 closed, #115). Any in-flight `setAmbientPhase` crossfade is
   * cancelled first: a leftover ramp event would un-duck the bed mid-sting
   * and then hard-step back down (an audible pop). The next phase drift past
   * `AMBIENT_EPSILON` re-schedules the crossfade against the same
   * {@link bedLevelFor} target, so nothing is lost by cancelling.
   */
  completion(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;

    if (this.musicGain) {
      const bedLevel = bedLevelFor(Math.max(0, this.lastNight));
      this.musicGain.gain.cancelScheduledValues(t);
      this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, t);
      this.musicGain.gain.linearRampToValueAtTime(bedLevel * COMPLETION_DUCK, t + COMPLETION_DUCK_IN);
      this.musicGain.gain.setValueAtTime(bedLevel * COMPLETION_DUCK, t + COMPLETION_DUR - COMPLETION_DUCK_OUT);
      this.musicGain.gain.linearRampToValueAtTime(bedLevel, t + COMPLETION_DUR);
    }

    // The ascent…
    this.blip(523.25, t, 0.14, 0.32, "triangle"); // C5
    this.blip(659.25, t + 0.13, 0.14, 0.32, "triangle"); // E5
    this.blip(783.99, t + 0.26, 0.14, 0.32, "triangle"); // G5
    // …resolving into a held major chord, octave on top.
    this.blip(1046.5, t + 0.42, 0.72, 0.36, "triangle"); // C6
    this.blip(523.25, t + 0.42, 0.72, 0.2, "sine"); // C5
    this.blip(659.25, t + 0.42, 0.72, 0.18, "sine"); // E5
    this.blip(783.99, t + 0.42, 0.72, 0.16, "sine"); // G5
  }

  /** A descending three-note sting — the jungle wins this round. */
  deathSting(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    this.blip(392, t, 0.22, 0.28, "sawtooth");
    this.blip(330, t + 0.16, 0.22, 0.26, "sawtooth");
    this.blip(220, t + 0.32, 0.4, 0.3, "sawtooth");
  }

  /** A tiny quiet high blip — one sparse daytime bird call. Frequency jitters
   *  slightly per call so a run of them doesn't read as a mechanical loop. */
  birdChirp(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    this.blip(2200 + Math.random() * 600, t, 0.09, 0.05, "sine");
  }

  /** A soft two-note low hoot — one sparse nighttime owl call. */
  owlHoot(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    this.blip(280, t, 0.28, 0.08, "sine");
    this.blip(230, t + 0.32, 0.3, 0.07, "sine");
  }

  /**
   * Start the ambient bed (pivot slice H): an insect/cicada drone — two
   * detuned oscillators through a shared bandpass filter, so the beating
   * between them reads as a shimmer/chirr rather than a static tone — plus a
   * river water texture (one oscillator through its own bandpass + gain) that
   * starts silent and is driven by `setRiverProximity`. Seamless by
   * construction (no loop point). Idempotent while already playing.
   */
  startMusic(): void {
    if (this.disposed || this.musicGain) return;
    const t = this.ctx.currentTime;

    // --- Insect/cicada drone --------------------------------------------
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(AMBIENT_DAY_GAIN, t + AMBIENT_FADE_IN);
    gain.connect(this.master);

    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = AMBIENT_DAY_FREQ;
    filter.Q.value = 5;
    filter.connect(gain);

    const a = this.ctx.createOscillator();
    a.type = "sawtooth";
    a.frequency.value = 210;
    a.detune.value = -9;
    a.connect(filter);
    a.start(t);

    const b = this.ctx.createOscillator();
    b.type = "sawtooth";
    b.frequency.value = 214;
    b.detune.value = 11;
    b.connect(filter);
    b.start(t);

    // --- River water texture — starts silent, driven by proximity -------
    const riverGain = this.ctx.createGain();
    riverGain.gain.value = 0.0001;
    riverGain.connect(this.master);

    const riverFilter = this.ctx.createBiquadFilter();
    riverFilter.type = "bandpass";
    riverFilter.frequency.value = 500;
    riverFilter.Q.value = 1.5;
    riverFilter.connect(riverGain);

    const riverOsc = this.ctx.createOscillator();
    riverOsc.type = "sawtooth";
    riverOsc.frequency.value = 180;
    riverOsc.detune.value = 5;
    riverOsc.connect(riverFilter);
    riverOsc.start(t);

    this.musicGain = gain;
    this.musicVoices = [a, b, riverOsc];
    this.insectFilter = filter;
    this.riverGain = riverGain;
    this.lastNight = -1;
    this.lastRiverAmount = -1;
  }

  /** Fade out and tear down the whole ambient bed (both layers). Idempotent. */
  stopMusic(): void {
    if (!this.musicGain) return;
    const t = this.ctx.currentTime;
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, t);
    this.musicGain.gain.linearRampToValueAtTime(0.0001, t + 0.6);
    if (this.riverGain) {
      this.riverGain.gain.setValueAtTime(this.riverGain.gain.value, t);
      this.riverGain.gain.linearRampToValueAtTime(0.0001, t + 0.6);
    }
    for (const v of this.musicVoices) {
      v.stop(t + 0.7);
    }
    this.musicVoices = [];
    this.musicGain = null;
    this.insectFilter = null;
    this.riverGain = null;
  }

  /**
   * Crossfade the insect/cicada bed's brightness and level with the day
   * cycle: bright/louder shimmer at noon, a lower/quieter drone by evening
   * (see {@link nightAmount} — this game's day loop has no true midnight, so
   * "night" here means the darkest half of the loop, centred on evening).
   * Called every frame from `AudioSystem`; skips re-scheduling when the
   * target hasn't moved enough to matter, so it doesn't flood the param
   * timeline at 60fps.
   */
  setAmbientPhase(phase: number): void {
    if (this.disposed || !this.insectFilter || !this.musicGain) return;
    const night = nightAmount(phase);
    if (Math.abs(night - this.lastNight) < AMBIENT_EPSILON) return;
    this.lastNight = night;
    const t = this.ctx.currentTime;
    const freq = AMBIENT_DAY_FREQ + (AMBIENT_NIGHT_FREQ - AMBIENT_DAY_FREQ) * night;
    const level = bedLevelFor(night);
    this.insectFilter.frequency.setValueAtTime(this.insectFilter.frequency.value, t);
    this.insectFilter.frequency.linearRampToValueAtTime(freq, t + AMBIENT_CROSSFADE);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, t);
    this.musicGain.gain.linearRampToValueAtTime(level, t + AMBIENT_CROSSFADE);
  }

  /**
   * Set the river water texture's level from proximity: `0` = silent (beyond
   * the audio system's silence distance), `1` = full at the bank. Called
   * every frame; skips re-scheduling below `RIVER_EPSILON` so a stationary
   * player doesn't flood the param timeline.
   */
  setRiverProximity(amount01: number): void {
    if (this.disposed || !this.riverGain) return;
    const clamped = Math.min(1, Math.max(0, amount01));
    if (Math.abs(clamped - this.lastRiverAmount) < RIVER_EPSILON) return;
    this.lastRiverAmount = clamped;
    const t = this.ctx.currentTime;
    this.riverGain.gain.setValueAtTime(this.riverGain.gain.value, t);
    this.riverGain.gain.linearRampToValueAtTime(clamped * RIVER_MAX_GAIN, t + RIVER_FADE);
  }

  /** Rain bed nodes — alive only while it rains (see RAIN_* docs). */
  private rainSource: AudioBufferSourceNodeLike | null = null;
  private rainGain: GainNodeLike | null = null;
  private lastRainLevel = 0;

  /**
   * Drive the rain bed from the weather envelope (W1 #228). Idempotent per
   * frame: skips redundant ramps (the ambient-phase epsilon posture), builds
   * the noise chain lazily on the first positive level and tears it down
   * when the level returns to 0.
   */
  setRainLevel(level01: number): void {
    if (this.disposed) return;
    // While muted the context is suspended and its clock is FROZEN — any
    // ramps scheduled now would pile up at one instant and replay as a
    // phantom swell on unmute (review finding). The bed simply doesn't run
    // muted; the next unmuted frame rebuilds it from the live envelope.
    if (this.muted) {
      if (this.rainSource) {
        this.rainSource.stop();
        this.stopRainBed();
        this.lastRainLevel = 0;
      }
      return;
    }
    const level = Math.min(1, Math.max(0, level01));
    if (Math.abs(level - this.lastRainLevel) < 0.01 && !(level === 0 && this.rainSource)) return;
    this.lastRainLevel = level;
    const t = this.ctx.currentTime;

    if (level > 0 && !this.rainSource) {
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * NOISE_SECONDS, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      // Deterministic-enough runtime noise: a cheap LCG, no Math.random so
      // headless snapshots stay stable.
      let seed = 1234567;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[i] = (seed / 0xffffffff) * 2 - 1;
      }
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = RAIN_FILTER_FREQ;
      filter.Q.value = 0.4;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.0001;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      source.start(t);
      this.rainSource = source;
      this.rainGain = gain;
    }
    if (this.rainGain) {
      this.rainGain.gain.setValueAtTime(this.rainGain.gain.value, t);
      this.rainGain.gain.linearRampToValueAtTime(
        Math.max(0.0001, level * RAIN_MAX_GAIN),
        t + RAIN_RAMP,
      );
    }
    if (level === 0 && this.rainSource) {
      this.rainSource.stop(t + RAIN_RAMP + 0.1);
      this.stopRainBed();
    }
  }

  private stopRainBed(): void {
    this.rainSource = null;
    this.rainGain = null;
  }

  private waterfallSource: AudioBufferSourceNodeLike | null = null;
  private waterfallGain: GainNodeLike | null = null;
  private lastWaterfallLevel = 0;

  /**
   * Drive the waterfall roar from the player's distance to the falls
   * (living-water epic). Contract mirrors {@link setRainLevel} exactly:
   * idempotent per frame (epsilon-skips redundant ramps), lazy noise chain on
   * the first positive level, torn down at 0, and NEVER runs muted — a muted
   * context's clock is frozen, so ramps scheduled now would replay as a
   * phantom swell on unmute (the rain bed's review finding).
   */
  setWaterfallLevel(level01: number): void {
    if (this.disposed) return;
    if (this.muted) {
      if (this.waterfallSource) {
        this.waterfallSource.stop();
        this.stopWaterfallBed();
        this.lastWaterfallLevel = 0;
      }
      return;
    }
    const level = Math.min(1, Math.max(0, level01));
    if (Math.abs(level - this.lastWaterfallLevel) < 0.01 && !(level === 0 && this.waterfallSource)) {
      return;
    }
    this.lastWaterfallLevel = level;
    const t = this.ctx.currentTime;

    if (level > 0 && !this.waterfallSource) {
      const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * NOISE_SECONDS, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      // Deterministic LCG noise (distinct seed from the rain bed so the two
      // beds never phase-align audibly).
      let seed = 24681357;
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[i] = (seed / 0xffffffff) * 2 - 1;
      }
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = WATERFALL_FILTER_FREQ;
      filter.Q.value = 0.7;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.0001;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      source.start(t);
      this.waterfallSource = source;
      this.waterfallGain = gain;
    }
    if (this.waterfallGain) {
      this.waterfallGain.gain.setValueAtTime(this.waterfallGain.gain.value, t);
      this.waterfallGain.gain.linearRampToValueAtTime(
        Math.max(0.0001, level * WATERFALL_MAX_GAIN),
        t + WATERFALL_RAMP,
      );
    }
    if (level === 0 && this.waterfallSource) {
      this.waterfallSource.stop(t + WATERFALL_RAMP + 0.1);
      this.stopWaterfallBed();
    }
  }

  private stopWaterfallBed(): void {
    this.waterfallSource = null;
    this.waterfallGain = null;
  }

  /** Distant thunder (W1 #228): a noise burst through a low lowpass with a
   *  slow ~2 s decay, plus one 45 Hz sine sub — a rumble, never a crack. */
  thunder(): void {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 7654321;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 0xffffffff) * 2 - 1;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 140;
    filter.Q.value = 0.7;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(0.3, t + 0.15);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(t);
    source.stop(t + 2.2);

    const sub = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(45, t);
    subGain.gain.setValueAtTime(0.0001, t);
    subGain.gain.linearRampToValueAtTime(0.12, t + 0.2);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    sub.connect(subGain);
    subGain.connect(this.master);
    sub.start(t);
    sub.stop(t + 1.9);
  }

  /** Stop the ambient bed, kill the master, and close the context. Safe to
   *  call once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopMusic();
    if (this.rainSource) {
      this.rainSource.stop();
      this.stopRainBed();
    }
    this.master.disconnect();
    void this.ctx.close().catch(() => {});
  }

  /** A short percussive tone — the building block of most one-shot cues. */
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

/**
 * 0 (full day, peaks at noon) .. 1 (full "night", peaks at evening) — a smooth
 * cosine over the day-cycle loop fraction `t` (see `World.dayCycle.getPhase`,
 * 0 = dawn, 0.25 = noon, 0.5 = dusk, 0.75 = evening). This game's day loop is
 * authored with readability floors and never goes truly dark (see
 * `world/dayCycle.ts`), so there is no midnight keyframe to key off; the
 * ambient bed instead treats the darkest HALF of the loop — centred on
 * evening — as "night" for the cicada/owl crossfade. Exported so the pacing
 * logic that decides bird-vs-owl one-shots (`AudioSystem`) shares the exact
 * same curve as the persistent bed's brightness crossfade.
 */
export function nightAmount(phase: number): number {
  const p = ((phase % 1) + 1) % 1;
  return 0.5 - 0.5 * Math.cos((p - 0.25) * Math.PI * 2);
}
