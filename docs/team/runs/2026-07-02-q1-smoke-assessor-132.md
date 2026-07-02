# Run log — pure smoke-gate assessor `assessVerify` (#132)

Date: 2026-07-02
Branch: `feat/verify-smoke-assessor`
Issue: #132 — [Q1] Extract the verifier pass/fail decision into a pure,
headless-testable assessor.

## Converged design (summary)

The smoke gate's verdict moves out of `scripts/verify-game.mjs` into a pure,
zero-import ES module. The rule set is fail-closed and matches the real
`EngineState` (src/engine/types.ts:72-80): `state` must be a non-null object,
`state.running === true`, `drawCalls` must be a provably positive finite
number (`Number.isFinite(x) && x > 0` — the naive `x <= 0` passes fail-open
for `undefined` and `NaN`), `canvasPresent === true`, and every console error
matching the frozen regex yields one neutrally worded problem quoting the
text. Problems aggregate in one pass with cascade suppression: `state === null`
emits only the null problem and skips the derived running/drawCalls checks,
while the independent canvas and console checks still run.

In `scripts/verify-game.mjs` only `smokeShot()` changed behavior: JSON.parse
mapped to `state: null` on failure, `canvasPresent` captured via
`document.querySelector('.game-canvas-container canvas') !== null`
(scoped to the GameCanvas container, GameCanvas.tsx:320), screenshot and
STATE logging kept BEFORE the verdict so red runs still ship their visual
evidence, consoleErrors snapshotted after the screenshot settle, and the
verdict routed through the existing `report()` so the
`VERIFY OK` / `VERIFY FAILED:\n- ...` shape and `process.exitCode` semantics
stay byte-compatible (scripts/verify.mjs streams the child verbatim and
adopts its exit code).

## 1. The contract slice #134 asserts against

