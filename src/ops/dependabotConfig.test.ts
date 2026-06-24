import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";

/*
 * SEC1 slice 3 (#137) — Dependabot config guard (T1).
 *
 * Closes the silent supply-chain gap: a checked-in `.github/dependabot.yml`
 * that opens weekly, grouped, non-major update PRs for both the npm ecosystem
 * (the root lockfile) and our GitHub Actions. An unguarded config rots
 * silently — someone reformats it, renames a group, or drops the ignore rule
 * and nothing fails — so this test pins the config's *parsed structure*.
 *
 * The acceptance criterion asks for a "YAML/schema parse," not a regex: a
 * regex over the raw text passes on broken indentation that Dependabot would
 * reject. So we `yaml.load()` the file and assert on the parsed object,
 * order-insensitively. We never assert on raw text — comments, key order, and
 * reformatting must not break the guard.
 *
 * SCOPE / NEEDS VERIFICATION: this headless suite proves valid-YAML + v2
 * structural shape only. It CANNOT prove that GitHub's own Dependabot schema
 * parser accepts these field names, that grouping actually forms, or that
 * semver-major PRs are suppressed — those are post-merge, GitHub-side checks
 * recorded as needs-verification in the run log (charter off-suite policy).
 */

const CONFIG_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".github",
  "dependabot.yml",
);

// Minimal shape of the Dependabot v2 fields this guard inspects. Optional/loose
// where the schema is — we assert presence, not exhaustiveness.
interface DependabotGroup {
  patterns?: string[];
  "update-types"?: string[];
}

interface DependabotIgnore {
  "dependency-name"?: string;
  "update-types"?: string[];
}

interface DependabotUpdate {
  "package-ecosystem"?: string;
  directory?: string;
  schedule?: { interval?: string };
  groups?: Record<string, DependabotGroup>;
  ignore?: DependabotIgnore[];
}

interface DependabotConfig {
  version?: number;
  updates?: DependabotUpdate[];
}

function loadConfig(): DependabotConfig {
  // readFileSync throws ENOENT if the file does not exist (the FIRST-TEST red
  // state until T3 authors it); yaml.load throws on malformed YAML. Both are
  // genuine guard failures, not swallowed.
  const raw = readFileSync(CONFIG_PATH, "utf8");
  return yaml.load(raw) as DependabotConfig;
}

describe("SEC1 #137 — .github/dependabot.yml is valid YAML in the Dependabot v2 shape", () => {
  it("parses as a YAML object", () => {
    const config = loadConfig();
    expect(config).toBeTypeOf("object");
    expect(config).not.toBeNull();
  });

  it("declares version 2", () => {
    const config = loadConfig();
    expect(config.version).toBe(2);
  });

  it("has exactly two updates entries", () => {
    const config = loadConfig();
    expect(Array.isArray(config.updates)).toBe(true);
    expect(config.updates).toHaveLength(2);
  });

  it("covers exactly the npm and github-actions ecosystems", () => {
    const config = loadConfig();
    const ecosystems = new Set(
      (config.updates ?? []).map((u) => u["package-ecosystem"]),
    );
    expect(ecosystems).toEqual(new Set(["npm", "github-actions"]));
  });

  it("points every entry at the root directory '/'", () => {
    const config = loadConfig();
    for (const update of config.updates ?? []) {
      expect(update.directory).toBe("/");
    }
  });

  it("schedules every entry weekly", () => {
    const config = loadConfig();
    for (const update of config.updates ?? []) {
      expect(update.schedule?.interval).toBe("weekly");
    }
  });

  it("batches non-major updates: every entry has a named group whose update-types include both 'minor' and 'patch'", () => {
    const config = loadConfig();
    for (const update of config.updates ?? []) {
      const groups = update.groups ?? {};
      const groupNames = Object.keys(groups);
      // A named groups block is required (Dependabot groups are keyed by a
      // human-readable name that becomes the grouped PR title).
      expect(
        groupNames.length,
        `entry '${update["package-ecosystem"]}' must declare at least one named group`,
      ).toBeGreaterThan(0);

      const hasMinorAndPatch = groupNames.some((name) => {
        const updateTypes = groups[name]["update-types"] ?? [];
        return updateTypes.includes("minor") && updateTypes.includes("patch");
      });
      expect(
        hasMinorAndPatch,
        `entry '${update["package-ecosystem"]}' must have a named group batching both 'minor' and 'patch'`,
      ).toBe(true);
    }
  });

  it("ignores semver-major updates on every entry (majors deferred to epic H2)", () => {
    const config = loadConfig();
    for (const update of config.updates ?? []) {
      const ignore = update.ignore ?? [];
      const suppressesMajor = ignore.some((rule) =>
        (rule["update-types"] ?? []).includes("version-update:semver-major"),
      );
      expect(
        suppressesMajor,
        `entry '${update["package-ecosystem"]}' must ignore 'version-update:semver-major'`,
      ).toBe(true);
    }
  });
});
