// F1 slice 1 (#129) — the single authoritative home for the social-preview
// asset's identity. Both the built-dist emit check and the fs.existsSync check
// consume THESE constants, so a rename of the file (or a typo in the origin)
// cannot pass one check while silently staling the other.
//
// Pure TS: no fs, no build, no globals. Import.meta.env.BASE_URL is NOT read
// here — the base path is passed in by the caller so this module stays testable
// and buildless.

// The committed preview image, sibling of favicon.svg under public/.
export const SOCIAL_PREVIEW_FILENAME = "social-preview.png";

// Per-image upper byte bound for public/social-preview.png. Visual-overhaul
// slice 7 replaced the flat, few-colour, low-poly vector card (~33 KB) with a
// REAL in-game screenshot (golden hour over the lagoon, sun disc + glint,
// clouds, textured terrain, real flora — `scripts/render-social-preview.mjs`),
// re-encoded to a 256-colour palette PNG at ~193 KB today; 300 KB gives
// headroom for re-generation variance while still failing a truly bloated /
// uncompressed re-export (a multi-MB accidental full-colour save). This is
// single-sourced HERE so the T3 identity test and the T4 byte-bound guard
// consume the same ceiling and cannot drift. The docs/perf-budget.md 6 MB
// total-payload cap sums the whole build (~3.8 MB today) and has multiple MB
// of headroom, so it cannot substitute for this per-image bound.
export const SOCIAL_PREVIEW_MAX_BYTES = 300 * 1024;

// The canonical deploy origin. Lowercase host, NO trailing slash. This literal
// is a deployment knob alongside VITE_BASE: a custom domain would change both
// this origin and the base path. Unfurl crawlers (Facebook/X/LinkedIn/Slack)
// do not resolve relative or path-only hrefs, so social hrefs must be absolute
// — this origin is deliberately prepended, and %BASE_URL% supplies only the
// path segment.
export const CANONICAL_ORIGIN = "https://nikolajmosbaek.github.io";

// Join CANONICAL_ORIGIN to a base path that is authored with both a leading and
// a trailing slash (Vite's BASE_URL contract, e.g. "/AboutMeGame/"). The origin
// carries no trailing slash and the base carries a leading one, so a plain
// concatenation yields exactly one separator.
function originPlusBase(base: string): string {
  return `${CANONICAL_ORIGIN}${base}`;
}

// The absolute href emitted for og:image / twitter:image.
export function socialImageHref(base: string): string {
  return `${originPlusBase(base)}${SOCIAL_PREVIEW_FILENAME}`;
}

// The absolute canonical href emitted for og:url (origin + base, no filename).
export function socialUrlHref(base: string): string {
  return originPlusBase(base);
}
