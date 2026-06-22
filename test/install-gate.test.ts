import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Clean-checkout install gate (T4).
//
// The charter's documented install command for a fresh checkout is `npm ci`,
// which installs *only* from the committed package-lock.json and fails if the
// lockfile is missing or out of sync with package.json. This test proves that
// gate holds against the real branch: it makes a fresh `git clone` of the
// branch HEAD into a throwaway directory (no node_modules, no working-tree
// edits leaking in), runs `npm ci`, and asserts it exits 0 while the committed
// lockfile is present and left byte-for-byte unchanged.
//
// It is an integration test — it shells out to git and npm and touches disk —
// so it lives outside src/ and runs under its own node-environment Vitest
// config (vitest.install-gate.config.ts), invoked via `npm run test:install-gate`,
// not the fast `npm test` unit suite.

const REPO_ROOT = join(__dirname, "..");
const BRANCH = "bootstrap/stack-and-scaffold";

let workdir: string;
let clonedRepo: string;

/** Run a command in `cwd`, returning the exit code instead of throwing. */
function runStatus(
  cmd: string,
  args: string[],
  cwd: string,
): { code: number; stderr: string } {
  try {
    execFileSync(cmd, args, { cwd, stdio: "pipe", encoding: "utf8" });
    return { code: 0, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stderr?: Buffer | string };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      stderr: e.stderr?.toString() ?? "",
    };
  }
}

beforeAll(() => {
  workdir = mkdtempSync(join(tmpdir(), "amg-install-gate-"));
  clonedRepo = join(workdir, "clone");
  // --no-local forces a real object transfer (the same path a remote clone
  // takes), so a lockfile that only works because of hardlinked siblings would
  // still fail here. --single-branch keeps the clone scoped to the branch.
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
}, 120_000);

afterAll(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

describe("clean-checkout install gate (npm ci)", () => {
  it("clones the branch with a lockfile and no node_modules", () => {
    expect(existsSync(join(clonedRepo, "package-lock.json"))).toBe(true);
    expect(existsSync(join(clonedRepo, "package.json"))).toBe(true);
    expect(existsSync(join(clonedRepo, "node_modules"))).toBe(false);
  });

  it("runs `npm ci` to completion with exit code 0", () => {
    const lockPath = join(clonedRepo, "package-lock.json");
    const before = readFileSync(lockPath);

    const result = runStatus("npm", ["ci"], clonedRepo);
    expect(result.code, result.stderr).toBe(0);

    // npm ci must install dependencies into the fresh clone…
    expect(existsSync(join(clonedRepo, "node_modules"))).toBe(true);
    // …and must leave the committed lockfile unmodified (npm ci never rewrites
    // it; if package.json and the lock were out of sync, ci would have failed
    // above instead of editing the lock the way `npm install` would).
    const after = readFileSync(lockPath);
    expect(after.equals(before)).toBe(true);
  }, 300_000);
});
