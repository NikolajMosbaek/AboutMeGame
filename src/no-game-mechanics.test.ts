// Guard test (T10): the bootstrap ships a static title screen ONLY. No game
// mechanics may exist anywhere in the src tree — no players, prompts, rounds,
// lobby, scoring, or persistence code. If a later run starts a vertical slice,
// it does so on its own branch with its own tests; this test fails loudly if
// game-mechanic identifiers leak into the bootstrap source.
//
// The whole src tree is loaded via import.meta.glob(..., as: "raw") so the test
// reads the real committed files without a Node-fs dependency (consistent with
// the charter/backlog doc-as-contract tests). The vision *copy* legitimately
// contains words like "prompts" and "guessing"; those live in comments and in
// the VISION string literal, which we strip before scanning so we match game
// *code* (identifiers), not prose.

// Eagerly load every source file in src/ as raw text, keyed by path.
const sources = import.meta.glob("./**/*.{ts,tsx}", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

// Test files are allowed to name the mechanics (this file does). Exclude them
// and type-declaration shims; we are scanning the *product* source.
const isProductSource = (path: string): boolean =>
  !/\.(test|spec)\.[tj]sx?$/.test(path) && !path.endsWith(".d.ts");

// Strip line comments, block comments, and string/template literals so the
// scan sees identifiers and keywords in real code, not prose or copy.
const stripCommentsAndStrings = (code: string): string =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/\/\/[^\n]*/g, " ") // line comments
    .replace(/"(?:\\.|[^"\\])*"/g, '""') // double-quoted strings
    .replace(/'(?:\\.|[^'\\])*'/g, "''") // single-quoted strings
    .replace(/`(?:\\.|[^`\\])*`/g, "``"); // template literals

// Game-mechanic terms. Word-boundary anchored, case-insensitive, matched
// against code with comments and string literals removed.
const MECHANIC_TERMS: ReadonlyArray<readonly [string, RegExp]> = [
  ["player(s)", /\bplayers?\b/i],
  ["prompt(s)", /\bprompts?\b/i],
  ["round(s)", /\brounds?\b/i],
  ["lobby", /\blobb(y|ies)\b/i],
  ["scoring/score", /\bscor(e|es|ing|ed|eboard)\b/i],
  ["persistence/persist", /\bpersist\w*\b/i],
  ["guess", /\bguess\w*\b/i],
];

const productSourcePaths = Object.keys(sources).filter(isProductSource);

describe("no game mechanics in the bootstrap src tree", () => {
  it("loads the product source tree (sanity: there is something to scan)", () => {
    expect(productSourcePaths.length).toBeGreaterThan(0);
  });

  it.each(MECHANIC_TERMS)(
    "contains no %s identifier in any product source file",
    (_label, pattern) => {
      const offenders = productSourcePaths.filter((path) =>
        pattern.test(stripCommentsAndStrings(sources[path])),
      );
      expect(offenders).toEqual([]);
    },
  );
});

describe("src/version.ts is a build-stamp / VISION seam only", () => {
  const versionEntry = Object.entries(sources).find(([path]) =>
    path.endsWith("/version.ts"),
  );

  it("exists in the source tree", () => {
    expect(versionEntry).toBeDefined();
  });

  const versionSource = versionEntry?.[1] ?? "";

  it("exports exactly APP_VERSION and VISION — nothing more", () => {
    const exportedNames = [...versionSource.matchAll(/export\s+const\s+(\w+)/g)]
      .map((m) => m[1])
      .sort();
    expect(exportedNames).toEqual(["APP_VERSION", "VISION"]);
  });

  it("declares no additional top-level exports (no function/class/default)", () => {
    const code = stripCommentsAndStrings(versionSource);
    expect(code).not.toMatch(/export\s+default\b/);
    expect(code).not.toMatch(/export\s+(function|class|async|let|var)\b/);
  });
});
