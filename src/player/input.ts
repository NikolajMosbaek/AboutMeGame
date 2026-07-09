// First-person input layer (pivot slice B — replaces src/movement/input.ts).
//
// All sources (keyboard, touch, gamepad, pointer-lock mouse) write into one
// normalised control surface; the explorer reads only that, so it never knows
// which device is driving. Move axes and sprint are level-triggered; interact is
// edge-triggered and consumed once; look is an *accumulated delta* drained once
// per frame by the explorer (mouse movement events arrive between frames, so a
// per-frame consume keeps rotation frame-rate independent without buffering).

import { readEnv } from "../perf/deviceCapability.ts";

/** Coarse-pointer/touch capability — same single source as deviceCapability. */
function defaultTouchCapable(): boolean {
  const env = readEnv();
  return env.coarsePointer || env.maxTouchPoints > 0;
}

export interface MoveState {
  /** Strafe intent, -1 (left) .. 1 (right). */
  moveX: number;
  /** Walk intent, -1 (back) .. 1 (forward). */
  moveZ: number;
  /** Hold to sprint (stamina-gated by the survival slice later). */
  sprint: boolean;
}

/** Accumulated look rotation since the last consume, in radians. */
export interface LookDelta {
  /** Yaw delta (positive = turn right). */
  dx: number;
  /** Pitch delta (positive = look down). */
  dy: number;
}

function zeroMove(): MoveState {
  return { moveX: 0, moveZ: 0, sprint: false };
}

/** What the explorer reads each frame. */
export interface PlayerInputSnapshot {
  state: MoveState;
  /** Drain the accumulated look delta (radians). Call exactly once per frame. */
  consumeLook(): LookDelta;
  /** True exactly once after an interact (use/read/drink) was requested. */
  consumeInteract(): boolean;
}

export interface PlayerInputController extends PlayerInputSnapshot {
  /** Poll per-frame sources (gamepad). Call once per frame before reading. */
  update(): void;
  /** Whether touch controls are active (so the HUD can adapt). */
  readonly touchActive: boolean;
  dispose(): void;
}

/** Mouse sensitivity: pixels of pointer-lock movement → radians. */
const MOUSE_SENS = 0.0022;
/** Touch look-drag sensitivity: pixels → radians (a thumb sweep ≈ a mouse arc). */
const TOUCH_SENS = 0.0044;
/** Gamepad right-stick look rate, radians per polled frame at full deflection
 *  (poll is per rendered frame; at 60fps this is ~3.4 rad/s). */
const PAD_LOOK_RATE = 0.056;

/**
 * Build the first-person input controller. `overlay` is the canvas container:
 * touch controls mount into it, and a mouse/pen click on it requests pointer
 * lock (the standard desktop FP idiom — Esc releases). When `touchCapable`
 * (coarse pointer / touch points), the on-screen controls mount eagerly at
 * construction so the very first tap lands on a real button (the iOS fix the
 * old layer carried, #148); a `touchstart` fallback covers devices that report
 * neither signal. Pointer lock is never requested for touch pointers.
 */
