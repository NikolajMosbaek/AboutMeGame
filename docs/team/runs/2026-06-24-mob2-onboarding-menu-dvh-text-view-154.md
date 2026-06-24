# Run log — MOB2 #154 (epic #149): onboarding/menu sized from `dvh`, `.text-view` back link cleared of the home indicator

Date: 2026-06-24
Branch: `mob2-154-onboarding-menu-dvh`
Feature: A **CSS-only** pass in `src/tokens.css` that closes exactly the two
reachability gaps MOB1 left, plus the coupled test edits that pin the old
behaviour:

1. **`.text-view` safe-area bottom** — the full-bleed scrolling text page
   (`position: fixed; inset: 0; overflow-y: auto`) whose only end-of-document
   dismiss control, the `.text-view__footer` back link
   (`TextView.tsx:67-71`, last in-flow child), could strand under the home
   indicator because the rule carried no safe-area bottom term. Fix: keep
   `padding: var(--space-4) var(--space-3);` for top/sides and add a SEPARATE
   longhand `padding-bottom: max(var(--space-4), calc(var(--space-4) +
   var(--safe-bottom)));` (`tokens.css:~900`). NO `max-height` — it is a
   scrolling page, not a centred dialog.
2. **`.onboarding,.menu` dvh caps** — the two shared overlay caps still on raw
   `vh` (`max-height: 92vh` at `@media (max-width: 480px)`; `max-height: 96vh`
   at `@media (max-height: 480px)`) converted to
   `calc(var(--vh-dynamic) * 0.92)` and `* 0.96`, mirroring the sibling
   `.reveal-panel` rules in those same blocks. `--vh-dynamic` carries its own
   `100vh -> 100dvh @supports` fallback (`:52`, `:61-65`), so the token IS
   fallback-first; no per-rule duplicate vh line.

The stale in-media comments (`~:1039-1040` and `~:1115-1117`) that claimed
`.onboarding/.menu` were "out of scope and stay on vh" were updated in the same
diff so source and comment agree.

This is MOB2 #154 (epic #149). It rides MOB1's already-shipped token layer
(`--safe-*` and `--vh-dynamic` in `:root`); it adds no new token and no new
dependency. **CSS-only; reposition/resize, never restyle.** No JS, no assets, no
DOM, no ARIA / z-index / type-scale change.

## T7 scope (this deliverable)

This log records the **measured perf-budget delta** and the **on-device
NEEDS-VERIFICATION** gap for the slice. The CSS + coupled-test edits already
landed in commits `46af07c` (RED guard), `71431db` (`.text-view`), `b1df813`
(onboarding/menu dvh), and `f65cfbd` (MOB1 blast-radius guard). The build itself
is the gate: a `vite build` exit-0 with a measured byte delta. T7's guard test
is `src/tokens.mob2.dvh.runlog.test.ts` — a presence/honesty lint over this log
(a bundle-size delta cannot be re-derived from any runtime expression, so it
pins that the measurement was performed and recorded, never asserting a delta in
jsdom).

## Measured build delta — `npm run build` exits 0

Measured branch (HEAD `f65cfbd`) vs a clean `main` (`f641e21`) — two builds:
the branch via `npm run build` (tsc `--noEmit` + `vite build`, exit 0), `main`
via `npx vite build` in a detached worktree sharing the repo's installed
`node_modules` (same `package-lock.json`, no network). Raw bytes via `wc -c`;
gzip reproducibly via `gzip -9 -c <file> | wc -c`.

| chunk | `main` raw | `main` gzip-9 | branch raw | branch gzip-9 | delta |
|-------|-----------:|--------------:|-----------:|--------------:|------:|
| entry `index-*.js` | 229,197 | 75,649 | 229,197 | 75,649 | **0 — byte-identical** |
| vendor `three-*.js` | 500,276 | 124,649 | 500,276 | 124,649 | **0 — byte-identical** |
| `index-*.css` | 17,470 | 3,737 | 17,541 | 3,750 | **+71 raw bytes / +13 gzip bytes** |
| `index.html` | 2,063 | — | 2,063 | — | 0 raw (only the embedded CSS-asset hash string differs) |

- **JS / asset delta is ~0.** Both JS chunks are **byte-identical** between
  `main` and the branch — confirmed with a direct content diff of the entry
  chunk and the `three` vendor chunk (the vendor chunk even shares the same
  content hash `COLka6mN` across both trees). No JS, no DOM, no asset was
  touched, so there is nothing for them to move.
- **CSS GROWS a few hundred authored bytes — explicitly NOT "zero bytes".** The
  source CSS grew **+71 raw bytes** (`17,470 -> 17,541`; **+13 gzip bytes**) from
  the separate `.text-view` `padding-bottom` longhand, the two `vh -> dvh calc`
  conversions, and the updated in-media comments. Reported honestly: the CSS
  side is **not literally zero bytes**, it is a few hundred authored bytes (here,
  a small +71 raw). This is the expected, designed outcome.
- **Within `docs/perf-budget.md`.** First-load JS gzip is **~200.3 KB**
  (entry 75.6 KB + `three` vendor 124.6 KB), unchanged and well **within** the
  **400 KB gzip** JS cap. Total initial download is far under the 6 MB ceiling.
  CSS (3.75 KB gzip) is trivial against any budget line. PASS.

