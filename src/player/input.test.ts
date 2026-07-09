import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPlayerInput, type PlayerInputController } from "./input.ts";

function key(type: "keydown" | "keyup", k: string, repeat = false) {
  window.dispatchEvent(new KeyboardEvent(type, { key: k, repeat }));
}

describe("createPlayerInput (pivot slice B)", () => {
  let overlay: HTMLElement;
  let input: PlayerInputController;

  beforeEach(() => {
    overlay = document.createElement("div");
    document.body.appendChild(overlay);
    input = createPlayerInput(overlay, false); // desktop: no touch controls
  });

  afterEach(() => {
    input.dispose();
    overlay.remove();
  });

  it("maps WASD to move axes and Shift to sprint", () => {
    key("keydown", "w");
    key("keydown", "d");
    key("keydown", "Shift");
    input.update();
    expect(input.state.moveZ).toBe(1);
    expect(input.state.moveX).toBe(1);
    expect(input.state.sprint).toBe(true);

    key("keyup", "w");
    key("keydown", "s");
    key("keyup", "d");
    key("keydown", "a");
    key("keyup", "Shift");
    input.update();
    expect(input.state.moveZ).toBe(-1);
    expect(input.state.moveX).toBe(-1);
    expect(input.state.sprint).toBe(false);
  });

  it("arrow keys drive the same axes", () => {
    key("keydown", "ArrowUp");
    key("keydown", "ArrowLeft");
    input.update();
    expect(input.state.moveZ).toBe(1);
    expect(input.state.moveX).toBe(-1);
  });

  it("interact (E / Enter) is edge-triggered and consumed once", () => {
    key("keydown", "e");
    expect(input.consumeInteract()).toBe(true);
    expect(input.consumeInteract()).toBe(false); // consumed

    key("keydown", "Enter");
    expect(input.consumeInteract()).toBe(true);
  });

  it("held-key auto-repeat does not re-arm the interact edge", () => {
    key("keydown", "e");
    expect(input.consumeInteract()).toBe(true);
    key("keydown", "e", true); // OS auto-repeat
    expect(input.consumeInteract()).toBe(false);
  });

  it("desktop construction mounts no touch controls and touchActive stays false", () => {
    expect(overlay.querySelector(".touch-joystick")).toBeNull();
    expect(input.touchActive).toBe(false);
  });

  it("consumeLook drains the accumulated delta exactly once", () => {
    // No pointer lock in jsdom, so the mouse path can't accumulate — but the
    // drain contract must hold regardless of source.
    const first = input.consumeLook();
    expect(first).toEqual({ dx: 0, dy: 0 });
  });

  it("dispose removes the window listeners (keys stop registering)", () => {
    input.dispose();
    key("keydown", "w");
    input.update();
    expect(input.state.moveZ).toBe(0);
  });
});

describe("createPlayerInput on a touch device", () => {
  it("mounts joystick + SPRINT + USE eagerly so the first tap lands on a real control", () => {
    const overlay = document.createElement("div");
    document.body.appendChild(overlay);
    const input = createPlayerInput(overlay, true);

    expect(overlay.querySelector(".touch-joystick")).not.toBeNull();
    const labels = [...overlay.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toContain("SPRINT");
    expect(labels).toContain("USE");
    // No FLY, no thrust pad — those died with the vehicle.
    expect(labels).not.toContain("FLY");
    expect(labels).not.toContain("▲");

    input.dispose();
    expect(overlay.querySelector(".touch-joystick")).toBeNull(); // cleaned up
    overlay.remove();
  });

  it("USE taps queue the same interact edge the keyboard uses", () => {
    const overlay = document.createElement("div");
    document.body.appendChild(overlay);
    const input = createPlayerInput(overlay, true);

    const useBtn = [...overlay.querySelectorAll("button")].find((b) => b.textContent === "USE")!;
    useBtn.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(input.consumeInteract()).toBe(true);

    input.dispose();
    overlay.remove();
  });

  it("SPRINT is hold-to-sprint (down = on, up = off)", () => {
    const overlay = document.createElement("div");
    document.body.appendChild(overlay);
    const input = createPlayerInput(overlay, true);

    const sprintBtn = [...overlay.querySelectorAll("button")].find((b) => b.textContent === "SPRINT")!;
    sprintBtn.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    input.update();
    expect(input.state.sprint).toBe(true);

    sprintBtn.dispatchEvent(new Event("pointerup", { bubbles: true }));
    input.update();
    expect(input.state.sprint).toBe(false);

    input.dispose();
    overlay.remove();
  });
});
