import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * T3 regression lock for the index.html social-share meta block (#54 follow-up).
 *
 * A pasted AboutMeGame link must unfurl as a real product on Slack/iMessage/
 * LinkedIn/X/Discord. That requires a referenced raster og:image, a large
 * twitter card, and the dimension/type/alt/url hints scrapers read. This suite
 * locks the wiring: it asserts the meta invariants hold and that the stale
 * "No og:image is referenced" comment — which used to contradict the markup —
 * is gone. The image URL uses the `%BASE_URL%` token exactly as favicon.svg.
 */
const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

const metaProp = (prop: string): string | undefined =>
  html.match(
    new RegExp(`<meta\\s+property="${prop}"\\s+content="([^"]*)"`),
  )?.[1];

const metaName = (name: string): string | undefined =>
  html.match(new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`))?.[1];

describe("index.html share metadata", () => {
  it("references the raster share card via og:image using %BASE_URL%", () => {
    const ogImage = metaProp("og:image");
    expect(ogImage).toBeDefined();
    expect(ogImage).toBe("%BASE_URL%share-card.png");
    expect(ogImage?.endsWith("share-card.png")).toBe(true);
  });

  it("references the raster share card via twitter:image using %BASE_URL%", () => {
    const twitterImage = metaName("twitter:image");
    expect(twitterImage).toBeDefined();
    expect(twitterImage).toBe("%BASE_URL%share-card.png");
    expect(twitterImage?.endsWith("share-card.png")).toBe(true);
  });

  it("upgrades the twitter card to summary_large_image", () => {
    expect(metaName("twitter:card")).toBe("summary_large_image");
  });

  it("declares og:image dimensions matching the committed pixels", () => {
    expect(metaProp("og:image:width")).toBe("1200");
    expect(metaProp("og:image:height")).toBe("630");
  });

  it("declares the og:image type as image/png", () => {
    expect(metaProp("og:image:type")).toBe("image/png");
  });

  it("provides og:image:alt describing the card", () => {
    const alt = metaProp("og:image:alt");
    expect(alt).toBeDefined();
    expect(alt?.length).toBeGreaterThan(0);
  });

  it("declares og:url so relative images resolve to an absolute target", () => {
    const ogUrl = metaProp("og:url");
    expect(ogUrl).toBeDefined();
    expect(ogUrl?.length).toBeGreaterThan(0);
  });

  it("no longer contains the stale 'No og:image is referenced' comment", () => {
    expect(html).not.toMatch(/No og:image is referenced/);
  });
});
