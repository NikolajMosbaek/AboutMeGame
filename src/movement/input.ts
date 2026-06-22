// Input layer for movement (issues #31 keyboard, #32 touch, #33 gamepad).
//
// All three sources write into one normalised `ControlState`; the vehicle reads
// only that, so it never knows or cares which device is driving. Continuous
// axes are level-triggered; mode-toggle and interact are edge-triggered and
// consumed once, so a held key fires them a single time.

export interface ControlState {
  /** Forward/back intent, -1..1. Drive: accelerate/brake-reverse. Fly: pitch. */
  forward: number;
  /** Left/right intent, -1..1. Drive: steer. Fly: roll (banked turn). */
  turn: number;
  /** Lift/thrust intent, 0..1. Drive: hop assist. Fly: climb thrust. */
  thrust: number;
  /** Hold to go faster. */
  boost: boolean;
}

function zeroState(): ControlState {
  return { forward: 0, turn: 0, thrust: 0, boost: false };
}

/** What the vehicle reads each frame. */
export interface InputSnapshot {
  state: ControlState;
  /** True exactly once after a drive↔fly toggle was requested. */
  consumeToggleMode(): boolean;
  /** True exactly once after an interact (reveal) was requested. */
  consumeInteract(): boolean;
}

export interface InputController extends InputSnapshot {
  /** Poll per-frame sources (gamepad). Call once per frame before reading. */
  update(): void;
  /** Whether touch controls are active (so the HUD can adapt). */
  readonly touchActive: boolean;
  dispose(): void;
}

/**
 * Build the input controller. `overlay` is the DOM element touch controls mount
 * into (the canvas container). Keyboard binds to window; gamepad is polled in
 * `update()`. Touch controls are created lazily on first touch.
 */
export function createInput(overlay: HTMLElement): InputController {
  const state = zeroState();
  let toggleQueued = false;
  let interactQueued = false;
  let touchActive = false;

  // ---- Keyboard (#31) ----
  const keys = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (k === "f") toggleQueued = true;
    if (k === "e" || k === "enter") interactQueued = true;
    keys.add(k);
    if (MOVE_KEYS.has(k)) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  const readKeyboard = () => {
    let f = 0;
    let t = 0;
    let th = 0;
    if (keys.has("w") || keys.has("arrowup")) f += 1;
    if (keys.has("s") || keys.has("arrowdown")) f -= 1;
    if (keys.has("a") || keys.has("arrowleft")) t -= 1;
    if (keys.has("d") || keys.has("arrowright")) t += 1;
    if (keys.has(" ")) th += 1;
    return { f, t, th, boost: keys.has("shift") };
  };

  // ---- Touch (#32): left virtual joystick + right thrust + two buttons ----
  const touch = createTouchControls(overlay, {
    onToggle: () => (toggleQueued = true),
    onInteract: () => (interactQueued = true),
    onActive: () => (touchActive = true),
  });

  // ---- Gamepad (#33): standard mapping, polled each frame ----
  const readGamepad = (): {
    f: number;
    t: number;
    th: number;
    boost: boolean;
  } | null => {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    if (!pad) return null;
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v); // deadzone
    const lx = dz(pad.axes[0] ?? 0);
    const ly = dz(pad.axes[1] ?? 0);
    const rt = pad.buttons[7]?.value ?? 0; // right trigger
    const a = pad.buttons[0]?.pressed ?? false; // A → interact (edge)
    const y = pad.buttons[3]?.pressed ?? false; // Y → toggle (edge)
    if (a && !padPrev.a) interactQueued = true;
    if (y && !padPrev.y) toggleQueued = true;
    padPrev.a = a;
    padPrev.y = y;
    return { f: -ly, t: lx, th: rt, boost: (pad.buttons[6]?.value ?? 0) > 0.5 };
  };
  const padPrev = { a: false, y: false };

  return {
    state,
    get touchActive() {
      return touchActive;
    },
    update() {
      const kb = readKeyboard();
      const gp = readGamepad();
      const tc = touch.read();
      // Combine sources: keyboard + gamepad axes sum, touch overrides when held.
      let f = kb.f + (gp?.f ?? 0);
      let t = kb.t + (gp?.t ?? 0);
      let th = Math.max(kb.th, gp?.th ?? 0);
      let boost = kb.boost || (gp?.boost ?? false);
      if (tc.active) {
        f += tc.forward;
        t += tc.turn;
        th = Math.max(th, tc.thrust);
        boost = boost || tc.boost;
      }
      state.forward = clamp(f, -1, 1);
      state.turn = clamp(t, -1, 1);
      state.thrust = clamp(th, 0, 1);
      state.boost = boost;
    },
    consumeToggleMode() {
      const v = toggleQueued;
      toggleQueued = false;
      return v;
    },
    consumeInteract() {
      const v = interactQueued;
      interactQueued = false;
      return v;
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      touch.dispose();
    },
  };
}

