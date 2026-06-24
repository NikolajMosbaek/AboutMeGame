import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { measureDist } from "./bundleSize.ts";
import type { MeasuredArtifact } from "./bundleBudget.ts";

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