export function createPlayerInput(
  overlay: HTMLElement,
  touchCapable: boolean = defaultTouchCapable(),
): PlayerInputController {
  const state = zeroMove();
  const look: LookDelta = { dx: 0, dy: 0 };
  let interactQueued = false;
  let touchActive = false;

  // ---- Keyboard ----
  const keys = new Set<string>();
  const onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (!e.repeat && (k === "e" || k === "enter")) interactQueued = true;
    keys.add(k);
    if (MOVE_KEYS.has(k)) e.preventDefault();
  };
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  const readKeyboard = () => {
    let x = 0;
    let z = 0;
    if (keys.has("w") || keys.has("arrowup")) z += 1;
    if (keys.has("s") || keys.has("arrowdown")) z -= 1;
    if (keys.has("a") || keys.has("arrowleft")) x -= 1;
    if (keys.has("d") || keys.has("arrowright")) x += 1;
    return { x, z, sprint: keys.has("shift") };
  };

  // ---- Pointer-lock mouse look ----
  // Request on mouse/pen pointerup (not click: click has no pointerType), only
  // when unlocked. Browsers may reject without a recent gesture — that's fine,
  // the next click tries again. Movement events accumulate into `look` while
  // locked; Esc (browser-owned) releases the lock.
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (document.pointerLockElement) return;
    // A refused lock (headless, iframe policy, no recent gesture) is non-fatal:
    // the game stays playable and the next click simply tries again. Chrome
    // returns a promise (swallow the rejection); older engines throw instead.
    try {
      const req = overlay.requestPointerLock?.() as unknown;
      (req as Promise<void> | undefined)?.catch?.(() => {});
    } catch {
      /* refused — see above */
    }
  };
  const onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement !== overlay) return;
    look.dx += e.movementX * MOUSE_SENS;
    look.dy += e.movementY * MOUSE_SENS;
  };
  overlay.addEventListener("pointerup", onPointerUp);
  window.addEventListener("mousemove", onMouseMove);

  // ---- Touch: left joystick (move) + right-half drag (look) + buttons ----
  const touch = createTouchControls(
    overlay,
    {
      onInteract: () => (interactQueued = true),
      onActive: () => (touchActive = true),
      onLook: (dx, dy) => {
        look.dx += dx * TOUCH_SENS;
        look.dy += dy * TOUCH_SENS;
      },
    },
    touchCapable,
  );

  // ---- Gamepad: left stick move, right stick look, A interact, LT/RB sprint ----
  const padPrev = { a: false };
  const readGamepad = (): { x: number; z: number; sprint: boolean } | null => {
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((p) => p && p.connected);
    if (!pad) return null;
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    const lx = dz(pad.axes[0] ?? 0);
    const ly = dz(pad.axes[1] ?? 0);
    const rx = dz(pad.axes[2] ?? 0);
    const ry = dz(pad.axes[3] ?? 0);
    look.dx += rx * PAD_LOOK_RATE;
    look.dy += ry * PAD_LOOK_RATE;
    const a = pad.buttons[0]?.pressed ?? false;
    if (a && !padPrev.a) interactQueued = true;
    padPrev.a = a;
    const sprint = (pad.buttons[6]?.value ?? 0) > 0.5 || (pad.buttons[10]?.pressed ?? false);
    return { x: lx, z: -ly, sprint };
  };

  return {
    state,
    get touchActive() {
      return touchActive;
    },
    update() {
      const kb = readKeyboard();
      const gp = readGamepad();
      const tc = touch.read();
      let x = kb.x + (gp?.x ?? 0);
      let z = kb.z + (gp?.z ?? 0);
      let sprint = kb.sprint || (gp?.sprint ?? false);
      if (tc.active) {
        x += tc.moveX;
        z += tc.moveZ;
        sprint = sprint || tc.sprint;
      }
      state.moveX = clamp(x, -1, 1);
      state.moveZ = clamp(z, -1, 1);
      state.sprint = sprint;
    },
    consumeLook() {
      const d = { dx: look.dx, dy: look.dy };
      look.dx = 0;
      look.dy = 0;
      return d;
    },
    consumeInteract() {
      const v = interactQueued;
      interactQueued = false;
      return v;
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      overlay.removeEventListener("pointerup", onPointerUp);
      if (document.pointerLockElement === overlay) document.exitPointerLock?.();
      touch.dispose();
    },
  };
}

const MOVE_KEYS = new Set([
  "w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright",
]);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------

interface TouchHandlers {
  onInteract: () => void;
  onActive: () => void;
  /** Raw pixel deltas from a look drag on the right half of the screen. */
  onLook: (dx: number, dy: number) => void;
}

interface TouchReadout {
  active: boolean;
  moveX: number;
  moveZ: number;
  sprint: boolean;
}

/**
 * On-screen controls for touch: a left virtual joystick (move/strafe), a
 * drag-to-look surface on the right half of the overlay, and SPRINT (hold) +
 * USE buttons. Mounted eagerly when `touchCapable` (see createPlayerInput);
 * `build()` is guarded so the `touchstart` fallback can never mount twice.
 */
