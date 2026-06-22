import { describe, expect, it } from "vitest";
import { gameReducer, INITIAL_PROMPT, type GameScreen } from "./game.ts";

// Anchors the single-source-of-truth prompt copy and the GameScreen union
// spine before the reducer exists. The prompt is the one real, on-vision
// "about me" question every screen reads, so its exact wording is a contract.
describe("game domain", () => {
  it("exposes the real on-vision prompt as a single constant", () => {
    expect(INITIAL_PROMPT).toBe(
      "What is a small thing that instantly makes your day better?",
    );
  });

  it("constructs the initial title screen state", () => {
    const initial: GameScreen = { kind: "title" };
    expect(initial.kind).toBe("title");
  });
});

// The reducer is the pure spine of the slice — unit-testable without React and
// the seam where networked actions later dispatch. Each transition is the
// integrity rule for the Title -> Prompt -> Reveal flow.
describe("gameReducer", () => {
  it("advances title -> prompt carrying the single INITIAL_PROMPT", () => {
    expect(gameReducer({ kind: "title" }, { type: "start" })).toEqual({
      kind: "prompt",
      prompt: INITIAL_PROMPT,
    });
  });

  it("advances prompt -> reveal carrying the answer VERBATIM (untrimmed)", () => {
    const answer = "  spaced\nin  ";
    expect(
      gameReducer(
        { kind: "prompt", prompt: INITIAL_PROMPT },
        { type: "submitAnswer", answer },
      ),
    ).toEqual({ kind: "reveal", prompt: INITIAL_PROMPT, answer });
  });

  it("no-ops on a whitespace-only answer, staying on the prompt screen", () => {
    const prompt: GameScreen = { kind: "prompt", prompt: INITIAL_PROMPT };
    expect(gameReducer(prompt, { type: "submitAnswer", answer: "   " })).toEqual(
      prompt,
    );
  });

  it("rebuilds a fresh title state on playAgain (no leftover answer field)", () => {
    const next = gameReducer(
      { kind: "reveal", prompt: INITIAL_PROMPT, answer: "coffee" },
      { type: "playAgain" },
    );
    expect(next).toEqual({ kind: "title" });
    expect(next).not.toHaveProperty("answer");
  });
});
