import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Clean-checkout build gate (T5).
//
// The charter's documented build command is `npm run build`
// (`tsc --noEmit && vite build`). This test proves that gate holds against the
// real branch from a fresh checkout: it makes a `git clone` of the branch HEAD
// into a throwaway directory (no node_modules, no dist, no working-tree edits
// leaking in), runs `npm ci`, then `npm run build`, and asserts the build
// exits 0, type-checks without TypeScript errors, and emits a non-empty dist/
// (index.html plus a JS bundle, ~32 modules transformed).
//
// It is an integration test — it shells out to git and npm and touches disk —
// so it lives outside src/ and runs under its own node-environment Vitest
// config (vitest.build-gate.config.ts), invoked via `npm run test:build-gate`,
// not the fast `npm test` unit suite.

const REPO_ROOT = join(__dirname, "..");
const BRANCH = "bootstrap/stack-and-scaffold";

let workdir: string;
let clonedRepo: string;

/** Run a command in `cwd`, returning exit code and combined output. */
function run(
  cmd: string,
  args: string[],
  cwd: string,
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(cmd, args, {
      cwd,
      stdio: "pipe",
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as {
      status?: number;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "amg-build-gate-"));
  clonedRepo = join(workdir, "clone");
  // --no-local forces a real object transfer (the same path a remote clone
  // takes); --single-branch keeps the clone scoped to the branch.
  execFileSync(
    "git",
    [
      "clone",
      "--no-local",
      "--single-branch",
      "--branch",
      BRANCH,
      REPO_ROOT,
      clonedRepo,
    ],
    { stdio: "pipe" },
  );
  // Install from the committed lockfile so the build runs against the exact
  // dependency tree a fresh checkout would get.
  const ci = run("npm", ["ci"], clonedRepo);
  expect(ci.code, ci.stderr).toBe(0);
}, 300_000);

afterAll(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

describe("clean-checkout build gate (npm run build)", () => {
  it("clones the branch with no committed dist/ to start from", () => {
    expect(existsSync(join(clonedRepo, "package.json"))).toBe(true);
    // dist/ is gitignored, so a fresh clone must not carry one — the build has
    // to produce it from scratch for this gate to mean anything.
    expect(existsSync(join(clonedRepo, "dist"))).toBe(false);
  });

  it("runs `npm run build` to completion with exit code 0 and emits dist/", () => {
    const result = run("npm", ["run", "build"], clonedRepo);
    const output = result.stdout + result.stderr;
    expect(result.code, output).toBe(0);

    // tsc --noEmit ran first in the build chain; a non-zero exit above would
    // already have caught type errors, but assert no error was reported either.
    expect(output).not.toMatch(/error TS\d+/);

    // vite build reports the module graph it transformed; the static title
    // slice transforms ~32 modules. Assert a non-trivial, plausible count
    // rather than pinning an exact number that churns with dependency bumps.
    const transformed = output.match(/(\d+)\s+modules transformed/);
    expect(transformed, output).not.toBeNull();
    const moduleCount = Number(transformed?.[1]);
    expect(moduleCount).toBeGreaterThanOrEqual(20);

    // dist/ must exist, be non-empty, and contain the entry HTML plus a JS
    // bundle — the minimum proof the app was actually built, not just typed.
    const distDir = join(clonedRepo, "dist");
    expect(existsSync(distDir)).toBe(true);
    const distFiles = readdirSync(distDir);
    expect(distFiles).toContain("index.html");

    const assetsDir = join(distDir, "assets");
    expect(existsSync(assetsDir)).toBe(true);
    const assets = readdirSync(assetsDir);
    expect(assets.some((f) => f.endsWith(".js"))).toBe(true);
  }, 300_000);
});