const MOVE_KEYS = new Set([
  "w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ",
]);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------

interface TouchHandlers {
  onToggle: () => void;
  onInteract: () => void;
  onActive: () => void;
}

interface TouchReadout {
  active: boolean;
  forward: number;
  turn: number;
  thrust: number;
  boost: boolean;
}

/**
 * A minimal on-screen control set for touch devices: a left virtual joystick
 * (drag = forward/turn), a right thrust pad (hold = climb), and FLY/USE buttons.
 * Created lazily on first touch so desktop never sees it. Epic 5's HUD can
 * restyle these, but they drive the same `ControlState`.
 */
function createTouchControls(overlay: HTMLElement, h: TouchHandlers) {
  let built = false;
  const readout: TouchReadout = { active: false, forward: 0, turn: 0, thrust: 0, boost: false };
  let stick: HTMLDivElement | null = null;
  let knob: HTMLDivElement | null = null;
  let stickId: number | null = null;
  let origin = { x: 0, y: 0 };
  const els: HTMLElement[] = [];

  const build = () => {
    if (built) return;
    built = true;
    h.onActive();

    stick = div("touch-joystick");
    knob = div("touch-knob");
    stick.appendChild(knob);
    const thrustPad = button("touch-btn touch-thrust", "▲");
    const flyBtn = button("touch-btn touch-fly", "FLY");
    const useBtn = button("touch-btn touch-use", "USE");
    for (const el of [stick, thrustPad, flyBtn, useBtn]) {
      overlay.appendChild(el);
      els.push(el);
    }

    // Joystick drag.
    stick.addEventListener("pointerdown", (e) => {
      stickId = e.pointerId;
      const r = stick!.getBoundingClientRect();
      origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      stick!.setPointerCapture(e.pointerId);
    });
    stick.addEventListener("pointermove", (e) => {
      if (e.pointerId !== stickId) return;
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      const max = 48;
      const nx = clamp(dx / max, -1, 1);
      const ny = clamp(dy / max, -1, 1);
      readout.turn = nx;
      readout.forward = -ny;
      readout.active = true;
      knob!.style.transform = `translate(${nx * max}px, ${ny * max}px)`;
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      readout.turn = 0;
      readout.forward = 0;
      knob!.style.transform = "translate(0,0)";
    };
    stick.addEventListener("pointerup", endStick);
    stick.addEventListener("pointercancel", endStick);

    // Thrust pad (hold).
    thrustPad.addEventListener("pointerdown", () => (readout.thrust = 1));
    const endThrust = () => (readout.thrust = 0);
    thrustPad.addEventListener("pointerup", endThrust);
    thrustPad.addEventListener("pointercancel", endThrust);

    flyBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      h.onToggle();
    });
    useBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      h.onInteract();
    });
  };

  const onFirstTouch = () => build();
  overlay.addEventListener("touchstart", onFirstTouch, { passive: true });

  return {
    read: () => readout,
    dispose() {
      overlay.removeEventListener("touchstart", onFirstTouch);
      for (const el of els) el.remove();
    },
  };
}

function div(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}
function button(className: string, label: string): HTMLButtonElement {
  const el = document.createElement("button");
  el.className = className;
  el.textContent = label;
  el.type = "button";
  return el;
}
