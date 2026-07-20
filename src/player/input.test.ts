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

  it("Enter/E on a focused modal control does not leak a world-interact edge", () => {
    // A real <button> inside a role=dialog — how the onboarding and death
    // overlays render. Activating it with Enter must NOT arm a world interact,
    // or the stray edge auto-opens + credits the in-range base-camp site.
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const btn = document.createElement("button");
    dialog.appendChild(btn);
    document.body.appendChild(dialog);
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(input.consumeInteract()).toBe(false);

    // But a press whose target is the world (not interactive UI) still arms it.
    overlay.dispatchEvent(new KeyboardEvent("keydown", { key: "e", bubbles: true }));
    expect(input.consumeInteract()).toBe(true);
    dialog.remove();
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

/** A synthetic pointer event — jsdom has no real `PointerEvent` constructor
 *  wired to layout, so a plain `Event` carrying the same fields the handlers
 *  read (`pointerId`, `pointerType`, `clientX/Y`) is the simplest fake that
 *  needs no polyfill. */
function pointerEvent(
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  props: { pointerId: number; clientX: number; clientY: number; pointerType?: string },
): Event {
  const e = new Event(type, { bubbles: true });
  Object.assign(e, { pointerType: "touch", ...props });
  return e;
}

describe("createPlayerInput on a touch device — floating joystick + sprint-on-push", () => {
  let overlay: HTMLElement;
  let input: PlayerInputController;

  beforeEach(() => {
    overlay = document.createElement("div");
    document.body.appendChild(overlay);
    // Fixed layout so the left-45%/right-55% zone split is deterministic.
    overlay.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 400, height: 800, right: 400, bottom: 800, x: 0, y: 0, toJSON() {} }) as DOMRect;
    input = createPlayerInput(overlay, true);
  });

  afterEach(() => {
    input.dispose();
    overlay.remove();
  });

  it("mounts eagerly so the first touch lands on a live control surface (no SPRINT/USE buttons)", () => {
    expect(overlay.querySelectorAll("button").length).toBe(0);
    expect(input.touchActive).toBe(true);

    input.dispose();
    expect(overlay.querySelector(".touch-joystick")).toBeNull(); // cleaned up
  });

  it("a touch starting in the left 45% spawns the joystick base at the touch point", () => {
    overlay.dispatchEvent(pointerEvent("pointerdown", { pointerId: 1, clientX: 50, clientY: 120 }));

    const stick = overlay.querySelector<HTMLDivElement>(".touch-joystick");
    expect(stick).not.toBeNull();
    expect(stick!.classList.contains("touch-joystick--visible")).toBe(true);
    expect(stick!.style.left).toBe("50px");
    expect(stick!.style.top).toBe("120px");
  });

  it("a touch starting in the right 55% does NOT spawn the joystick (it drives look instead)", () => {
    overlay.dispatchEvent(pointerEvent("pointerdown", { pointerId: 1, clientX: 300, clientY: 120 }));
    expect(overlay.querySelector(".touch-joystick")).toBeNull();
  });

  it("dragging deflects the knob and writes moveX/moveZ, clamped to the max radius (~56px)", () => {
    overlay.dispatchEvent(pointerEvent("pointerdown", { pointerId: 1, clientX: 50, clientY: 120 }));
    // Drag far past the max radius, straight right: full deflection, no forward/back.
    overlay.dispatchEvent(pointerEvent("pointermove", { pointerId: 1, clientX: 250, clientY: 120 }));
    input.update();
    expect(input.state.moveX).toBeCloseTo(1, 5);
    expect(input.state.moveZ).toBeCloseTo(0, 5);

    const knob = overlay.querySelector<HTMLDivElement>(".touch-knob")!;
    const m = knob.style.transform.match(/^translate\(([-\d.]+)px, ([-\d.]+)px\)$/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(56, 5);
    expect(Number(m![2])).toBeCloseTo(0, 5);
  });

  it("release hides the joystick and zeroes the move axes", () => {
    overlay.dispatchEvent(pointerEvent("pointerdown", { pointerId: 1, clientX: 50, clientY: 120 }));
    overlay.dispatchEvent(pointerEvent("pointermove", { pointerId: 1, clientX: 250, clientY: 120 }));
    overlay.dispatchEvent(pointerEvent("pointerup", { pointerId: 1, clientX: 250, clientY: 120 }));
    input.update();

    expect(input.state.moveX).toBe(0);
    expect(input.state.moveZ).toBe(0);
    const stick = overlay.querySelector<HTMLDivElement>(".touch-joystick")!;
    expect(stick.classList.contains("touch-joystick--visible")).toBe(false);
  });

  it("sprint engages after ≥250ms held at ≥90% deflection", () => {
    overlay.dispatchEvent(pointerEvent("pointerdown", { pointerId: 1, clientX: 50, clientY: 120 }));
    overlay.dispatchEvent(pointerEvent("pointermove", { pointerId: 1, clientX: 150, clientY: 120 })); // full deflection

    input.update(0.1); // 100ms — not yet
    expect(input.state.sprint).toBe(false);
    input.update(0.1); // 200ms — not yet
    expect(input.state.sprint).toBe(false);
    input.update(0.1); // 300ms — engaged
    expect(input.state.sprint).toBe(true);
  });

  it("never engages while deflection stays below the 90% threshold", () => {
    overlay.dispatchEvent(pointerEvent("pointerdown", { pointerId: 1, clientX: 50, clientY: 120 }));
    // 28px of 56px max = 50% deflection.
    overlay.dispatchEvent(pointerEvent("pointermove", { pointerId: 1, clientX: 78, clientY: 120 }));

    input.update(0.3);
    input.update(0.3);
    expect(input.state.sprint).toBe(false);
  });

  it("disengages once deflection drops below the 75% sustain threshold", () => {
    overlay.dispatchEvent(pointerEvent("pointerdown", { pointerId: 1, clientX: 50, clientY: 120 }));
    overlay.dispatchEvent(pointerEvent("pointermove", { pointerId: 1, clientX: 150, clientY: 120 })); // full
    input.update(0.3);
    expect(input.state.sprint).toBe(true);

    // Ease off to 50% — below the 75% sustain band.
    overlay.dispatchEvent(pointerEvent("pointermove", { pointerId: 1, clientX: 78, clientY: 120 }));
    input.update(0.016);
    expect(input.state.sprint).toBe(false);
  });

  it("releasing the stick disengages sprint on the very same frame", () => {
    overlay.dispatchEvent(pointerEvent("pointerdown", { pointerId: 1, clientX: 50, clientY: 120 }));
    overlay.dispatchEvent(pointerEvent("pointermove", { pointerId: 1, clientX: 150, clientY: 120 }));
    input.update(0.3);
    expect(input.state.sprint).toBe(true);

    overlay.dispatchEvent(pointerEvent("pointerup", { pointerId: 1, clientX: 150, clientY: 120 }));
    input.update(0.016);
    expect(input.state.sprint).toBe(false);
  });

  it("pressInteract() queues the same edge consumeInteract() drains", () => {
    input.pressInteract();
    expect(input.consumeInteract()).toBe(true);
    expect(input.consumeInteract()).toBe(false); // consumed
  });

  it("simultaneous move (joystick) + look (right-side drag) both work — two independent pointer ids", () => {
    overlay.dispatchEvent(pointerEvent("pointerdown", { pointerId: 1, clientX: 50, clientY: 120 })); // joystick
    overlay.dispatchEvent(pointerEvent("pointerdown", { pointerId: 2, clientX: 300, clientY: 120 })); // look

    overlay.dispatchEvent(pointerEvent("pointermove", { pointerId: 1, clientX: 150, clientY: 120 }));
    overlay.dispatchEvent(pointerEvent("pointermove", { pointerId: 2, clientX: 320, clientY: 100 }));
    input.update();

    expect(input.state.moveX).toBeCloseTo(1, 5); // the joystick drag still landed
    const look = input.consumeLook();
    expect(look.dx).toBeGreaterThan(0); // the look drag also landed, independently
    expect(look.dy).toBeLessThan(0);
  });
});
