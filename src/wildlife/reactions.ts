// The reaction grammar (J1 slice 1, #219) — the ONE shared vocabulary every
// reacting creature steps through:
//
//   idle → (stimulus) → freeze → react → cooldown → idle
//
// The freeze is the comic beat: a held instant of "…!" before the flight —
// the epic's whole "lightly cartoonish" licence lives in that pause and in
// the overshooting attack of the reaction itself. Both are tuned in ONE
// timing table below ({@link COMIC_TIMING}) so the comedy is a single dial,
// and {@link PLAIN_TIMING} collapses the beat to zero for reduced motion.
//
// Pure functions only (the `stepFlock`/`stepJaguar` posture): same inputs,
// same outputs, no clock reads, no randomness — headless-tested and shared
// by birds, fish, monkeys and the jaguar without any of them importing each
// other.

export type ReactionPhase = "idle" | "freeze" | "react" | "cooldown";

export interface ReactionState {
  phase: ReactionPhase;
  /** Seconds spent in the current phase. */
  timer: number;
}

/** The caller decides WHAT triggers (sprint-past, splash, snake underfoot);
 *  the grammar only owns the choreography that follows. */
export interface ReactionStimulus {
  triggered: boolean;
}

export interface ReactionTiming {
  /** The held comic beat between noticing and reacting. */
  freezeSeconds: number;
  /** How long the reaction (flight/dart/bolt) plays. */
  reactSeconds: number;
  /** Refractory period before the same creature can be startled again. */
  cooldownSeconds: number;
}

/** The "lightly cartoonish" dial — snappy beat, punchy reaction, and a
 *  cooldown long enough that a gag never machine-guns. */
export const COMIC_TIMING: ReactionTiming = {
  freezeSeconds: 0.45,
  reactSeconds: 2.2,
  cooldownSeconds: 8,
};

/** Reduced motion: no held beat, no overshoot theatrics — plain flight. */
export const PLAIN_TIMING: ReactionTiming = {
  freezeSeconds: 0,
  reactSeconds: 2.2,
  cooldownSeconds: 8,
};

export function initialReaction(): ReactionState {
  return { phase: "idle", timer: 0 };
}

/**
 * Advance the choreography by `dt`. The freeze beat is COMMITTED — once
 * triggered, it plays out even if the stimulus vanishes (a startle is not a
 * flicker; the same posture as the birds' committed scatter). A stimulus
 * during cooldown is ignored (refractory).
 */
export function stepReaction(
  state: ReactionState,
  dt: number,
  stim: ReactionStimulus,
  timing: ReactionTiming,
): ReactionState {
  switch (state.phase) {
    case "idle":
      if (!stim.triggered) return state;
      // A zero-length freeze (reduced motion) goes straight to the reaction.
      return timing.freezeSeconds <= 0
        ? { phase: "react", timer: 0 }
        : { phase: "freeze", timer: 0 };
    case "freeze": {
      const timer = state.timer + dt;
      return timer >= timing.freezeSeconds
        ? { phase: "react", timer: 0 }
        : { phase: "freeze", timer };
    }
    case "react": {
      const timer = state.timer + dt;
      return timer >= timing.reactSeconds
        ? { phase: "cooldown", timer: 0 }
        : { phase: "react", timer };
    }
    case "cooldown": {
      const timer = state.timer + dt;
      return timer >= timing.cooldownSeconds
        ? { phase: "idle", timer: 0 }
        : { phase: "cooldown", timer };
    }
  }
}

/**
 * The reaction envelope with a comic overshoot: a fast attack that shoots
 * PAST the target (~1.15×) then settles back to exactly 1 by the end of the
 * phase. Consumers scale their flight radius/height/speed by it. Clamped
 * outside 0..1.
 */
export function overshoot(phase01: number): number {
  const t = Math.min(1, Math.max(0, phase01));
  // Fast cubic attack over the first 30%, then a damped settle from the
  // ~1.15 peak back to 1. Continuous at the joint (both sides equal 1.15).
  const ATTACK = 0.3;
  const PEAK = 1.15;
  if (t < ATTACK) {
    const a = t / ATTACK;
    return PEAK * (1 - Math.pow(1 - a, 3));
  }
  const settle = (t - ATTACK) / (1 - ATTACK);
  return 1 + (PEAK - 1) * (1 - settle);
}

/** True exactly on the transition INTO `react` — the one-shot audio edge. */
export function justReacted(prev: ReactionState, next: ReactionState): boolean {
  return next.phase === "react" && prev.phase !== "react";
}