vite's own build report (branch, lighter gzip level than `gzip -9`, for
cross-reference):

```
dist/index.html                   2.05 kB │ gzip:   0.84 kB
dist/assets/index-CEEfcEHH.css   17.54 kB │ gzip:   3.74 kB
dist/assets/index-EMvADo4m.js   229.10 kB │ gzip:  75.83 kB   <- entry chunk
dist/assets/three-COLka6mN.js   500.28 kB │ gzip: 125.83 kB   <- vendor chunk (untouched)
✓ built in 652ms
```

## Test baseline — fully green, NO red-allowance (DEC7)

`npm test` is **fully green: 678/678 passing across 77 files** on the committed
branch tree (this run adds T7's run-log lint on top). No red carried in, none
introduced.

The brief's quoted "known pre-existing red" at
`src/world/dayCycle.scope.test.ts` is **FICTION** — that file **does not exist**
in the tree (confirmed absent). There is **no red-allowance**: the gate is 100%
green and any red is a real regression (guardrail 4). The coupled token suite
that pins the dvh/safe-area behaviour is green after the four required
assertion flips (DEC5):

- `src/tokens.css.test.ts:102` and `:114` — flipped from `/max-height:\s*92vh/`
  and `/96vh/` to the `calc(var(--vh-dynamic) * 0.92|0.96)` form, comments
  updated.
- `src/tokens.safeArea.quality.test.ts:139` and `:150` — same flip, comments
  updated.

The tech-lead position flagged only the 2 in `tokens.css.test.ts`; verification
found **4 across 2 files**. Skipping any one would make `npm test` red and the
green-only-merge gate would block. The negative guards in those files
(`not.toMatch(/max-height/)` on the grouped width/padding rule;
`.reveal-panel`-scoped `not.toMatch(/\d+vh/)`) stay green — they are scoped away
from the converting caps.

## What did NOT change (MOB1 surfaces + scope holds)

- MOB1-shipped surfaces are byte-unchanged: `.reveal-panel` base (`:418`),
  `.completion-panel` base (`:545`), the `.reveal-panel` media caps (`:1056`,
  `:1130`), and both backdrops' `--safe-bottom` (`:410-411`, `:538-539`).
- The width-only `.onboarding` (`:748`) / `.menu` (`:805`) base rules gained NO
  invented `max-height`.
- `.text-view` gained NO `max-height` (guarded as a negative in
  `tokens.mob2.dvh.css.test.ts`); the desktop `@media (min-width: 900px)`
  `.text-view` `padding-top` override (`:~1181`) is untouched.
- The `@media (pointer: coarse)` tap-min block (`~:1155-1165`, listing
  `.text-view__back` and the `.menu__*` controls) is unchanged — the 44px
  `--tap-min` floor is intact.
- No React/DOM/ARIA change (read-only inspection of
  `RevealPanel`/`CompletionPanel`/`SettingsMenu`/`Onboarding`/`TextView`); no
  `.claude/` change; no new token.

## DEC2 — why the `max()` floor form (not the bare additive calc)

`.text-view` uses `padding-bottom: max(var(--space-4), calc(var(--space-4) +
var(--safe-bottom)))` — the **floor** form. The base never resolves below
`--space-4`, and on a zero-inset desktop / jsdom it collapses to `--space-4` for
a byte-equivalent render. The separate longhand makes the bottom value
independently assertable and provably leaves the desktop `padding-top` override
untouched. The "`env()` is never negative so `max()` is dead weight" objection is
technically true, but the explicit floor + addressable longhand is the safer,
test-friendlier authoring.

## NEEDS VERIFICATION on a physical notched iPhone (no silent on-device pass)

Per the charter's standing on-device-verification-gap policy (DEC9), the
following is the non-silent gap this slice **cannot** prove and does **not**
claim. It is flagged, not asserted, and is **unprovable** by headless **Vitest**
(jsdom evaluates no `env()` / `dvh` / `@media` geometry) or by
desktop-**Chromium Playwright** (it does not reproduce the OS notch / home
indicator / collapsing URL bar):

- On a notched iPhone in **portrait and landscape**, with the **URL bar shown
  and collapsed**, the **`.text-view` footer / back link** clears the **home
  indicator** (no stranding under the inset), AND the **Onboarding "got it"**
  control and the **Settings / menu close** controls stay fully visible and
  tappable without scrolling past the toolbar.

The CSS **consumes** `var(--safe-bottom)` (via the `.text-view` `padding-bottom`
floor) and `var(--vh-dynamic)` (the `dvh` caps on `.onboarding,.menu`); the
green suite proves token **consumption** in authored CSS, NOT rendered geometry.
The **rendered clearance and tap** on a real device are recorded here as a
NEEDS-VERIFICATION item and are **never asserted as a pass**.

## Scope guardrail

Product code + docs only. No file under `.claude/` was created, edited, or
deleted. The slice diff is exactly: `src/tokens.css` (the `.text-view`
`padding-bottom` longhand + the two `vh -> dvh calc` conversions + updated
comments); the four coupled-test assertion flips in `src/tokens.css.test.ts` and
`src/tokens.safeArea.quality.test.ts`; the dedicated headless guards
(`src/tokens.mob2.dvh.css.test.ts`, `src/tokens.mob2.scope.css.test.ts`); and
this run log plus its lint (`src/tokens.mob2.dvh.runlog.test.ts`).
