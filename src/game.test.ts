import { describe, expect, it } from "vitest";
import { INITIAL_PROMPT, type GameScreen } from "./game.ts";

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
