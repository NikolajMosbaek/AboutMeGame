// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assessVerify, WEBGL_ERROR_RE } from "./assess.mjs";

// The derived-check problem shapes, used to assert cascade suppression
// precisely (the null-state message legitimately *names* the skipped checks).
const RUNNING_PROBLEM = /running is .* \(expected true\)/;
const DRAWCALLS_PROBLEM = /^drawCalls/;

/** The AC-mandated pass fixture (fps: 0 must not block — advisory-only). */
const passState = { running: true, drawCalls: 120, fps: 0, triangles: 1000 };

// ---------------------------------------------------------------------------
// Fail matrix (table-driven). Every row is a single-failure fixture expected
// to yield exactly one problem, and every expectation pins problem-string
// CONTENT — the marker, the observed value, and what it proves — never just
// a count. `problem` is a RegExp (toMatch) or a string (exact toBe).
// ---------------------------------------------------------------------------
const failMatrix = [
  {
    name:
      "drawCalls undefined — pins the fail-closed encoding " +
      "(undefined <= 0 is false in JS; a literal `x <= 0` would pass fail-open)",
    input: {
      state: { running: true, drawCalls: undefined },
      canvasPresent: true,
      consoleErrors: [],
    },
    problem:
      /drawCalls is undefined, not a finite number — malformed or drifted engine-state JSON \(fail-closed\)/,
  },
  {
    name:
      "drawCalls NaN — same fail-closed pin (NaN <= 0 is also false in JS)",
    input: {
      state: { ...passState, drawCalls: NaN },
      canvasPresent: true,
      consoleErrors: [],
    },
    problem:
      /drawCalls is NaN, not a finite number — malformed or drifted engine-state JSON \(fail-closed\)/,
  },
  {
    name: "drawCalls 0 — engine ran but drew no geometry",
    input: {
      state: { ...passState, drawCalls: 0 },
      canvasPresent: true,
      consoleErrors: [],
    },
    problem: /drawCalls 0 — engine ran but no geometry drew/,
  },
  {
    name: "running false — the engine loop is not running",
    input: {
      state: { ...passState, running: false },
      canvasPresent: true,
      consoleErrors: [],
    },
    problem: /running is false \(expected true\) — the engine loop is not running/,
  },
  {
    name: "running missing entirely — fail-closed, reported as undefined",
    input: {
      state: { drawCalls: 120, fps: 0, triangles: 1000 },
      canvasPresent: true,
      consoleErrors: [],
    },
    problem:
      /running is undefined \(expected true\) — the engine loop is not running/,
  },
  {
    name: "state null — render_game_to_text produced no usable state",
    input: { state: null, canvasPresent: true, consoleErrors: [] },
    problem:
      /engine state is null\/unparseable \(got null\) — render_game_to_text produced no usable state/,
  },
  {
    name:
      "state parsed-but-not-object (a JSON number) — treated as the null case, " +
      "quoting the observed value",
    input: { state: 42, canvasPresent: true, consoleErrors: [] },
    problem: /engine state is null\/unparseable \(got 42\)/,
  },
  {
    name:
      "canvasPresent false — the GameCanvas React shell never mounted " +
      "(GameCanvas.tsx renders the canvas statically; renderer attachment is " +
      "proven by drawCalls > 0, not canvas presence)",
    input: { state: passState, canvasPresent: false, consoleErrors: [] },
    problem:
      /canvasPresent is false \(expected true\) — no <canvas> under \.game-canvas-container; the GameCanvas React shell never mounted/,
  },
  {
    name: "canvasPresent never captured (undefined) — fail-closed, not a pass",
    input: { state: passState, canvasPresent: undefined, consoleErrors: [] },
    problem:
      /canvasPresent is undefined \(expected true\) — no <canvas> under \.game-canvas-container; the GameCanvas React shell never mounted/,
  },
  {
    name:
      "console error 'THREE.WebGLRenderer: Context Lost.' — quoted neutrally " +
      "with the regex named",
    input: {
      state: passState,
      canvasPresent: true,
      consoleErrors: ["THREE.WebGLRenderer: Context Lost."],
    },
    problem:
      "console error matched /webgl|context|THREE/i: " +
      "THREE.WebGLRenderer: Context Lost.",
  },
  {
    name:
      "lowercase variant 'three.webglrenderer: context lost.' — the /i flag " +
      "matches case-insensitively",
    input: {
      state: passState,
      canvasPresent: true,
      consoleErrors: ["three.webglrenderer: context lost."],
    },
    problem:
      "console error matched /webgl|context|THREE/i: " +
      "three.webglrenderer: context lost.",
  },
  {
    name:
      "regex-breadth pin: 'benign non-webgl log' MATCHES and therefore fails " +
      "('non-webgl' contains 'webgl' — the original AC pass example is a " +
      "factual regex match, pinned so #134's grep contract reflects real " +
      "regex breadth)",
    input: {
      state: passState,
      canvasPresent: true,
      consoleErrors: ["benign non-webgl log"],
    },
    problem:
      "console error matched /webgl|context|THREE/i: benign non-webgl log",
  },
];

describe("assessVerify — fail matrix (table-driven)", () => {
  it.each(failMatrix)("$name", ({ input, problem }) => {
    const result = assessVerify(input);
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    if (typeof problem === "string") {
      expect(result.problems[0]).toBe(problem);
    } else {
      expect(result.problems[0]).toMatch(problem);
    }
  });
});

