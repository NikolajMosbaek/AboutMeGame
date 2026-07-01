import { describe, expect, it } from "vitest";

import {
  CANONICAL_ORIGIN,
  SOCIAL_PREVIEW_FILENAME,
  SOCIAL_PREVIEW_MAX_BYTES,
  socialImageHref,
  socialUrlHref,
} from "./socialMeta";

/*
 * F1 slice 1 (#129) — T1: single-sourced social-metadata constants.
 *
 * One authoritative home for the preview filename and canonical origin, so the
 * built-dist emit check and the fs.existsSync check consume the SAME strings —
 * a rename of one cannot pass while the other stays stale. Pure TS: no fs, no
 * build, no globals.
 */
describe("socialMeta constants", () => {
  it("names the committed preview image exactly", () => {
    expect(SOCIAL_PREVIEW_FILENAME).toBe("social-preview.png");
  });

  it("pins the canonical origin: lowercase host, no trailing slash", () => {
    expect(CANONICAL_ORIGIN).toBe("https://nikolajmosbaek.github.io");
  });

  it("sets a per-image byte ceiling in the tens-of-KB range (the T4 byte-bound guard's single source)", () => {
    expect(SOCIAL_PREVIEW_MAX_BYTES).toBe(96 * 1024);
  });
});

describe("socialMeta compose helpers", () => {
  const base = "/AboutMeGame/";

  it("composes the absolute og:image / twitter:image href from origin + base + filename", () => {
    expect(socialImageHref(base)).toBe(
      "https://nikolajmosbaek.github.io/AboutMeGame/social-preview.png",
    );
  });

  it("composes the absolute canonical og:url from origin + base", () => {
    expect(socialUrlHref(base)).toBe("https://nikolajmosbaek.github.io/AboutMeGame/");
  });
});
