// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assessVerify, WEBGL_ERROR_RE } from "./assess.mjs";

// The derived-check problem shapes, used to assert cascade suppression
// precisely (the null-state message legitimately *names* the skipped checks).
const RUNNING_PROBLEM = /running is .* \(expected true\)/;
const DRAWCALLS_PROBLEM = /^drawCalls/;

/** The AC-mandated pass fixture (fps: 0 must not block — advisory-only). */
const passState = { running: true, drawCalls: 120, fps: 0, triangles: 1000 };

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

describe("assessVerify — mandated fail cases", () => {
  it("fails when state.running !== true, naming the observed value", () => {
    const result = assessVerify({
      state: { ...passState, running: false },
      consoleErrors: [],
      canvasPresent: true,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/running is false \(expected true\)/);
  });

  it("fails on drawCalls 0, saying the engine ran but drew nothing", () => {
    const result = assessVerify({
      state: { ...passState, drawCalls: 0 },
      consoleErrors: [],
      canvasPresent: true,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(
      /drawCalls 0 — engine ran but no geometry drew/,
    );
  });

  it("fails when canvasPresent is false, blaming the unmounted React shell", () => {
    const result = assessVerify({
      state: passState,
      consoleErrors: [],
      canvasPresent: false,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/canvasPresent is false/);
    expect(result.problems[0]).toMatch(
      /no <canvas> under \.game-canvas-container.*GameCanvas React shell never mounted/,
    );
  });

  it("fails on a context-lost console error, quoted neutrally with the regex named", () => {
    const result = assessVerify({
      state: passState,
      consoleErrors: ["THREE.WebGLRenderer: Context Lost."],
      canvasPresent: true,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    // Neutral wording: names the regex that matched and quotes the text —
    // never the misleading "WebGL/three error" label (/context/i also
    // matches AudioContext and React-context messages).
    expect(result.problems[0]).toBe(
      "console error matched /webgl|context|THREE/i: " +
        "THREE.WebGLRenderer: Context Lost.",
    );
  });
});

describe("assessVerify — fail-closed edges", () => {
  it.each([
    ["undefined", undefined],
    ["NaN", NaN],
  ])("fails when drawCalls is %s (not fail-open like `x <= 0` would be)", (label, drawCalls) => {
    const result = assessVerify({
      state: { ...passState, drawCalls },
      consoleErrors: [],
      canvasPresent: true,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(
      new RegExp(`drawCalls is ${label}, not a finite number`),
    );
  });

  it("fails when canvasPresent was never captured (undefined)", () => {
    const result = assessVerify({
      state: passState,
      consoleErrors: [],
      canvasPresent: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(
      /canvasPresent is undefined \(expected true\)/,
    );
  });

  it("fails when running is missing entirely", () => {
    const { running, ...stateWithoutRunning } = passState;
    const result = assessVerify({
      state: stateWithoutRunning,
      consoleErrors: [],
      canvasPresent: true,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(
      /running is undefined \(expected true\)/,
    );
  });

  it("treats parsed-but-not-object state (e.g. a JSON number) as the null case", () => {
    const result = assessVerify({
      state: 42,
      consoleErrors: [],
      canvasPresent: true,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/state.*(null|unparseable).*42/i);
  });

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
    // case below.
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

  it("regex-breadth pin: 'benign non-webgl log' MATCHES and therefore fails", () => {
    // The original AC pass example is a factual regex match — 'non-webgl'
    // contains 'webgl'. Pinned here so #134's grep contract reflects real
    // regex breadth, not the AC's wishful reading.
    const result = assessVerify({
      state: passState,
      consoleErrors: ["benign non-webgl log"],
      canvasPresent: true,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      "console error matched /webgl|context|THREE/i: benign non-webgl log",
    ]);
  });

  it("matches case-insensitively", () => {
    const result = assessVerify({
      state: passState,
      consoleErrors: ["WEBGL warning", "AudioConTeXt was suspended"],
      canvasPresent: true,
    });
    expect(result.ok).toBe(false);
    expect(result.problems).toHaveLength(2);
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
});
