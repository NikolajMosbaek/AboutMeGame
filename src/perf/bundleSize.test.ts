import { afterEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatReport, measureDist } from "./bundleSize.ts";
import type { BundleVerdict, MeasuredArtifact } from "./bundleBudget.ts";

// This suite proves the I/O contract of the impure measurer in isolation: it
// writes a temp fixture `dist` tree, measures it, and asserts the
// classification / gzip / exclusion rules. It imports the PURE core only — never
// the CLI `.mjs` — so importing this file can never fire a main()/process.exit
// and kill the runner. The byte-level math (the /1000 divisor, the cap compare)
// is owned by bundleBudget.ts and proven in bundleBudget.test.ts; here we only
// prove that measureDist hands the right shape and raw bytes.

const tmpRoots: string[] = [];

/** Make an isolated scratch `dist` root that is cleaned up after each test. */
function makeFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bundle-size-fixture-"));
  tmpRoots.push(root);
  return root;
}

function find(
  artifacts: MeasuredArtifact[],
  name: string,
): MeasuredArtifact | undefined {
  return artifacts.find((a) => a.name === name);
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop()!;
    rmSync(root, { recursive: true, force: true });
  }
});

describe("measureDist", () => {
  it("classifies a JS chunk and an HTML entry doc, gzips them, and excludes .map siblings", () => {
    const root = makeFixtureRoot();
    mkdirSync(join(root, "assets"), { recursive: true });

    // A repetitive JS chunk so gzip clearly shrinks it (gzipBytes < rawBytes).
    const jsBody = `console.log("about me");\n`.repeat(400);
    writeFileSync(join(root, "assets", "index-abc123.js"), jsBody);
    // Its source map sibling — emitted-or-not, it must be excluded BEFORE
    // classifying so it never inflates the JS sum or the total download.
    writeFileSync(join(root, "assets", "index-abc123.js.map"), "{}".repeat(5000));
    // An HTML entry doc at the dist root (NOT under assets) — recursion needed.
    writeFileSync(
      join(root, "index.html"),
      `<!doctype html><html><body>${"x".repeat(2000)}</body></html>`,
    );

    const artifacts = measureDist(root);

    const js = find(artifacts, "assets/index-abc123.js");
    expect(js).toBeDefined();
    expect(js!.kind).toBe("js");
    expect(js!.rawBytes).toBe(Buffer.byteLength(jsBody));
    // Text/code ships gzipped: the wire size must be smaller than the raw size.
    expect(js!.gzipBytes).toBeLessThan(js!.rawBytes);
    expect(js!.gzipBytes).toBeGreaterThan(0);

    const html = find(artifacts, "index.html");
    expect(html).toBeDefined();
    expect(html!.kind).toBe("text");
    expect(html!.gzipBytes).toBeLessThan(html!.rawBytes);

    // The .map is excluded entirely — by name and by count of source-map files.
    expect(find(artifacts, "assets/index-abc123.js.map")).toBeUndefined();
    expect(artifacts.some((a) => a.name.endsWith(".map"))).toBe(false);
    expect(artifacts).toHaveLength(2);
  });
});

describe("measureDist fail-loud", () => {
  // The empty/false-green hole the gate exists to close: a missing or stale
  // `dist/` must NOT measure as an in-budget 0/0 artifact list. Returning an
  // empty list would let `checkBundleBudget([])` report `overBudget: false`
  // and turn the CI step permanently green regardless of the real bundle. So
  // measureDist throws a clear, actionable Error the CLI can surface as a clean
  // non-zero exit (not a raw ENOENT stack).

  it("throws an actionable build-pointing error when the dist root is absent", () => {
    // A path that cannot exist on disk — never created by makeFixtureRoot, so
    // no cleanup is needed.
    expect(() => measureDist("a/path/that/does/not/exist")).toThrow(
      /run npm run build/i,
    );
  });

  it("throws when the dist tree has no JS chunks (stale/unbuilt), excluding the false-green 0/0 list", () => {
    const root = makeFixtureRoot();
    // A built page can leave non-JS files; a tree with ONLY a stylesheet and an
    // HTML doc (zero `.js`) signals a stale or never-built dist — the gate must
    // refuse it rather than report it as within budget.
    writeFileSync(join(root, "index.html"), "<!doctype html><html></html>");
    writeFileSync(join(root, "styles.css"), "body{margin:0}");

    expect(() => measureDist(root)).toThrow(/run npm run build/i);
  });
});

