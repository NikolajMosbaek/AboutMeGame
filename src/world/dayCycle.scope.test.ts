import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// --- G3 "living sky" scope-fence guard (task T9) ------------------------------
// The DayCycleSystem slice carries a hard scope fence: it rides the existing
// Reduced Motion switch (no new UI control), adds zero audio coupling (no cycle
// cue, the ambient bed is not re-keyed off the day-cycle clock, and the visual
// reduced-motion gate stays independent of the audio mute), and leaves the
// TextView / no-WebGL path untouched (DayCycleSystem is only ever constructed
// inside `buildWorld`, which only the WebGL `GameCanvas → buildGame` path
// builds). It also makes no changes under `.claude/` (the team harness).
//
// This test pins that fence against the ACTUAL branch diff: it asks git for the
// files changed since the merge-base with `main` and asserts the touched set is
// a subset of the agreed allowlist, with no `.claude/`, `src/ui/`, or
// `src/audio/` file in it. If a future edit widens the blast radius, this guard
// goes red and names the offending file.
//
// It is a meta-test (reads git, not the runtime), so it skips cleanly when run
// outside a git checkout (e.g. a packaged source tarball) rather than failing
// for an environment reason.

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(MODULE_DIR, "..", "..");

/** The exact, agreed set of files this G3 slice is allowed to touch (relative
 *  to the repo root, forward slashes). Anything outside this set is a scope
 *  breach. `buildWorld.dayCycle.test.ts` is the T4 registration test; the
 *  scope-fence test names ITSELF here so it is self-consistent. */
const ALLOWED = new Set([
  // production code
  "src/world/dayCycleSystem.ts",
  "src/world/buildWorld.ts",
  "src/world/dayCycle.ts",
  // tests
  "src/world/dayCycleSystem.test.ts",
  "src/world/buildWorld.dayCycle.test.ts",
  "src/world/dayCycle.test.ts",
  "src/world/dayCycle.scope.test.ts",
  // running-build verifier
  "scripts/verify-game.mjs",
]);

/** Path prefixes that are allowed beyond the exact-file allowlist. The run-log
 *  directory is in-scope for the slice (every run leaves a decision trail under
 *  `docs/team/runs/`), so any file there passes the fence. */
const ALLOWED_PREFIXES = ["docs/team/runs/"];

/** Path prefixes that are forbidden outright — the fence's hard "never" list:
 *  the team harness, the React UI shell, and the audio subsystem. */
const FORBIDDEN_PREFIXES = [".claude/", "src/ui/", "src/audio/"];

/** Changed files since the merge-base with `main`, or `null` when not in a git
 *  checkout (so the suite degrades gracefully rather than failing spuriously). */
function changedFilesSinceMain(): string[] | null {
  try {
    const base = execSync("git merge-base main HEAD", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim();
    const out = execSync(`git diff --name-only ${base} HEAD`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

describe("G3 day-cycle slice holds its scope fence (T9)", () => {
  const changed = changedFilesSinceMain();

  it.skipIf(changed === null)(
    "touches only the agreed allowlist (no UI, audio, or .claude/ files)",
    () => {
      const files = changed ?? [];

      // No file under any forbidden prefix.
      const forbidden = files.filter((f) =>
        FORBIDDEN_PREFIXES.some((p) => f.startsWith(p)),
      );
      expect(
        forbidden,
        "G3 must not touch the team harness, the UI shell, or the audio " +
          `subsystem. Found forbidden file(s): [${forbidden.join(", ")}]`,
      ).toEqual([]);

      // Every touched file is either in the exact allowlist or under an
      // allowed prefix (the run-log directory).
      const unexpected = files.filter(
        (f) =>
          !ALLOWED.has(f) && !ALLOWED_PREFIXES.some((p) => f.startsWith(p)),
      );
      expect(
        unexpected,
        "G3 may only touch the agreed file set (day-cycle code/tests, " +
          "buildWorld registration, the verify script, and docs/team/runs/). " +
          `Unexpected file(s): [${unexpected.join(", ")}]`,
      ).toEqual([]);
    },
  );
});
