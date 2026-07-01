import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * F1 slice 1 (#129) — T5, Seam A: pure-string assertions over the AUTHORED
 * index.html template. Safe in `npm test` (no build, no dist read) — mirrors
 * tokens.css.test.ts, which reads a source file as text.
 *
 * The crux is the origin-prefix pattern: social hrefs are authored as
 * `https://nikolajmosbaek.github.io%BASE_URL%social-preview.png` so Vite
 * substitutes %BASE_URL% mid-string to the sub-path at build, emitting a fully
 * ABSOLUTE href while %BASE_URL% stays the single knob for ONLY the path
 * segment. Unfurl crawlers (Facebook/X/LinkedIn/Slack) do not resolve
 * relative/path-only hrefs, so the origin literal is prepended deliberately.
 *
 * The BUILT-dist absolute-href/emit check lives in the post-Build CLI lane
 * (Seam B), never here — a Vitest read of real dist/ would throw in deploy.yml,
 * which runs `npm test` BEFORE the build.
 */

const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

/**
 * Extract the `content` value of a <meta> tag identified by its
 * `property="..."` (Open Graph) or `name="..."` (Twitter) attribute. Whitespace
 * (including newlines between attributes) is tolerated so a multi-line tag still
 * matches. Returns null when the tag or its content is absent.
 */
function metaContent(kind: "property" | "name", key: string): string | null {
  const re = new RegExp(
    `<meta[^>]*\\b${kind}=["']${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*?\\bcontent=["']([^"']*)["']`,
    "s",
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

describe("index.html social metadata — authored origin-prefix template (F1 #129 T5)", () => {
  it("og:image content is the absolute origin-prefixed pattern (%BASE_URL% sources only the path)", () => {
    expect(metaContent("property", "og:image")).toMatch(
      /^https:\/\/nikolajmosbaek\.github\.io%BASE_URL%social-preview\.png$/,
    );
  });

  it("twitter:image content is the absolute origin-prefixed pattern", () => {
    expect(metaContent("name", "twitter:image")).toMatch(
      /^https:\/\/nikolajmosbaek\.github\.io%BASE_URL%social-preview\.png$/,
    );
  });

  it("og:url content is the absolute canonical origin+base (no filename)", () => {
    expect(metaContent("property", "og:url")).toMatch(
      /^https:\/\/nikolajmosbaek\.github\.io%BASE_URL%$/,
    );
  });

  it("og:image:width is 1200 and og:image:height is 630", () => {
    expect(metaContent("property", "og:image:width")).toBe("1200");
    expect(metaContent("property", "og:image:height")).toBe("630");
  });

  it("twitter:card is upgraded to summary_large_image", () => {
    expect(metaContent("name", "twitter:card")).toBe("summary_large_image");
  });

  it("the stale 'No og:image is referenced' comment is deleted", () => {
    expect(html).not.toMatch(/No\s+og:image\s+is\s+referenced/i);
  });
});