describe("formatReport", () => {
  // formatReport renders the human-facing measured-vs-cap delta table. It is
  // display-only: the cap column (400 KB / 6000 KB) is read from PERF_BUDGET in
  // perfBudget.ts, NOT hard-coded here and NOT re-derived — it never re-runs the
  // measured > cap comparison, which lives solely in checkBundleBudget. The
  // table prints on BOTH pass and fail so a creeping regression's shrinking
  // headroom is visible run-over-run rather than a silent green gate.

  it("prints the measured-vs-cap table with the budget caps and a 'within budget' token on a PASS", () => {
    // overBudget:false ⇒ no breaches; the caps must still be shown so the reader
    // sees the headroom. The cap values come from PERF_BUDGET (maxJsGzipKb 400,
    // maxInitialDownloadKb 6000), proving the display column is single-sourced.
    const verdict: BundleVerdict = {
      jsGzipKb: 201.9,
      initialDownloadKb: 207.1,
      overBudget: false,
      breaches: [],
    };

    const report = formatReport(verdict);

    expect(report).toContain("/ 400 KB");
    expect(report).toContain("/ 6000 KB");
    expect(report).toContain("within budget");
    // The measured side of each row is rendered too, so the table is legible.
    expect(report).toContain("201.9 KB");
    expect(report).toContain("207.1 KB");
    // A PASS must never claim it is over budget.
    expect(report).not.toContain("over budget");
  });

  it("appends each breach message verbatim and shows an 'over budget' token on a FAIL", () => {
    // The breach message is authored once, in checkBundleBudget, and must reach
    // the CI log unrephrased so the contract and the shell output cannot drift.
    const jsBreachMessage =
      "JS gzip 412.3 KB > cap 400 KB (over by 12.3 KB)";
    const verdict: BundleVerdict = {
      jsGzipKb: 412.3,
      initialDownloadKb: 418.0,
      overBudget: true,
      breaches: [
        {
          metric: "jsGzip",
          measuredKb: 412.3,
          capKb: 400,
          overByKb: 12.3,
          message: jsBreachMessage,
        },
      ],
    };

    const report = formatReport(verdict);

    expect(report).toContain(jsBreachMessage);
    expect(report).toContain("over budget");
    // The cap table still renders on a FAIL.
    expect(report).toContain("/ 400 KB");
    expect(report).toContain("/ 6000 KB");
  });
});

// --- Single-source guard (T4) ---------------------------------------------
//
// The whole point of slice 2 is that caps, the byte→KB divisor, and the
// pass/fail comparison live in ONE place (perfBudget.ts + bundleBudget.ts) and
// the new tooling only measures and delegates. If the tool ever grows its own
// `400`/`6000` literal or re-implements a `measured > cap` test, the gate could
// silently disagree with the source of truth — a green-here/red-there trap. So
// this guard reads the new tooling AS TEXT and asserts:
//   1. neither the pure core nor the CLI holds a literal cap (400 / 6000);
//   2. neither re-implements a measured-vs-cap comparison;
//   3. the core delegates the verdict to checkBundleBudget;
//   4. the core references PERF_BUDGET — which is the LEGITIMATE, display-only
//      source of the cap column on the pass path. The guard must NOT mistake
//      that import for a re-implemented cap, so it greps for literal caps and a
//      comparison, never for the PERF_BUDGET token itself.

const thisDir = dirname(fileURLToPath(import.meta.url));
const CORE_PATH = join(thisDir, "bundleSize.ts");
const CLI_PATH = join(thisDir, "..", "..", "scripts", "check-bundle-size.mjs");

/** Strip line comments and block (incl. JSDoc) comments so the guard scans
 *  executable CODE only. Without this the `measured >` prose in bundleSize.ts'
 *  own JSDoc would false-positive the comparison check, and a `400 KB` example
 *  in a comment would false-positive the literal-cap check. Comparisons that
 *  matter live in code, not prose. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments incl. JSDoc
    .replace(/(^|[^:])\/\/.*$/gm, "$1"); // line comments (not URLs like http://)
}

/** A measured-vs-cap relational comparison: a relational operator (`<`, `>`,
 *  `<=`, `>=`) with a measured-KB-ish token on one side and a cap/max/budget
 *  token on the other (in either order). This is exactly the re-implemented
 *  decision the slice forbids; it deliberately does NOT match the `=>` arrow,
 *  the `Generator<…>`/JSX generics, or the legitimate `cap - measured` headroom
 *  subtraction (which is `-`, not a relational operator). */
