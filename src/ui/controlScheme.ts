// Control-scheme foundation (#140, Epic A2).
//
// Maps a device input channel to the right first-run control hints. Kept a
// *pure* resolver over module-level frozen tables plus one guarded impure
// reader — mirroring src/perf/deviceCapability.ts exactly: `resolveControlScheme`
// reads no globals, and `readControlChannel`'s default arg is the only place real
// `window` is touched, degrading safely when the signal is absent.
//
// DELIBERATE DIVERGENCE — coarse-pointer is the SOLE signal here. This is a
// narrower threshold than input.ts's `defaultTouchCapable` and
// deviceCapability's `isTouch` (which also count `navigator.maxTouchPoints > 0`).
// That breadth is correct for the render-budget cap, but WRONG for onboarding
// copy: a touchscreen laptop reports maxTouchPoints > 0 yet has a real keyboard,
// and counting it as "touch" would hide its keyboard hints — the exact failure
// this epic exists to prevent. We also do NOT consult `input.touchActive`: it is
// always false at title/first-run time (it only flips on the first touchstart
// against a mounted overlay), so it is a dead, untestable phantom signal here.
// A future reader should NOT "fix" this back to the broader notion — the
// `ControlSchemeEnv` exposes only `coarsePointer` precisely so there is no
// surface to consult either one.

export type ControlChannel = "touch" | "keyboard";

/** One control hint. `label` is channel-neutral on purpose: for keyboard it is a
 *  key or chord ("W A S D"), for touch it names an on-screen button ("FLY"). It
 *  is deliberately NOT called `keys` — touch entries name buttons, not keys, and
 *  slice #141 maps label->`<kbd>` for keyboard and label->button for touch. */
export interface ControlEntry {
  label: string;
  action: string;
}

/** The first-run control hints for one input channel. */
export interface ControlScheme {
  channel: ControlChannel;
  entries: ReadonlyArray<ControlEntry>;
}

// Keyboard hints, lifted verbatim from Onboarding.tsx CONTROLS (the rendered
// first-run list). `label` carries what that file calls `keys`.
const KEYBOARD_ENTRIES: ReadonlyArray<ControlEntry> = Object.freeze([
  Object.freeze({ label: "W A S D", action: "Drive / steer" }),
  Object.freeze({ label: "F", action: "Toggle flight" }),
  Object.freeze({ label: "Shift", action: "Boost" }),
  Object.freeze({ label: "Space", action: "Climb (in flight)" }),
  Object.freeze({ label: "E", action: "Reveal a landmark" }),
  Object.freeze({ label: "Esc", action: "Menu" }),
]);

// Touch hints, mirroring the on-screen buttons built by `createTouchControls`
// in src/movement/input.ts (~lines 234-239: the joystick, "▲", "FLY", "USE").
// Those literal labels are duplicated here by hand; extracting a shared label
// constant is a #141/#142 follow-up once both screens consume this module.
const TOUCH_ENTRIES: ReadonlyArray<ControlEntry> = Object.freeze([
  Object.freeze({ label: "Joystick", action: "Drive / steer" }),
  Object.freeze({ label: "▲", action: "Climb (in flight)" }),
  Object.freeze({ label: "FLY", action: "Toggle flight" }),
  Object.freeze({ label: "USE", action: "Reveal a landmark" }),
]);

const SCHEMES: Readonly<Record<ControlChannel, ControlScheme>> = Object.freeze({
  keyboard: Object.freeze({ channel: "keyboard", entries: KEYBOARD_ENTRIES }),
  touch: Object.freeze({ channel: "touch", entries: TOUCH_ENTRIES }),
});

/** Pure: map a channel to its frozen control-hint table. Reads no globals and
 *  returns module-level constants — never rebuilt per call. */
export function resolveControlScheme(channel: ControlChannel): ControlScheme {
  return SCHEMES[channel];
}

/** The single signal the channel is derived from. Deliberately ONE boolean — see
 *  the deliberate-divergence note above — and NOT a reuse of perf's wider
 *  `CapabilityEnv`. */
export interface ControlSchemeEnv {
  /** True when the primary pointer is coarse (`pointer: coarse`) — a touch
   *  device whose first-run hints should name on-screen buttons. */
  coarsePointer: boolean;
}

/** Read the real platform signal, guarding `matchMedia` so SSR/jsdom/old browsers
 *  don't throw — byte-for-byte the deviceCapability.readEnv coarse-pointer guard.
 *  The single impure entry point; everything else is pure. */
function readEnv(): ControlSchemeEnv {
  const coarsePointer =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false;
  return { coarsePointer };
}

/** The only impure entry point. Pure function of its injected env every call (no
 *  cached/resolved channel, no singleton): "touch" iff the pointer is coarse,
 *  else "keyboard" — the safe default whenever the pointer is fine or the signal
 *  is absent. The default arg path calls the real guard. */
export function readControlChannel(env: ControlSchemeEnv = readEnv()): ControlChannel {
  return env.coarsePointer ? "touch" : "keyboard";
}
