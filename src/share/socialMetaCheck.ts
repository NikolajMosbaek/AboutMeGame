// F1 slice 1 (#129) — T6, Seam B: the PURE verdict core for the post-Build
// social-metadata check.
//
// This module DECIDES pass/fail over an already-built dist/index.html; it never
// touches the filesystem, `process`, `console`, or `process.exit`. The impure
// edge — reading the real `dist/` and exiting non-zero — lives solely in
// `scripts/check-social-meta.mjs` (`npm run check:social`). That two-file split
// (mirroring bundleSize.ts ↔ check-bundle-size.mjs) is what lets the committed
// Vitest test import this core and prove every assertion WITHOUT reading a real
// dist and WITHOUT ever firing a process exit that would kill the runner.
//
// Why this never runs inside `npm test`: a real-dist read would throw in
// deploy.yml, which runs `npm test` BEFORE `npm run build` on a gitignored dist.
// So the CLI wires in as a post-Build CI step (ci.yml), never into the test lane.
//
// Every expected string is single-sourced from socialMeta.ts (the T1 constants),
// so a rename of the image or a typo in the origin cannot pass this check while
// silently staling the fs.existsSync side, and vice versa.

import {
  SOCIAL_PREVIEW_FILENAME,
  socialImageHref,
  socialUrlHref,
} from "./socialMeta";

/** Input to the pure verdict: the built HTML as text, the list of file names
 *  emitted under dist/ (posix-relative), and the deploy base path (e.g.
 *  "/AboutMeGame/") the caller read from the build config. */
export interface SocialMetaInput {
  html: string;
  distFiles: string[];
  base: string;
}

/** The pass/fail verdict. `failures` is empty iff `ok` is true; each entry is a
 *  self-contained, actionable message printed VERBATIM by the CLI so the CI log
 *  and this contract cannot drift. */
export interface SocialMetaVerdict {
  ok: boolean;
  failures: string[];
}

/**
 * Extract the `content` value of a <meta> tag identified by its
 * `property="..."` (Open Graph) or `name="..."` (Twitter) attribute.
 *
 * Whitespace between attributes (including newlines from a multi-line tag) is
 * tolerated. `content` is matched regardless of attribute order — Vite may emit
 * the built tag with attributes in a different order than authored. Returns null
 * when the tag or its content attribute is absent (the caller turns that into a
 * loud "missing" failure, never a false pass).
 */
function metaContent(
  html: string,
  kind: "property" | "name",
  key: string,
): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta\\b[^>]*\\b${kind}=["']${escapedKey}["'][^>]*?\\bcontent=["']([^"']*)["']`,
    "s",
  );
  const m = html.match(re);
  return m ? m[1] : null;
}

/**
 * Decide whether a built `dist/index.html` carries correct, ABSOLUTE social
 * metadata and whether the preview asset was emitted alongside it.
 *
 * Enforced (all expected strings single-sourced from socialMeta.ts):
 *   - `social-preview.png` is present in `distFiles` (emitted into dist/),
 *   - `og:image` AND `twitter:image` each equal the absolute
 *     `https://<origin><base>social-preview.png` (so they start with `https://`
 *     and end with `/<base>social-preview.png`) — a path-only or absent href fails,
 *   - `og:url` equals the absolute canonical `https://<origin><base>`,
 *   - `twitter:card` === `summary_large_image` (never the un-upgraded `summary`).
 *
 * Never returns a false pass: a missing tag is a failure with an actionable
 * message, not a silent skip.
 */
export function checkSocialMeta(input: SocialMetaInput): SocialMetaVerdict {
  const { html, distFiles, base } = input;
  const failures: string[] = [];

  // 1. The preview asset must be emitted into dist/ (compare by basename so a
  //    nested/relative listing still matches the single-sourced filename).
  const emitted = distFiles.some(
    (f) => f.split("/").pop() === SOCIAL_PREVIEW_FILENAME,
  );
  if (!emitted) {
    failures.push(
      `${SOCIAL_PREVIEW_FILENAME} was not emitted into dist/ — it must sit in public/ so Vite copies it to the build root. Run npm run build and confirm public/${SOCIAL_PREVIEW_FILENAME} exists.`,
    );
  }

  const expectedImage = socialImageHref(base);
  const expectedUrl = socialUrlHref(base);

  // 2. og:image + twitter:image must be the ABSOLUTE origin-prefixed href.
  //    Crawlers do not resolve relative/path-only hrefs, so anything that is not
  //    the exact absolute string fails (path-only, wrong host, or missing).
  for (const [kind, key] of [
    ["property", "og:image"],
    ["name", "twitter:image"],
  ] as const) {
    const content = metaContent(html, kind, key);
    if (content === null) {
      failures.push(
        `${key} <meta> is missing from dist/index.html — the emitted href must be the absolute ${expectedImage}.`,
      );
    } else if (!content.startsWith("https://") || content !== expectedImage) {
      failures.push(
        `${key} is "${content}" — expected the absolute ${expectedImage} (must start with https://; unfurl crawlers do not resolve relative/path-only hrefs).`,
      );
    }
  }

  // 3. og:url must be the absolute canonical origin+base (no filename).
  const urlContent = metaContent(html, "property", "og:url");
  if (urlContent === null) {
    failures.push(
      `og:url <meta> is missing from dist/index.html — expected the absolute canonical ${expectedUrl}.`,
    );
  } else if (urlContent !== expectedUrl) {
    failures.push(
      `og:url is "${urlContent}" — expected the absolute canonical ${expectedUrl}.`,
    );
  }

  // 4. twitter:card must be upgraded to summary_large_image.
  const card = metaContent(html, "name", "twitter:card");
  if (card !== "summary_large_image") {
    failures.push(
      `twitter:card is "${card ?? "(missing)"}" — expected summary_large_image so the large preview renders on X/Twitter.`,
    );
  }

  return { ok: failures.length === 0, failures };
}