const MEASURED = String.raw`[A-Za-z_$][\w$]*(?:[Kk][Bb]|[Bb]ytes|measured|size)[\w$]*`;
const CAP = String.raw`[A-Za-z_$][\w$.]*(?:max|cap|budget|PERF_BUDGET)[\w$.]*`;
const REL = String.raw`(?:<=?|>=?)`;
const COMPARISON_PATTERNS = [
  new RegExp(`${MEASURED}\\s*${REL}\\s*${CAP}`, "i"),
  new RegExp(`${CAP}\\s*${REL}\\s*${MEASURED}`, "i"),
];

const cliExists = existsSync(CLI_PATH);

describe("single-source guard: the tooling never duplicates caps or the comparison (T4)", () => {
  // The CLI is the only impure edge and is delivered by a later task in this
  // same slice. While it is absent this guard scans the pure core only and
  // skips the CLI text-checks with a visible reason — it never silently passes:
  // the moment scripts/check-bundle-size.mjs lands, every CLI assertion below
  // activates, and CI's `npm run check:bundle` step fails loud if the file is
  // missing, so the "gate cannot be absent" guarantee is enforced end-to-end.
  it.skipIf(cliExists)(
    "[pending CLI task] scripts/check-bundle-size.mjs not yet committed — CLI text-checks below skip until it lands",
    () => {
      expect(cliExists).toBe(false);
    },
  );

  it("neither the pure core nor the CLI holds a literal cap (400 / 6000)", () => {
    for (const path of [CORE_PATH, CLI_PATH]) {
      if (!existsSync(path)) continue; // CLI scanned once the later task lands
      const code = stripComments(readFileSync(path, "utf8"));
      // Word boundaries so `4000`/`60000`/`14002` would NOT match, but the bare
      // caps `400` and `6000` would. The caps belong solely to perfBudget.ts.
      expect(code, `${path} must not hard-code the 400 KB cap`).not.toMatch(
        /\b400\b/,
      );
      expect(code, `${path} must not hard-code the 6000 KB cap`).not.toMatch(
        /\b6000\b/,
      );
    }
  });

  it("neither the pure core nor the CLI re-implements a measured-vs-cap comparison", () => {
    for (const path of [CORE_PATH, CLI_PATH]) {
      if (!existsSync(path)) continue; // CLI scanned once the later task lands
      const code = stripComments(readFileSync(path, "utf8"));
      for (const pattern of COMPARISON_PATTERNS) {
        expect(
          code,
          `${path} must delegate the verdict to checkBundleBudget, not compare measured>cap itself`,
        ).not.toMatch(pattern);
      }
    }
  });

  it("the comparison guard's own pattern actually catches a re-implemented compare (meta-check)", () => {
    // A guard that can never fire is worthless. Prove the pattern matches the
    // forbidden shapes (in both operand orders) and tolerates the legitimate
    // ones it must leave alone.
    const forbidden = [
      "if (jsGzipKb > budget.maxJsGzipKb) {",
      "return measuredKb >= PERF_BUDGET.maxInitialDownloadKb;",
      "if (PERF_BUDGET.maxJsGzipKb < totalGzipBytes) fail();",
    ];
    for (const sample of forbidden) {
      expect(
        COMPARISON_PATTERNS.some((p) => p.test(sample)),
        `pattern should flag: ${sample}`,
      ).toBe(true);
    }
    const allowed = [
      "const headroomKb = capKb - measuredKb;", // subtraction, not relational
      "for (const breach of verdict.breaches) {",
      "function* walkFiles(dir: string): Generator<string> {", // generic
      "if (!artifacts.some((a) => a.kind === \"js\")) {", // arrow
      "import { PERF_BUDGET } from \"./perfBudget.ts\";", // legit display import
    ];
    for (const sample of allowed) {
      expect(
        COMPARISON_PATTERNS.some((p) => p.test(sample)),
        `pattern should NOT flag: ${sample}`,
      ).toBe(false);
    }
  });

  it("the pure core delegates by importing PERF_BUDGET for the display cap column (legitimate, not a duplicated cap)", () => {
    const core = readFileSync(CORE_PATH, "utf8");
    // The import is REQUIRED — formatReport reads PERF_BUDGET.maxJsGzipKb /
    // maxInitialDownloadKb to render the `/ cap` column on the pass path, where
    // the verdict carries no cap field. The single-source grep above must
    // tolerate this; here we assert it is present and used.
    expect(core).toMatch(/import\s*\{[^}]*\bPERF_BUDGET\b[^}]*\}\s*from\s*["']\.\/perfBudget\.ts["']/);
    expect(core).toMatch(/PERF_BUDGET\.maxJsGzipKb/);
    expect(core).toMatch(/PERF_BUDGET\.maxInitialDownloadKb/);
  });
});
