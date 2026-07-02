// Pure verdict assessor for the SMOKE path of scripts/verify-game.mjs.
//
// Scope: this module owns the pass/fail rule set for the default smoke gate
// only. The G3/G4/F1 verifier modes keep their own inline checks by contract
// (the G4 landmark tour halts the loop, so `running === true` baked into a
// shared assessor would false-red it). Zero imports, no I/O, never throws on
// malformed input — importable by both the Node verifier and Vitest.
//
// fps is ADVISORY-ONLY and consulted nowhere here (deliberate trade): the fps
// EMA is seeded at 60 and fed only by live rAF frames (src/engine/Engine.ts),
// so under SwiftShader + advanceTime-driven stepping it is noise in both
// directions. running:true + drawCalls > 0 + a mounted canvas is the actual
// render proof. Consequence: a rendered-once-then-hung rAF loop now passes
// smoke; liveness/budget enforcement is deferred to #134's scope. fps stays
// visible in the verifier's printed STATE dump.
//
// drawCalls is fail-closed (`Number.isFinite(x) && x > 0`, not the naive
// `x <= 0` — `undefined <= 0` and `NaN <= 0` are both false in JS and would
// pass fail-open). Rationale: Engine.getState maps a missing renderer.info to
// drawCalls: 0 (src/engine/Engine.ts:231, `info?.calls ?? 0`), so a stub
// renderer already yields 0; undefined/NaN can only arrive from malformed or
// foreign JSON or a future schema rename across this untyped seam. The strict
// encoding makes that drift fail red instead of silently green.

/**
 * Pinned field-for-field to `EngineState` (src/engine/types.ts:72-80). This
 * module sits on the untyped `window.render_game_to_text` JSON seam and .mjs
 * gets no tsc drift protection — keep this typedef in sync by hand.
 *
 * @typedef {object} EngineStateLike
 * @property {boolean} running
 * @property {number} elapsed
 * @property {number} fps
 * @property {number} drawCalls
 * @property {number} triangles
 * @property {Record<string, Record<string, unknown>>} systems
 */

/**
 * Console-error pattern for WebGL / three.js trouble. Non-global on purpose:
 * a /g regex carries `lastIndex` state across `.test()` calls and would make
 * alternating results. NOTE the breadth is intentional and pinned by tests —
 * /context/i also matches e.g. AudioContext text, and 'non-webgl' contains
 * 'webgl', so matches are reported neutrally, not labelled "WebGL error".
 * The three inline copies in scripts/verify-game.mjs (G3/G4/F1 modes) are
 * pinned to this constant by comment.
 */
export const WEBGL_ERROR_RE = /webgl|context|THREE/i;

/**
 * Assess the smoke gate's captured evidence into a verdict.
 *
 * One-pass aggregation: every failed rule contributes a problem (no
 * short-circuit), with cascade suppression — a null/non-object `state` emits
 * only the state problem and skips the derived running/drawCalls checks
 * (which would be noise), while the independent canvas and console checks
 * still run.
 *
 * @param {object} [input]
 * @param {EngineStateLike | null} [input.state] - parsed
 *   `render_game_to_text` JSON; pass `null` when parsing failed
 * @param {string[]} [input.consoleErrors] - console error texts captured from
 *   the page (defaults to [])
 * @param {boolean} [input.canvasPresent] - whether
 *   `.game-canvas-container canvas` existed in the DOM; anything but `true`
 *   fails (fail-closed: an uncaptured input is a failure, not a pass)
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function assessVerify({ state, consoleErrors = [], canvasPresent } = {}) {
  const problems = [];

  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    problems.push(
      `engine state is null/unparseable (got ${describeValue(state)}) — ` +
        "render_game_to_text produced no usable state; " +
        "running/drawCalls checks skipped",
    );
  } else {
    if (state.running !== true) {
      problems.push(
        `running is ${describeValue(state.running)} (expected true) — ` +
          "the engine loop is not running",
      );
    }
    if (!Number.isFinite(state.drawCalls)) {
      problems.push(
        `drawCalls is ${describeValue(state.drawCalls)}, not a finite ` +
          "number — malformed or drifted engine-state JSON (fail-closed)",
      );
    } else if (state.drawCalls <= 0) {
      problems.push(
        `drawCalls ${state.drawCalls} — engine ran but no geometry drew`,
      );
    }
  }

  if (canvasPresent !== true) {
    problems.push(
      `canvasPresent is ${describeValue(canvasPresent)} (expected true) — ` +
        "no <canvas> under .game-canvas-container; the GameCanvas React " +
        "shell never mounted",
    );
  }

  const errors = Array.isArray(consoleErrors) ? consoleErrors : [];
  for (const entry of errors) {
    const text = typeof entry === "string" ? entry : String(entry);
    if (WEBGL_ERROR_RE.test(text)) {
      problems.push(`console error matched /webgl|context|THREE/i: ${text}`);
    }
  }

  return { ok: problems.length === 0, problems };
}

/** Render a value for a problem string without ever throwing. */
function describeValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "an array";
  if (Number.isNaN(value)) return "NaN";
  return String(value);
}
