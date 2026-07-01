import { describe, expect, it } from "vitest";

import { checkSocialMeta } from "./socialMetaCheck";

/*
 * F1 slice 1 (#129) — T6, Seam B: the PURE verdict core the post-Build CLI
 * (scripts/check-social-meta.mjs, `npm run check:social`) delegates to.
 *
 * This module has NO fs edge — it takes the built dist/index.html AS A STRING
 * plus the set of emitted dist file names, and returns a pass/fail verdict. The
 * CLI is the only thing that reads the real dist/ and exits non-zero; keeping
 * the decision here means this test can prove every assertion without touching a
 * real dist and without ever firing a process exit (mirrors the bundleSize /
 * bundleBudget two-file split).
 *
 * The verdict enforces (single-sourced from socialMeta.ts constants):
 *   - social-preview.png is emitted into dist/,
 *   - og:image AND twitter:image both start with https:// and end with
 *     /AboutMeGame/social-preview.png,
 *   - og:url === https://nikolajmosbaek.github.io/AboutMeGame/,
 *   - twitter:card === summary_large_image.
 */

const BASE = "/AboutMeGame/";
const IMAGE_HREF = "https://nikolajmosbaek.github.io/AboutMeGame/social-preview.png";
const URL_HREF = "https://nikolajmosbaek.github.io/AboutMeGame/";

/** A well-formed built dist/index.html (post-Vite-substitution) with absolute
 *  hrefs, matching what `vite build` emits from the authored origin-prefix
 *  template. */
function goodHtml(): string {
  return [
    "<!doctype html>",
    '<html lang="en"><head>',
    '<meta property="og:type" content="website" />',
    `<meta property="og:url" content="${URL_HREF}" />`,
    `<meta property="og:image" content="${IMAGE_HREF}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:image" content="${IMAGE_HREF}" />`,
    "</head><body></body></html>",
  ].join("\n");
}

/** The dist file set that a healthy build emits — the preview image is present. */
function goodDistFiles(): string[] {
  return ["index.html", "favicon.svg", "social-preview.png", "assets/index-abc123.js"];
}

describe("checkSocialMeta — pure Seam B verdict core (F1 #129 T6)", () => {
  it("passes on correct absolute hrefs, upgraded card, and emitted asset", () => {
    const verdict = checkSocialMeta({
      html: goodHtml(),
      distFiles: goodDistFiles(),
      base: BASE,
    });

    expect(verdict.ok).toBe(true);
    expect(verdict.failures).toEqual([]);
  });

  it("fails loud with an actionable message when the preview asset is not emitted", () => {
    const verdict = checkSocialMeta({
      html: goodHtml(),
      distFiles: ["index.html", "favicon.svg", "assets/index-abc123.js"],
      base: BASE,
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.failures.some((m) => m.includes("social-preview.png"))).toBe(true);
    // The message names the emit gap so the fix is obvious in a bare CI log.
    expect(verdict.failures.join("\n")).toMatch(/not emitted|missing/i);
  });

  it("fails on a path-only (non-absolute) og:image href", () => {
    const html = goodHtml().replace(IMAGE_HREF, "/AboutMeGame/social-preview.png");
    const verdict = checkSocialMeta({ html, distFiles: goodDistFiles(), base: BASE });

    expect(verdict.ok).toBe(false);
    expect(verdict.failures.some((m) => /og:image/i.test(m))).toBe(true);
    expect(verdict.failures.join("\n")).toMatch(/https:\/\//);
  });

  it("fails on a path-only (non-absolute) twitter:image href", () => {
    const html = goodHtml().replace(
      `<meta name="twitter:image" content="${IMAGE_HREF}" />`,
      '<meta name="twitter:image" content="/AboutMeGame/social-preview.png" />',
    );
    const verdict = checkSocialMeta({ html, distFiles: goodDistFiles(), base: BASE });

    expect(verdict.ok).toBe(false);
    expect(verdict.failures.some((m) => /twitter:image/i.test(m))).toBe(true);
  });

  it("fails on a wrong og:url (not the canonical origin+base)", () => {
    const html = goodHtml().replace(
      `<meta property="og:url" content="${URL_HREF}" />`,
      '<meta property="og:url" content="/AboutMeGame/" />',
    );
    const verdict = checkSocialMeta({ html, distFiles: goodDistFiles(), base: BASE });

    expect(verdict.ok).toBe(false);
    expect(verdict.failures.some((m) => /og:url/i.test(m))).toBe(true);
  });

  it("fails when twitter:card is still the un-upgraded summary", () => {
    const html = goodHtml().replace("summary_large_image", "summary");
    const verdict = checkSocialMeta({ html, distFiles: goodDistFiles(), base: BASE });

    expect(verdict.ok).toBe(false);
    expect(verdict.failures.some((m) => /twitter:card/i.test(m))).toBe(true);
    expect(verdict.failures.join("\n")).toMatch(/summary_large_image/);
  });

  it("fails when a social meta tag is missing entirely (returns an actionable message, never a false pass)", () => {
    const html = goodHtml().replace(
      `<meta property="og:image" content="${IMAGE_HREF}" />`,
      "",
    );
    const verdict = checkSocialMeta({ html, distFiles: goodDistFiles(), base: BASE });

    expect(verdict.ok).toBe(false);
    expect(verdict.failures.some((m) => /og:image/i.test(m))).toBe(true);
  });
});
