# Run log — F1 slice 1: social-preview card + absolute share metadata (#129)

Date: 2026-07-01
Branch: `feat/social-preview-meta-129`
Feature: close the "shared by a link" gap — commit one brand-consistent
1200x630 low-poly `social-preview.png` under `public/` (sibling of
`favicon.svg`) and wire it into `index.html` social metadata so the emitted
`og:image` / `twitter:image` / `og:url` hrefs are ABSOLUTE. Scope is metadata +
one image only.

## What shipped

- NEW `public/social-preview.svg` — the committed, regenerable source card
  (flat low-poly, brand tokens: bg `#14121f`, amber `#ffcb47`, island greens
  `#5b8f4a` / `#49753c`, lamp `#fff3d4`, amber-beacon-on-island motif; no
  photographic content).
- NEW `public/social-preview.png` — the 1200x630 rasterized card actually
  shipped as `og:image` (SVG `og:image` is unreliable across
  Facebook/X/LinkedIn/Slack crawlers).
- `index.html` — added `og:image`, `og:image:width` (1200), `og:image:height`
  (630), `twitter:image`, `og:url`; flipped `twitter:card` from `summary` to
  `summary_large_image`; deleted the stale comment about the missing `og:image`.
- Seam A (source, safe in `npm test`), Seam B (post-Build CLI `check:social`),
  and the CI-wiring guards — see the T-slices already landed on this branch.
- `src/share/socialMeta.ts` — single home for the asset identity
  (`SOCIAL_PREVIEW_FILENAME`) and the canonical origin literal.

## Measured `du -sh dist` delta vs the REAL 752K baseline

The baseline the issue cites (736K) is **stale**. The real pre-image `dist`
baseline is **752K**; a clean `du -sh dist` on this branch reports:

```
$ du -sh dist
792K	dist

$ ls -l dist/social-preview.png
-rw-r--r--  1  33747  dist/social-preview.png   # ~33 KB
```

- Measured total: **792K** (`du -sh dist`, block-rounded).
- The emitted image `dist/social-preview.png` is **33,747 bytes (~33 KB)**;
  `du` block-rounds it to 36K.
- **Delta = only the new image**: 792K − 756K (dist without the image) ≈ the
  card's ~33 KB (tens of KB). Nothing else in the build moved — this slice adds
  metadata text and one asset, no code.
- The 752K design baseline and the measured 756K (dist minus the image) agree
  to within block-rounding; either way the added weight is just the card.
- **Total payload stays well under the 6 MB cap** in `docs/perf-budget.md`
  (`≤ 6 MB` total initial download): 792K leaves ~5.2 MB of headroom, so the
  6 MB cap can never trip on a tens-of-KB per-image regression — which is why
  the per-image byte bound (`SOCIAL_PREVIEW_MAX_BYTES`, 96 KB) exists separately.

## Regenerate command (SVG → PNG, offline)

The PNG is regenerated from the committed SVG source with one command, run
by hand at authoring time (never at build or runtime):

```
node scripts/render-social-preview.mjs
```

This loads `public/social-preview.svg` into a headless Chromium page sized to
the exact 1200x630 unfurl frame and writes `public/social-preview.png`. It uses
the **already-present playwright devDependency** — **no new dependency and no
runtime dependency** is added; it is an **offline, authoring-time** step.

## AC1 — `%BASE_URL%` sources the path segment; emitted hrefs are ABSOLUTE

The social hrefs are authored as
`https://nikolajmosbaek.github.io%BASE_URL%social-preview.png` (and `og:url` as
`https://nikolajmosbaek.github.io%BASE_URL%`). At build, Vite substitutes
`%BASE_URL%` mid-string to `/AboutMeGame/`, emitting a fully **absolute** href.

- `%BASE_URL%` supplies **only the path segment** — it stays the single knob for
  the sub-path.
- The emitted `og:image` / `twitter:image` / `og:url` hrefs are **intentionally
  absolute**, because unfurl crawlers **do not resolve relative / path-only
  hrefs** — they fetch the literal `content` value with no page-relative base.
  So AC1's "%BASE_URL%-resolved" reads as "path segment sourced from
  `%BASE_URL%`, final emitted href absolute", never a path-only href.
- Verified live: a real `vite build` emits
  `https://nikolajmosbaek.github.io/AboutMeGame/social-preview.png` into
  `dist/index.html`, while a bare `%BASE_URL%favicon.svg` emits the path-only
  `/AboutMeGame/favicon.svg` — confirming `%BASE_URL%` sources only the path and
  the origin literal is prepended deliberately.

## Two deployment knobs

There are **two** deployment knobs that a redeploy (e.g. to a custom domain)
would have to change **together**:

1. **`VITE_BASE`** — the sub-path (`/AboutMeGame/`), the single source for the
   path segment via `%BASE_URL%`.
2. **The canonical-origin literal `https://nikolajmosbaek.github.io`** — the
   second knob, single-sourced as `CANONICAL_ORIGIN` in `src/share/socialMeta.ts`
   and prepended to make the share hrefs absolute. A **custom domain** would
   change **both** this origin and the base path; they are named here as the
   pair so a future move does not update one and stale the other.

## NEEDS VERIFICATION

- **Third-party unfurl render** — the actual social card as rendered by the
  **Facebook** Sharing Debugger, the **Twitter / X** Card Validator, the
  **LinkedIn** Post Inspector, and **Slack**'s link unfurl is **not asserted**
  by any automated gate here. CI validates the emitted metadata (Seam B parses
  the built `dist/index.html` for the absolute hrefs, dimensions, and
  `summary_large_image`) and that the PNG is emitted, but **CI cannot exercise
  third-party crawlers** — they are external, network-bound, and headless CI
  does not drive them. This item stays flagged NEEDS VERIFICATION until someone
  runs the four sharing debuggers against the deployed URL; it is **not proven**
  headless and this log makes no claim that it is.

## Guardrail scope

- Branch is fresh off `main` — NOT built on / rebased from the stale
  `feat/share-card-*` branches (wrong issue #54, `.claude/` churn).
- `git diff --name-only main...HEAD` touches only product code, `index.html`,
  `public/` assets, `scripts/`, tests, `.github/workflows/ci.yml`, and this run
  log — **no file under `.claude/` is created, edited, or deleted**.
- `npm test` and `npm run build` stay green; no new runtime dependency.
