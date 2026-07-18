import { describe, expect, it } from "vitest";
import {
  COMIC_TIMING,
  PLAIN_TIMING,
  initialReaction,
  justReacted,
  overshoot,
  stepReaction,
  type ReactionState,
} from "./reactions.ts";

const TRIGGER = { triggered: true };
const CALM = { triggered: false };

/** Step until the state settles in `phase` or the step budget runs out. */
function stepUntil(
  s: ReactionState,
  phase: ReactionState["phase"],
  stim: { triggered: boolean },
  maxSeconds = 30,
): ReactionState {
  let state = s;
  for (let t = 0; t < maxSeconds && state.phase !== phase; t += 0.1) {
    state = stepReaction(state, 0.1, stim, COMIC_TIMING);
  }
  return state;
}

describe("stepReaction", () => {
  it("holds idle until triggered, then enters the freeze beat", () => {
    let s = initialReaction();
    s = stepReaction(s, 0.1, CALM, COMIC_TIMING);
    expect(s.phase).toBe("idle");
    s = stepReaction(s, 0.1, TRIGGER, COMIC_TIMING);
    expect(s.phase).toBe("freeze");
    expect(s.timer).toBe(0);
  });

  it("freezes for exactly freezeSeconds — the comic beat — then reacts", () => {
    let s = stepReaction(initialReaction(), 0.1, TRIGGER, COMIC_TIMING);
    const beats = Math.ceil(COMIC_TIMING.freezeSeconds / 0.1);
    for (let i = 0; i < beats - 1; i++) {
      s = stepReaction(s, 0.1, CALM, COMIC_TIMING); // trigger may vanish; the beat is committed
      expect(s.phase).toBe("freeze");
    }
    s = stepReaction(s, 0.2, CALM, COMIC_TIMING);
    expect(s.phase).toBe("react");
  });

  it("plays the reaction for reactSeconds, then cools down, then returns to idle", () => {
    let s = stepUntil(initialReaction(), "react", TRIGGER);
    s = stepUntil(s, "cooldown", CALM);
    expect(s.phase).toBe("cooldown");
    s = stepUntil(s, "idle", CALM);
    expect(s.phase).toBe("idle");
  });

  it("ignores a re-trigger during cooldown — the refractory period", () => {
    let s = stepUntil(initialReaction(), "cooldown", TRIGGER);
    s = stepReaction(s, 0.1, TRIGGER, COMIC_TIMING);
    expect(s.phase).toBe("cooldown");
  });

  it("PLAIN_TIMING (reduced motion) skips the freeze beat entirely", () => {
    expect(PLAIN_TIMING.freezeSeconds).toBe(0);
    const s = stepReaction(initialReaction(), 0.1, TRIGGER, PLAIN_TIMING);
    expect(s.phase).toBe("react"); // no held beat — straight to flight
  });
});

describe("overshoot", () => {
  it("attacks past 1.0 mid-phase and settles back to ~1 at the end", () => {
    const peak = Math.max(...[0.1, 0.2, 0.3, 0.4, 0.5].map(overshoot));
    expect(peak).toBeGreaterThan(1.05);
    expect(overshoot(1)).toBeCloseTo(1, 2);
    expect(overshoot(0)).toBeCloseTo(0, 2);
  });

  it("is clamped outside 0..1", () => {
    expect(overshoot(-1)).toBeCloseTo(0, 5);
    expect(overshoot(2)).toBeCloseTo(1, 2);
  });
});

describe("justReacted", () => {
  it("is true exactly on the transition INTO react", () => {
    const prev = stepReaction(initialReaction(), 0.1, TRIGGER, PLAIN_TIMING); // → react
    expect(justReacted(initialReaction(), prev)).toBe(true);
    const next = stepReaction(prev, 0.1, CALM, PLAIN_TIMING);
    expect(justReacted(prev, next)).toBe(false); // held react ≠ a new edge
  });
});
