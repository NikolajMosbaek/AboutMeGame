import { describe, expect, it } from "vitest";
import { appReducer, INITIAL_APP_STATE } from "./appState.ts";

describe("appReducer", () => {
  it("starts on the title screen", () => {
    expect(INITIAL_APP_STATE).toEqual({ kind: "title" });
  });

  it("start moves title → playing", () => {
    expect(appReducer({ kind: "title" }, { type: "start" })).toEqual({
      kind: "playing",
    });
  });

  it("start is a no-op when already playing", () => {
    const playing = { kind: "playing" } as const;
    expect(appReducer(playing, { type: "start" })).toBe(playing);
  });
});
