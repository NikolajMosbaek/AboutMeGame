// First-person input layer (pivot slice B — replaces src/movement/input.ts).
//
// All sources (keyboard, touch, gamepad, pointer-lock mouse) write into one
// normalised control surface; the explorer reads only that, so it never knows
// which device is driving. Move axes and sprint are level-triggered; interact is
// edge-triggered and consumed once; look is an *accumulated delta* drained once
// per frame by the explorer (mouse movement events arrive between frames, so a
// per-frame consume keeps rotation frame-rate independent without buffering).

import { isTouchEnv, readEnv } from "../perf/deviceCapability.ts";

/** Coarse-pointer/touch capability — the ONE `isTouchEnv` classification the
 *  quality tier also uses, so controls and render tier agree on device class. */
function defaultTouchCapable(): boolean {
  return isTouchEnv(readEnv());
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
  /** Poll per-frame sources (gamepad). Call once per frame, with the frame's
   *  dt, before reading — stick-look integrates over it, so aim speed doesn't
   *  scale with the display's refresh rate. */
  update(dt?: number): void;
  /** Whether touch controls are active (so the HUD can adapt). */
  readonly touchActive: boolean;
  /** Release the pointer lock iff THIS controller's overlay holds it. Every
   *  lock transition lives in this module; callers only choose when (e.g. the
   *  poll system releases while the session is paused so panels get a cursor). */
  releasePointerLock(): void;
  dispose(): void;
}

/** Mouse sensitivity: pixels of pointer-lock movement → radians. */
const MOUSE_SENS = 0.0022;
/** Touch look-drag sensitivity: pixels → radians (a thumb sweep ≈ a mouse arc). */
const TOUCH_SENS = 0.0044;
/** Gamepad right-stick look rate at full deflection, radians per SECOND —
 *  integrated over the polled dt so a 120 Hz display doesn't double aim speed. */
const PAD_LOOK_RATE = 3.4;

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
  // The game-state gate for grabbing the mouse: buildPlayer passes "not
  // paused", so a click inside an open panel/menu never engages the lock
  // (engage-then-force-exit churn triggers Chrome's ~1.3s lock cooldown).
  shouldLock: () => boolean = () => true,
): PlayerInputController {
  const state = zeroMove();
  const look: LookDelta = { dx: 0, dy: 0 };
  // Handed out by consumeLook — reused, valid until the next consume (the one
  // caller reads it immediately; per-frame allocation here is pure GC churn).
  const lookOut: LookDelta = { dx: 0, dy: 0 };
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
  // Focus leaving the window eats the matching keyups — clear the held set so
  // W can't stay latched and auto-walk while the player is cmd-tabbed away.
  const onBlur = () => keys.clear();
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  // Written in place by readKeyboard/readGamepad each poll — update() runs at
  // 60Hz, so these avoid two object allocations per frame.
  const kb = { x: 0, z: 0, sprint: false };
  const gp = { connected: false, x: 0, z: 0, sprint: false };

  const readKeyboard = () => {
    kb.x = 0;
    kb.z = 0;
    if (keys.has("w") || keys.has("arrowup")) kb.z += 1;
    if (keys.has("s") || keys.has("arrowdown")) kb.z -= 1;
    if (keys.has("a") || keys.has("arrowleft")) kb.x -= 1;
    if (keys.has("d") || keys.has("arrowright")) kb.x += 1;
    kb.sprint = keys.has("shift");
  };

  // ---- Pointer-lock mouse look ----
  // Request on mouse/pen pointerup (not click: click has no pointerType), only
  // when unlocked. Browsers may reject without a recent gesture — that's fine,
  // the next click tries again. Movement events accumulate into `look` while
  // locked; Esc (browser-owned) releases the lock.
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === "touch") return;
    if (document.pointerLockElement) return;
    if (!shouldLock()) return;
    // Clicks on interactive UI inside the overlay (HUD buttons, panels) must
    // not grab the mouse — only clicks on the world itself do.
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("button, a, input, select, textarea, [role='dialog'], [role='menu']")) return;
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

  // ---- Gamepad: left stick move, right stick look, A interact, LT/L3 sprint ----
  const padPrev = { a: false };
  const readGamepad = (dt: number): void => {
    gp.connected = false;
    const pads = typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : null;
    if (!pads) return;
    let pad: Gamepad | null = null;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    if (!pad) return;
    gp.connected = true;
    const lx = deadzone(pad.axes[0] ?? 0);
    const ly = deadzone(pad.axes[1] ?? 0);
    const rx = deadzone(pad.axes[2] ?? 0);
    const ry = deadzone(pad.axes[3] ?? 0);
    look.dx += rx * PAD_LOOK_RATE * dt;
    look.dy += ry * PAD_LOOK_RATE * dt;
    const a = pad.buttons[0]?.pressed ?? false;
    if (a && !padPrev.a) interactQueued = true;
    padPrev.a = a;
    gp.x = lx;
    gp.z = -ly;
    gp.sprint = (pad.buttons[6]?.value ?? 0) > 0.5 || (pad.buttons[10]?.pressed ?? false);
  };

  return {
    state,
    get touchActive() {
      return touchActive;
    },
    update(dt = 1 / 60) {
      readKeyboard();
      readGamepad(dt);
      const tc = touch.read();
      let x = kb.x + (gp.connected ? gp.x : 0);
      let z = kb.z + (gp.connected ? gp.z : 0);
      let sprint = kb.sprint || (gp.connected && gp.sprint);
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
      lookOut.dx = look.dx;
      lookOut.dy = look.dy;
      look.dx = 0;
      look.dy = 0;
      return lookOut;
    },
    consumeInteract() {
      const v = interactQueued;
      interactQueued = false;
      return v;
    },
    releasePointerLock() {
      if (document.pointerLockElement === overlay) document.exitPointerLock?.();
    },
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("mousemove", onMouseMove);
      overlay.removeEventListener("pointerup", onPointerUp);
      if (document.pointerLockElement === overlay) document.exitPointerLock?.();
      touch.dispose();
    },
  };
}

// Space stays here although nothing binds it: preventDefault keeps a habitual
// press from re-activating a focused HUD button or page-scrolling the game
// (the old climb key's guard, kept deliberately — review, slice B).
const MOVE_KEYS = new Set([
  "w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ",
]);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Gamepad stick deadzone. */
function deadzone(v: number): number {
  return Math.abs(v) < 0.15 ? 0 : v;
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
    // Structural hit test: any touch that isn't on one of OUR controls drives
    // the look — never a foreign class-name check that a GameCanvas restyle
    // could silently break (review, slice B).
    const target = e.target as HTMLElement | null;
    if (target?.closest?.(".touch-btn, .touch-joystick")) return;
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