This is the recorded public contract for the CI render-gate slice (#134):

- **Module path:** `scripts/verify/assess.mjs` (pure, zero imports — no
  Playwright, no `node:` builtins, no `src/`; never throws on malformed
  input; importable by both the Node verifier and Vitest).
- **Signature:** `assessVerify({ state, consoleErrors, canvasPresent })`
  returns exactly `{ ok: boolean, problems: string[] }` — no advisories
  array, no severity enum.
- **Exported names:** `assessVerify` and `WEBGL_ERROR_RE`.
- **Frozen regex:** `WEBGL_ERROR_RE = /webgl|context|THREE/i` — byte-identical
  to the historical inline pattern, deliberately **non-global** (a `/g` regex
  carries `lastIndex` state across `.test()` calls and alternates results).
- **Problem-string shapes** (what #134 may grep for), pinned by
  `scripts/verify/assess.test.mjs` as content assertions, not counts:
  - `engine state is null/unparseable (got <value>) — render_game_to_text
    produced no usable state; running/drawCalls checks skipped`
  - `running is <value> (expected true) — the engine loop is not running`
  - `drawCalls is <value>, not a finite number — malformed or drifted
    engine-state JSON (fail-closed)`
  - `drawCalls 0 — engine ran but no geometry drew`
  - `canvasPresent is <value> (expected true) — no <canvas> under
    .game-canvas-container; the GameCanvas React shell never mounted`
  - `console error matched /webgl|context|THREE/i: <quoted text>`

## 2. Recorded deviation — the AC pass-string is a factual regex match

The original acceptance-criteria pass example used the console line
`'benign non-webgl log'`. That string **matches** the frozen regex —
`'non-webgl'` contains `'webgl'`, so
`/webgl|context|THREE/i.test('benign non-webgl log') === true` (executed
live during this run: `node -e` printed `true`). The pass case was therefore
unsatisfiable as written.

Resolution: the regex stays byte-identical (freezing it is the load-bearing
scope line); the pass fixture substitutes the genuinely non-matching
`'benign log message'` (`.test(...) === false`, same live execution), and
`'benign non-webgl log'` is pinned as an explicit **fail** row in the test
matrix as a regex-breadth pin — so #134's grep contract is built on real
regex behavior, not the AC's mistaken example.

## 3. Deliberate behavior change — fps is advisory-only in the smoke gate

The old smoke check hard-failed on `fps <= 0`; the assessor consults fps
nowhere. Rationale: the fps EMA is seeded at 60 and fed only by live rAF
frames (src/engine/Engine.ts:79, 196-199), so under SwiftShader +
advanceTime-driven stepping it is noise in both directions, while
`running: true` + `drawCalls > 0` (renderer.info from the last presented
frame; advanceTime ends with a forced render, Engine.ts:162) + a mounted
canvas is the actual render proof. fps stays visible in the printed STATE
dump.

Consequences, stated as the trade they are:

- a previously **red** `fps <= 0` run can now pass;
- a rendered-once-then-hung rAF loop passes smoke;
- liveness/budget enforcement is **deferred to #134's scope**, not silently
  assumed covered.

The `running !== true` assertion is NEW — the smoke path never made it — and
`drawCalls` is now fail-closed: Engine.getState maps a missing renderer.info
to `drawCalls: 0` (src/engine/Engine.ts:231, `info?.calls ?? 0`), so
undefined/NaN can only arrive from malformed or foreign JSON or schema drift
across the untyped seam; the strict encoding makes that drift fail red
instead of silently green.

## 4. Intentional divergence — G3/G4/F1 modes stay mode-local

The G3 (day cycle), G4 (landmark tour), and F1 (completion panel) verifier
modes are behavior-byte-identical this slice, including their own fps
hard-fails and inline regex copies. Sharing the assessor would false-red G4:
the landmark tour halts the loop by contract (`__frameView__`/
`renderFromView`, Engine.ts:180-187), so `running === true` baked into a
shared assessor would fail it or sprout a forbidden mode flag.

The only permitted touch outside `smokeShot()` is a one-line comment at each
of the three inline regex sites — now at scripts/verify-game.mjs:380, 596,
687 (the design's 358/573/663 pre-change positions, shifted by the smokeShot
diff) — pinning them to the exported `WEBGL_ERROR_RE`. Comment-only, zero
behavior change.

## Problem-string wording review (triage ergonomics)

Reviewed against the design's report-ergonomics requirements:

- **Neutral regex-quote framing** — console matches read
  `console error matched /webgl|context|THREE/i: ...`, never the old
  `WebGL/three error:` label. `/context/i` also matches AudioContext and
  React-context text; the mislabel would misdirect triage. The label's
  absence is pinned by a dedicated test
  (`assess.test.mjs`, "neutral wording pin").
- **Canvas message names the real failure** — `the GameCanvas React shell
  never mounted`: GameCanvas.tsx:321 renders the canvas statically via
  React, so absence means the shell never mounted; renderer *attachment* is
  proven by `drawCalls > 0`, not canvas presence.
- **Every problem names the marker, the observed value, and what it proves**
  (e.g. `drawCalls 0 — engine ran but no geometry drew`), and failures
  aggregate in one pass so a red run reports everything wrong at once.

## Verification evidence (all executed on this branch, 2026-07-02)

- **`npm test`** — exit 0: **103 files passed, 1002 passed / 1 skipped
  (1003)**. `scripts/verify/assess.test.mjs` is swept by the existing
  `vite.config.ts:43` glob with zero config change; `npx vitest list
  scripts/verify/assess.test.mjs` shows **22 tests** collected.
- **`npm run build`** — exit 0 (`tsc --noEmit && vite build`,
  `✓ built in 643ms`).
- **`npm run verify`** — exit 0, `VERIFY OK`, end-to-end against the built
  preview under SwiftShader (`--use-angle=swiftshader`,
  verify-game.mjs:145). STATE excerpt cited as proof the new strict
  assertions do not false-positive on the real build:

  ```
  STATE: {
    "running": true,
    "elapsed": 1.92,
    "fps": 27.17,
    "drawCalls": 1,
    "triangles": 1,
    ...
  }
  SCREENSHOT: scratchpad-shot.png
  VERIFY OK
  ```

  `running: true` and `drawCalls > 0` hold under SwiftShader. Note for
  reviewers: the fps-0-passes behavior is provable only in the unit tests —
  local hardware always reads positive fps (27.17 here).

## Run-log grep gate (this task's first test)

A grep gate was run RED-then-GREEN against this file for the mandated
verbatim records: `assessVerify`, `{ ok`, `problems`,
`benign non-webgl log`, `benign log message`, `fps`, `#134`, `G3` — all
present, so #134's grep contract is built on real recorded behavior.