function createTouchControls(overlay: HTMLElement, h: TouchHandlers, touchCapable: boolean) {
  let built = false;
  const readout: TouchReadout = { active: false, moveX: 0, moveZ: 0, sprint: false };
  let stick: HTMLDivElement | null = null;
  let knob: HTMLDivElement | null = null;
  let stickId: number | null = null;
  let origin = { x: 0, y: 0 };
  let lookId: number | null = null;
  let lookLast = { x: 0, y: 0 };
  const els: HTMLElement[] = [];

  const build = () => {
    if (built) return;
    built = true;
    h.onActive();

    stick = div("touch-joystick");
    knob = div("touch-knob");
    stick.appendChild(knob);
    const sprintBtn = button("touch-btn touch-sprint", "SPRINT");
    const useBtn = button("touch-btn touch-use", "USE");
    for (const el of [stick, sprintBtn, useBtn]) {
      overlay.appendChild(el);
      els.push(el);
    }

    // Joystick drag → move/strafe.
    stick.addEventListener("pointerdown", (e) => {
      stickId = e.pointerId;
      const r = stick!.getBoundingClientRect();
      origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      stick!.setPointerCapture(e.pointerId);
    });
    stick.addEventListener("pointermove", (e) => {
      if (e.pointerId !== stickId) return;
      const max = 48;
      const nx = clamp((e.clientX - origin.x) / max, -1, 1);
      const ny = clamp((e.clientY - origin.y) / max, -1, 1);
      readout.moveX = nx;
      readout.moveZ = -ny;
      readout.active = true;
      knob!.style.transform = `translate(${nx * max}px, ${ny * max}px)`;
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      readout.moveX = 0;
      readout.moveZ = 0;
      knob!.style.transform = "translate(0,0)";
    };
    stick.addEventListener("pointerup", endStick);
    stick.addEventListener("pointercancel", endStick);

    // Look drag: any touch that starts on the overlay's right half and not on a
    // control. The overlay (not window) hosts the handlers, so page UI outside
    // the game never feeds the camera.
    overlay.addEventListener("pointerdown", onLookStart);
    overlay.addEventListener("pointermove", onLookMove);
    overlay.addEventListener("pointerup", onLookEnd);
    overlay.addEventListener("pointercancel", onLookEnd);

    // SPRINT is hold-to-sprint (level-triggered, like Shift).
    sprintBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      readout.sprint = true;
      readout.active = true;
    });
    const endSprint = () => (readout.sprint = false);
    sprintBtn.addEventListener("pointerup", endSprint);
    sprintBtn.addEventListener("pointercancel", endSprint);

    useBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      h.onInteract();
    });
  };

  const onLookStart = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || lookId !== null) return;
    if (e.target !== overlay && !(e.target as HTMLElement)?.classList?.contains("game-canvas")) return;
    const r = overlay.getBoundingClientRect();
    if (e.clientX - r.left < r.width * 0.4) return; // left zone belongs to the stick
    lookId = e.pointerId;
    lookLast = { x: e.clientX, y: e.clientY };
    readout.active = true;
  };
  const onLookMove = (e: PointerEvent) => {
    if (e.pointerId !== lookId) return;
    h.onLook(e.clientX - lookLast.x, e.clientY - lookLast.y);
    lookLast = { x: e.clientX, y: e.clientY };
  };
  const onLookEnd = (e: PointerEvent) => {
    if (e.pointerId === lookId) lookId = null;
  };

  if (touchCapable) build();
  const onFirstTouch = () => build();
  overlay.addEventListener("touchstart", onFirstTouch, { passive: true });

  return {
    read: () => readout,
    dispose() {
      overlay.removeEventListener("touchstart", onFirstTouch);
      overlay.removeEventListener("pointerdown", onLookStart);
      overlay.removeEventListener("pointermove", onLookMove);
      overlay.removeEventListener("pointerup", onLookEnd);
      overlay.removeEventListener("pointercancel", onLookEnd);
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
