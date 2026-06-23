import { afterEach, describe, expect, it } from "vitest";
import { createInput, type InputController } from "./input.ts";

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
}
function release(key: string) {
  window.dispatchEvent(new KeyboardEvent("keyup", { key }));
}

describe("createInput — keyboard mapping & edge events", () => {
  let input: InputController;
  let overlay: HTMLElement;

  afterEach(() => {
    input?.dispose();
    overlay?.remove();
  });

  function make() {
    overlay = document.createElement("div");
    document.body.appendChild(overlay);
    input = createInput(overlay);
    return input;
  }

  it("maps WASD to forward/turn axes", () => {
    make();
    press("w");
    input.update();
    expect(input.state.forward).toBe(1);
    release("w");
    press("s");
    input.update();
    expect(input.state.forward).toBe(-1);

    release("s");
    press("d");
    input.update();
    expect(input.state.turn).toBe(1);
    press("a"); // a + d cancel
    input.update();
    expect(input.state.turn).toBe(0);
  });

  it("maps space to thrust and shift to boost", () => {
    make();
    press(" ");
    press("Shift");
    input.update();
    expect(input.state.thrust).toBe(1);
    expect(input.state.boost).toBe(true);
  });

  it("treats F (mode) and E (interact) as one-shot edge events", () => {
    make();
    press("f");
    expect(input.consumeToggleMode()).toBe(true);
    expect(input.consumeToggleMode()).toBe(false); // consumed once
    press("e");
    expect(input.consumeInteract()).toBe(true);
    expect(input.consumeInteract()).toBe(false);
  });

  it("ignores OS key-repeat so a held F toggles only once", () => {
    make();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    // auto-repeat keydowns while F stays held must NOT re-queue the toggle
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", repeat: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", repeat: true }));
    expect(input.consumeToggleMode()).toBe(true);
    expect(input.consumeToggleMode()).toBe(false);
  });

  it("stops responding after dispose", () => {
    make();
    input.dispose();
    press("w");
    input.update();
    expect(input.state.forward).toBe(0);
    // prevent afterEach double-dispose from throwing
    input = createInput(overlay);
  });

  it("reports touch inactive until a touch occurs", () => {
    make();
    expect(input.touchActive).toBe(false);
  });
});

describe("createInput — eager touch mount (injectable seam)", () => {
  let input: InputController;
  let overlay: HTMLElement;

  afterEach(() => {
    input?.dispose();
    overlay?.remove();
  });

  function make(touchCapable: boolean) {
    overlay = document.createElement("div");
    document.body.appendChild(overlay);
    input = createInput(overlay, touchCapable);
    return input;
  }

  it("mounts controls eagerly so the FIRST USE tap fires interact once, no prior touchstart", () => {
    make(true);
    const useBtn = overlay.querySelector<HTMLButtonElement>(".touch-use");
    expect(useBtn).not.toBeNull();
    // A single plain pointerdown — NOT a PointerEvent (not a constructor in this
    // jsdom) — landing on a real, already-mounted button, no touchstart first.
    useBtn!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(input.consumeInteract()).toBe(true);
    expect(input.consumeInteract()).toBe(false);
  });

  it("mounts the joystick eagerly and reports touch active when touchCapable", () => {
    make(true);
    expect(overlay.querySelector(".touch-joystick")).not.toBeNull();
    expect(input.touchActive).toBe(true);
  });

  it("mounts no touch elements when not touchCapable", () => {
    make(false);
    expect(overlay.querySelector(".touch-use")).toBeNull();
    expect(overlay.querySelector(".touch-joystick")).toBeNull();
    expect(input.touchActive).toBe(false);
  });

  it("does not double-append when a coarse device also fires touchstart", () => {
    make(true);
    overlay.dispatchEvent(new Event("touchstart", { bubbles: true }));
    overlay.dispatchEvent(new Event("touchstart", { bubbles: true }));
    expect(overlay.querySelectorAll(".touch-use").length).toBe(1);
    expect(overlay.querySelectorAll(".touch-joystick").length).toBe(1);
  });
});
