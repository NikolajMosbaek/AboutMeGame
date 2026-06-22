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

  it("exitToTitle moves playing → title", () => {
    expect(appReducer({ kind: "playing" }, { type: "exitToTitle" })).toEqual({
      kind: "title",
    });
  });

  it("exitToTitle is a no-op when already on the title", () => {
    const title = { kind: "title" } as const;
    expect(appReducer(title, { type: "exitToTitle" })).toBe(title);
  });

  it("openTextView moves title → textView", () => {
    expect(appReducer({ kind: "title" }, { type: "openTextView" })).toEqual({
      kind: "textView",
    });
  });

  it("openTextView is a no-op when not on the title", () => {
    const playing = { kind: "playing" } as const;
    expect(appReducer(playing, { type: "openTextView" })).toBe(playing);
  });

  it("exitToTitle moves textView → title", () => {
    expect(appReducer({ kind: "textView" }, { type: "exitToTitle" })).toEqual({
      kind: "title",
    });
  });

  it("start is a no-op from the text view (only the title starts the world)", () => {
    const textView = { kind: "textView" } as const;
    expect(appReducer(textView, { type: "start" })).toBe(textView);
  });
});
