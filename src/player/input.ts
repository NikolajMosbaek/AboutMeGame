// First-person input layer (pivot slice B — replaces src/movement/input.ts;
// mobile-controls upgrade — floating joystick + sprint-on-push + a React
// context-action button replace the old fixed joystick and SPRINT/USE buttons).
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
  /** Hold to rise while swimming (Space — level-triggered like sprint; on
   *  land the explorer ignores it, there is no jump). */
  rise: boolean;
}

/** Accumulated look rotation since the last consume, in radians. */
export interface LookDelta {
  /** Yaw delta (positive = turn right). */
  dx: number;
  /** Pitch delta (positive = look down). */
  dy: number;
}

function zeroMove(): MoveState {
  return { moveX: 0, moveZ: 0, sprint: false, rise: false };
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
   *  scale with the display's refresh rate; the floating joystick's
   *  sprint-on-push hold timer also integrates over it. */
  update(dt?: number): void;
  /** Queue the same interact edge the E key / gamepad A button do. The
   *  TouchActionButton React component calls this on tap — it is the ONE
   *  place `interactQueued` is armed from outside this module. */
  pressInteract(): void;
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
 * (coarse pointer / touch points), the on-screen controls activate eagerly at
 * construction so the very first touch lands on a live control surface (the
 * iOS fix the old layer carried, #148); a `touchstart` fallback covers devices
 * that report neither signal. Pointer lock is never requested for touch pointers.
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
  const kb = { x: 0, z: 0, sprint: false, rise: false };
  const gp = { connected: false, x: 0, z: 0, sprint: false };

  const readKeyboard = () => {
    kb.x = 0;
    kb.z = 0;
    if (keys.has("w") || keys.has("arrowup")) kb.z += 1;
    if (keys.has("s") || keys.has("arrowdown")) kb.z -= 1;
    if (keys.has("a") || keys.has("arrowleft")) kb.x -= 1;
    if (keys.has("d") || keys.has("arrowright")) kb.x += 1;
    kb.sprint = keys.has("shift");
    // Space (already in MOVE_KEYS, so it never scrolls the page): rise while
    // swimming — the one key set drives it, no new binding surface.
    kb.rise = keys.has(" ");
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

  // ---- Touch: floating joystick (move, left 45%) + right-side drag (look) ----
  const touch = createTouchControls(
    overlay,
    {
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
      touch.update(dt);
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
      state.rise = kb.rise;
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
    pressInteract() {
      interactQueued = true;
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

// Space is a real binding now (rise while swimming, #184); its preventDefault
// also keeps a habitual press from re-activating a focused HUD button or
// page-scrolling the game (the old climb key's guard, kept since slice B).
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
  onActive: () => void;
  /** Raw pixel deltas from a look drag on the right side of the screen. */
  onLook: (dx: number, dy: number) => void;
}

interface TouchReadout {
  active: boolean;
  moveX: number;
  moveZ: number;
  sprint: boolean;
}

/** Joystick knob's max deflection radius, in px (research-backed floating
 *  joysticks — e.g. Minecraft Bedrock's — use a ~50-60px throw). */
const JOYSTICK_MAX_RADIUS = 56;
/** Sprint-on-push (Minecraft Bedrock's "Sprint on Movement"): hold the stick at
 *  ≥90% deflection for this long to engage sprint automatically. */
const SPRINT_ENGAGE_DEFLECTION = 0.9;
const SPRINT_ENGAGE_MS = 250;
/** Once engaged, sprint keeps running until deflection drops below this — a
 *  wider band than the engage threshold so a light ease-off doesn't chatter. */
const SPRINT_SUSTAIN_DEFLECTION = 0.75;
/** The joystick spawns only in the left share of the overlay; the rest is the
 *  look-drag surface. */
const JOYSTICK_ZONE_FRACTION = 0.45;

/**
 * On-screen controls for touch: a FLOATING joystick (move/strafe) that spawns
 * wherever a touch starts in the left 45% of the overlay, plus a drag-to-look
 * surface over the rest. Both are tracked entirely through `overlay`'s own
 * pointer events (no per-element listeners, no `setPointerCapture`) — a touch
 * that starts on the joystick's spawn zone or the look zone keeps driving that
 * one control for its whole lifetime purely by matching `pointerId`, so a
 * finger sliding off the visual joystick never drops the drag. Mounted eagerly
 * when `touchCapable` (see createPlayerInput); `build()` is guarded so the
 * `touchstart` fallback can never mount twice.
 */
function createTouchControls(overlay: HTMLElement, h: TouchHandlers, touchCapable: boolean) {
  let built = false;
  const readout: TouchReadout = { active: false, moveX: 0, moveZ: 0, sprint: false };
  let stickEl: HTMLDivElement | null = null;
  let knobEl: HTMLDivElement | null = null;
  let stickId: number | null = null;
  let origin = { x: 0, y: 0 };
  let deflection = 0; // 0..1, radial magnitude of the current drag
  let sprintHoldMs = 0;
  let sprintOn = false;
  let lookId: number | null = null;
  let lookLast = { x: 0, y: 0 };
  const els: HTMLElement[] = [];

  const ensureStick = () => {
    if (stickEl) return;
    stickEl = div("touch-joystick");
    knobEl = div("touch-knob");
    stickEl.appendChild(knobEl);
    overlay.appendChild(stickEl);
    els.push(stickEl);
  };

  const spawnStick = (x: number, y: number) => {
    ensureStick();
    origin = { x, y };
    stickEl!.style.left = `${x}px`;
    stickEl!.style.top = `${y}px`;
    stickEl!.classList.add("touch-joystick--visible");
    knobEl!.style.transform = "translate(0, 0)";
  };

  const hideStick = () => {
    stickEl?.classList.remove("touch-joystick--visible");
    knobEl?.classList.remove("touch-knob--sprint");
    knobEl?.style.setProperty("transform", "translate(0, 0)");
  };

  const build = () => {
    if (built) return;
    built = true;
    h.onActive();

    overlay.addEventListener("pointerdown", onOverlayPointerDown);
    overlay.addEventListener("pointermove", onOverlayPointerMove);
    overlay.addEventListener("pointerup", onOverlayPointerEnd);
    overlay.addEventListener("pointercancel", onOverlayPointerEnd);
  };

  // A single overlay-level pointerdown decides which control a touch drives:
  // the left 45% spawns/claims the joystick (if one isn't already tracking),
  // everything else drives look — mirroring the old fixed-joystick's zone
  // split, just measured from the overlay edge instead of a button hit test.
  const onOverlayPointerDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.("button")) return; // real HUD controls, never hijacked
    const r = overlay.getBoundingClientRect();
    const inJoystickZone = e.clientX - r.left < r.width * JOYSTICK_ZONE_FRACTION;
    if (inJoystickZone) {
      if (stickId !== null) return; // one drag at a time
      stickId = e.pointerId;
      spawnStick(e.clientX, e.clientY);
      readout.active = true;
      return;
    }
    if (lookId !== null) return;
    lookId = e.pointerId;
    lookLast = { x: e.clientX, y: e.clientY };
    readout.active = true;
  };

  const onOverlayPointerMove = (e: PointerEvent) => {
    if (e.pointerId === stickId) {
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      const mag = Math.hypot(dx, dy);
      const scale = mag > JOYSTICK_MAX_RADIUS && mag > 0 ? JOYSTICK_MAX_RADIUS / mag : 1;
      const kx = dx * scale;
      const ky = dy * scale;
      deflection = Math.min(mag, JOYSTICK_MAX_RADIUS) / JOYSTICK_MAX_RADIUS;
      readout.moveX = kx / JOYSTICK_MAX_RADIUS;
      readout.moveZ = -(ky / JOYSTICK_MAX_RADIUS);
      knobEl!.style.transform = `translate(${kx}px, ${ky}px)`;
      return;
    }
    if (e.pointerId === lookId) {
      h.onLook(e.clientX - lookLast.x, e.clientY - lookLast.y);
      lookLast = { x: e.clientX, y: e.clientY };
    }
  };

  const onOverlayPointerEnd = (e: PointerEvent) => {
    if (e.pointerId === stickId) {
      stickId = null;
      deflection = 0;
      readout.moveX = 0;
      readout.moveZ = 0;
      hideStick();
      return;
    }
    if (e.pointerId === lookId) lookId = null;
  };

  if (touchCapable) build();
  const onFirstTouch = () => build();
  overlay.addEventListener("touchstart", onFirstTouch, { passive: true });

  return {
    read: () => readout,
    /** Advance the sprint-on-push timer over the frame's dt (Minecraft
     *  Bedrock's "Sprint on Movement"): ≥90% deflection sustained for ≥250ms
     *  engages sprint; it holds while deflection stays ≥75%, and drops the
     *  instant it doesn't (releasing the stick zeroes deflection immediately,
     *  so lifting the thumb always disengages sprint on the very same frame). */
    update(dt: number) {
      const ms = dt * 1000;
      if (deflection >= SPRINT_ENGAGE_DEFLECTION) {
        sprintHoldMs += ms;
      } else {
        sprintHoldMs = 0;
      }
      if (!sprintOn && sprintHoldMs >= SPRINT_ENGAGE_MS) {
        sprintOn = true;
      } else if (sprintOn && deflection < SPRINT_SUSTAIN_DEFLECTION) {
        sprintOn = false;
        sprintHoldMs = 0;
      }
      readout.sprint = sprintOn;
      knobEl?.classList.toggle("touch-knob--sprint", sprintOn);
    },
    dispose() {
      overlay.removeEventListener("touchstart", onFirstTouch);
      overlay.removeEventListener("pointerdown", onOverlayPointerDown);
      overlay.removeEventListener("pointermove", onOverlayPointerMove);
      overlay.removeEventListener("pointerup", onOverlayPointerEnd);
      overlay.removeEventListener("pointercancel", onOverlayPointerEnd);
      for (const el of els) el.remove();
    },
  };
}

function div(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}