describe("assessVerify — state null cascade suppression", () => {
  it("null state yields exactly one problem naming the null/unparseable state, no derived running/drawCalls problems", () => {
    const result = assessVerify({
      state: null,
      consoleErrors: [],
      canvasPresent: true,
    });
    expect(result.ok).toBe(false);
    // Exactly one problem: the null-state one. The derived running/drawCalls
    // verdicts are suppressed — they would be noise when there is no state.
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/state.*(null|unparseable)/i);
    expect(result.problems.some((p) => RUNNING_PROBLEM.test(p))).toBe(false);
    expect(result.problems.some((p) => DRAWCALLS_PROBLEM.test(p))).toBe(false);
  });

  it("still runs the independent canvas and console checks under a null state", () => {
    const result = assessVerify({
      state: null,
      consoleErrors: ["THREE.WebGLRenderer: Context Lost."],
      canvasPresent: false,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(3);
    expect(result.problems[0]).toMatch(/state.*(null|unparseable)/i);
    expect(result.problems.join("\n")).toMatch(/GameCanvas React shell/);
    expect(result.problems.join("\n")).toMatch(/Context Lost/);
  });
});

describe("assessVerify — fail-closed robustness", () => {
  it("never throws on fully malformed input (no arguments, consoleErrors defaulted)", () => {
    let result;
    expect(() => {
      result = assessVerify();
    }).not.toThrow();
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0);
  });
});

describe("assessVerify — pass case", () => {
  it("passes the mandated fixture: fps 0 and a non-matching console line do not block", () => {
    // Documented behavior change: fps is advisory-only in the smoke gate.
    // NOTE the fixture string is 'benign log message', NOT the original AC
    // example 'benign non-webgl log' — that string factually matches the
    // frozen regex ('non-webgl' contains 'webgl') and is pinned as a fail
    // row in the matrix above.
    const result = assessVerify({
      state: passState,
      consoleErrors: ["benign log message"],
      canvasPresent: true,
    });
    expect(result).toEqual({ ok: true, problems: [] });
  });

  it("passes a full field-for-field EngineState mirror (src/engine/types.ts:72-80)", () => {
    const result = assessVerify({
      state: {
        running: true,
        elapsed: 12.5,
        fps: 0,
        drawCalls: 120,
        triangles: 1000,
        systems: { sky: { phase: "noon" } },
      },
      consoleErrors: [],
      canvasPresent: true,
    });
    expect(result).toEqual({ ok: true, problems: [] });
  });
});

describe("WEBGL_ERROR_RE — frozen regex contract", () => {
  it("is the exact non-global pattern /webgl|context|THREE/i", () => {
    // Non-global matters: a /g regex carries lastIndex state across .test()
    // calls and would alternate results.
    expect(WEBGL_ERROR_RE.source).toBe("webgl|context|THREE");
    expect(WEBGL_ERROR_RE.flags).toBe("i");
  });

  it("matches case-insensitively across every alternative", () => {
    const result = assessVerify({
      state: passState,
      consoleErrors: ["WEBGL warning", "AudioConTeXt was suspended", "three.js"],
      canvasPresent: true,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      "console error matched /webgl|context|THREE/i: WEBGL warning",
      "console error matched /webgl|context|THREE/i: AudioConTeXt was suspended",
      "console error matched /webgl|context|THREE/i: three.js",
    ]);
  });
});

describe("assessVerify — aggregation", () => {
  it("one problem per matching console error, quoting each", () => {
    const result = assessVerify({
      state: passState,
      consoleErrors: [
        "THREE.WebGLRenderer: Context Lost.",
        "benign log message",
        "WebGL: INVALID_OPERATION",
      ],
      canvasPresent: true,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      "console error matched /webgl|context|THREE/i: " +
        "THREE.WebGLRenderer: Context Lost.",
      "console error matched /webgl|context|THREE/i: WebGL: INVALID_OPERATION",
    ]);
  });

  it("aggregates every failed rule in one pass — no short-circuit", () => {
    const result = assessVerify({
      state: { ...passState, running: false, drawCalls: 0 },
      consoleErrors: ["THREE.WebGLRenderer: Context Lost."],
      canvasPresent: false,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(4);
    expect(result.problems.some((p) => RUNNING_PROBLEM.test(p))).toBe(true);
    expect(result.problems.some((p) => DRAWCALLS_PROBLEM.test(p))).toBe(true);
    expect(result.problems.join("\n")).toMatch(/GameCanvas React shell/);
    expect(result.problems.join("\n")).toMatch(/Context Lost/);
  });

  it("neutral wording pin: no problem carries a 'WebGL/three error' label", () => {
    // /context/i also matches AudioContext and React-context text; labelling
    // every match a "WebGL/three error" would misdirect triage. Exercise every
    // problem producer at once and pin the label's absence.
    const result = assessVerify({
      state: null,
      consoleErrors: [
        "webgl trouble",
        "AudioContext was suspended",
        "THREE warning",
      ],
      canvasPresent: false,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(5);
    for (const problem of result.problems) {
      expect(problem).not.toMatch(/WebGL\/three error/i);
    }
  });
});
