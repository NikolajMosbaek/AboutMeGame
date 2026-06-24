# Run log — MOB2 #155 (epic #149): lock in the ≥44px coarse tap floor + the dvh / safe-area panel caps

Date: 2026-06-24
Branch: `mob2-coarse-tap-floor-155`
Feature: the **third and final** slice of Epic MOB2 #149 — a pure
**verification-and-lock-in** slice. It ships **ZERO product CSS change**. Every
declaration it asserts already exists and is correct in `src/tokens.css` (shipped
by #153 / #154 but left unguarded). The slice's whole diff is **two test files
plus this run log**:

1. `src/tokens.mob2.coarseTap.css.test.ts` — a headless CSS-as-text guard that
   pins (A) the `--tap-min: 44px` coarse-pointer tap floor via a robust **per-rule
   binder**, (B) the belt-and-suspenders base floor (`.hud-top-right` notch
   clamp, `.hud-menu-btn` base sizing), and (C) the four `dvh` panel caps plus the
   `.text-view` safe-bottom negative.
2. `src/tokens.mob2.coarseTap.runlog.test.ts` — the presence/honesty lint over
   **this** log (hard-coded path; section-shape, not a brittle count).

Neither file is in the Vite import graph, so the shipped JS / asset / CSS bundle
is **byte-identical** to `main` (measured below). **Production CSS was already
compliant and was NOT edited.**

## DEC1 — scope: pure verification, zero behavioural CSS change

Confirmed against the live tree before authoring: `--tap-min: 44px` at `:root`;
the `@media (pointer: coarse)` seven-selector group rule at `tokens.css:1162-1171`
(`.cta, .menu__toggle, .menu__seg, .menu__btn, .hud-menu-btn, .title-textlink,
.text-view__back` → `min-height` + `min-width: var(--tap-min)`); the
`.hud-top-right` notch clamp; the `.hud-menu-btn` base `width/height:
var(--tap-min)`; the four `dvh` caps; the `.text-view` safe-bottom pad with no
`max-height`; `--vh-dynamic 100vh → 100dvh` behind `@supports(height: 100dvh)`.
No HUD/panel redesign, no telemetry move, no bottom touch-control change (MOB1
owns), no hint text (A2 #127), nothing into `src/engine/` or canvas sizing.

## DEC3 — the matcher: a robust per-rule binder (resolves the Quality flaw)

The six named controls share ONE seven-selector group rule
(`tokens.css:1162-1168`), so an exact-match `blocksFor('.hud-menu-btn')` returns
**0**. A naive "body contains `.hud-menu-btn` AND body contains
`min-height`/`min-width: var(--tap-min)` somewhere" check would then
**FALSE-GREEN** on realistic partial regressions. The shipped test instead parses
the coarse-media body into per-rule `(selector-set, decls)` pairs and, for each
control, asserts SOME rule **lists that control** AND carries BOTH
`min-height: var(--tap-min)` and `min-width: var(--tap-min)` in its **OWN** decls
(subset/contains semantics — extra selectors like `.title-textlink` are tolerated,
never forbidden).

## DEC4 / DEC5 — failing-first transcripts (RED on a per-control fixture, GREEN on the real file)

Per DEC5, the failing-first demonstration weakens the floor for **one named
control** in a scratch copy of `tokens.css` (NOT a whole-block strip, which would
go red under a naive matcher too and so prove nothing). **Production
`src/tokens.css` was never edited** — each fixture was swapped into a working
copy, the test observed, and the real file restored immediately (`git diff
--quiet HEAD -- src/tokens.css` confirmed clean after each).

### Attack-3 — group keeps `min-height`, DROPS `min-width`; sibling `.touch-btn` keeps both

```
 ❯ src/tokens.mob2.coarseTap.css.test.ts (8 tests | 1 failed)
   × Group A — the per-rule binder … .hud-menu-btn resolves BOTH min-height AND min-width…
     → .hud-menu-btn must carry both min-height and min-width:var(--tap-min)
       in the rule that lists it: expected false to be true
 Test Files  1 failed (1)
      Tests  1 failed | 7 passed (8)
```

RED — the floor is halved (only one dimension survives) while `.touch-btn`
(`:1175-1178`) still carries both, the exact case a naive substring matcher
false-greens.

### Attack-2 — `.hud-menu-btn` split out of the tap-min group into a cosmetic-only rule

```
 ❯ src/tokens.mob2.coarseTap.css.test.ts (8 tests | 1 failed)
   × Group A — the per-rule binder … .hud-menu-btn resolves BOTH min-height AND min-width…
     → .hud-menu-btn must carry both min-height and min-width:var(--tap-min)
       in the rule that lists it: expected false to be true
```

RED — `.hud-menu-btn` is moved to a sibling rule carrying only `opacity` (no
min-*), so its floor is lost even though the group's other selectors keep both
dimensions.

### GREEN on the real, restored file

```
 ✓ src/tokens.mob2.coarseTap.css.test.ts (8 tests) 2ms
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

The binder catches the realistic **partial** regression (single-dimension drop
AND split-out control), not merely a whole-rule deletion — and passes the real,
already-compliant tree. **No production CSS was changed by this slice.**

## DEC8 — MEASURED `npm run build` byte delta vs `main` (byte-identical, delta 0)

`npm run build` (`tsc --noEmit` + `vite build`) exits **0**. Measured branch
(HEAD) vs a clean `main` (`6f5fce0`) — two builds: the branch via `npm run build`,
`main` via `npx vite build` in a detached worktree sharing the repo's installed
`node_modules` (same `package-lock.json`, no network). Raw bytes via `wc -c`;
gzip reproducibly via `gzip -9 -c <file> | wc -c`. A `diff -rq` of the full dist
trees reported **`FULL DIST TREE IDENTICAL`**; `cmp` confirmed each JS/CSS/HTML
chunk byte-for-byte.

| chunk | `main` raw | `main` gzip-9 | branch raw | branch gzip-9 | delta |
|-------|-----------:|--------------:|-----------:|--------------:|------:|
| entry `index-EMvADo4m.js` | 229,197 | 75,649 | 229,197 | 75,649 | **0 — byte-identical** |
| vendor `three-COLka6mN.js` | 500,276 | 124,649 | 500,276 | 124,649 | **0 — byte-identical** |
| `index-CEEfcEHH.css` | 17,541 | 3,750 | 17,541 | 3,750 | **0 — byte-identical** |
| `index.html` | 2,063 | 854 | 2,063 | 854 | **0 — byte-identical** |

- **JS / asset / CSS delta is exactly 0 — the dist is byte-identical.** Both JS
  chunks even share the same content hash (`EMvADo4m`, `COLka6mN`) across both
  trees, as does the CSS (`CEEfcEHH`). The slice touches only test files outside
  the import graph, so there is nothing for the bundle to move. This is the
  honest result: **NOT** "CSS grows a few hundred bytes" (that was #154's CSS-only
  outcome and would be a false claim here, since no CSS is touched). The byte
  delta is a MEASURED build figure, never a runtime `expect()` expression.

vite's own build report (branch, lighter gzip level than `gzip -9`, for
cross-reference):

```
dist/index.html                   2.05 kB │ gzip:   0.84 kB
dist/assets/index-CEEfcEHH.css   17.54 kB │ gzip:   3.74 kB
dist/assets/index-EMvADo4m.js   229.10 kB │ gzip:  75.83 kB   <- entry chunk
dist/assets/three-COLka6mN.js   500.28 kB │ gzip: 125.83 kB   <- vendor chunk (untouched)
✓ built in 632ms
```

- **Within `docs/perf-budget.md`.** First-load JS is the entry chunk + the
  `three` vendor chunk — **~75.6 KB + ~124.6 KB ≈ 200.3 KB gz** (gzip-9; vite's
  lighter report reads ~75.8 + 125.8 KB), tracking the LIVE perf-budget figures
  (**~199.1 KB first-load / ~124.9 KB three chunk**) and well **within** the
  **400 KB gzip** JS cap. CSS (3.75 KB gz) is trivial. Total initial download is
  far under the 6 MB ceiling. **PASS** — and unchanged, since the bundle is
  byte-identical.

## DEC10 — fully-green `npm test`, NO red-allowance, gh-gated skip stated

`npm test` (`vitest run`) is **fully green: 709/709 passing across 79 test
files** on the committed branch tree (this log's own count after both new files
land). Baseline before the slice was 77 files / 686 tests; the two new files
(`tokens.mob2.coarseTap.css.test.ts` = 8 tests; this run-log lint = 15 tests)
land it at the cited 79 files / 709 tests — at/just past the design's expected
~78-79 files / ~692-700 window (the lint carries more assertions than the brief
sketched, which only adds green coverage). **Zero exclusions; zero red carried
in; none introduced.**

- **`dayCycle.scope.test.ts` is FICTION / absent** — confirmed not present in the
  tree (`src/world/dayCycle.scope.test.ts: No such file or directory`; removed in
  `d176cc4`). There is **no red-allowance**: the gate is 100% green and any red is
  a real regression (guardrail 4 — auditable).
- **`mob1.prBody.test.ts` is gh-gated** — it uses `describe.skipIf` via
  `ghAvailable()` (`src/mob1.prBody.test.ts:36,58`). Where the GitHub CLI is
  **unavailable** (e.g. a clean CI runner without `gh` auth) this suite is
  **SKIPPED**, and a **skip is NOT a pass** — it is reported as
  skipped-when-gh-unavailable, never rounded up to green. In this run `gh` was
  authenticated, so the suite **ran** (its 4 tests passed and are included in the
  709 total). The honest status: **passes when `gh` is available, skipped (not
  passed) when it is not.**

## What did NOT change (scope holds, DEC11)

- `src/tokens.css` is **byte-identical to HEAD** — no product CSS edit (the
  failing-first fixtures were swapped into a working copy and restored; the
  working tree is clean).
- The existing RTL dialog focus-trap / focus-return and ARIA
  (`role=dialog` / `aria-modal`) suites for `RevealPanel`, `CompletionPanel`
  (incl. `CompletionPanel.a11y`), `SettingsMenu`, `Onboarding`, `JournalPanel`
  and `TextView` stay green; desktop (≥900px) layout and the jsdom/RTL snapshots
  are unchanged — no React was written this slice.
- No new `max-height` on the width-only `.menu` / `.onboarding` base rules (the
  #154 dvh sibling already guards that negative). No telemetry move, no bottom
  touch-control change, no hint text, no PWA / orientation work, nothing into
  `src/engine/` or canvas sizing. No file under `.claude/` was created, edited, or
  deleted.

## DEC6 — intentional additive overlap with `tokens.mob2.dvh.css.test.ts`

Group C re-asserts the four `dvh` caps + the `.text-view` negative that the #154
file (`tokens.mob2.dvh.css.test.ts`) also holds. This is **cheap insurance keyed
to #155's own anchors**, not a refactor — #155 must never be framed as editing
the #154 file. **A future cap-ratio change (e.g. `0.86 → 0.88`) must update BOTH
files.**

## NEEDS VERIFICATION on a physical notched iPhone (no silent on-device pass)

> This heading needs verification on a real device.

Per the charter's standing on-device-verification-gap policy (DEC9), the
following is the non-silent gap this slice **cannot** prove and does **not**
claim. It is flagged, not asserted, and is **unprovable** by headless **Vitest**
(jsdom evaluates no `env()` / `dvh` / `@media (pointer: coarse)` geometry — it
would only echo the authored string) or by desktop-**Chromium Playwright** (it
does not reproduce the OS notch / Dynamic Island / home indicator / collapsing
URL bar):

- On a **notched iPhone** in **portrait AND landscape**, with the **URL bar shown
  AND collapsed**: the **Settings / menu button** (`.hud-menu-btn`) is fully
  **tappable and uncovered** (clear of the notch / status bar via the
  `.hud-top-right` safe-area clamp), AND each panel's **close / back / next**
  control is **reachable without fighting the toolbar** — explicitly including the
  **SettingsMenu close + mute** control (the WCAG-1.4.2 reachable-mute bar hosted
  by `.menu__toggle` / `.menu__seg` / `.menu__btn`), the **RevealPanel /
  CompletionPanel** close/next, and the **`.text-view__back`** link.

The CSS **consumes** `var(--tap-min)`, `var(--safe-top|--safe-right|--safe-bottom)`
and `var(--vh-dynamic)`; the green suite proves token **consumption** in authored
CSS, NEVER rendered pixels. The rendered clearance and tap on a real device are
recorded here as a NEEDS-VERIFICATION item and are **never asserted** as a pass.
This log makes **no affirmative on-device claim**.

## Scope guardrail

Product code + docs only. The slice diff is exactly:
`src/tokens.mob2.coarseTap.css.test.ts`, `src/tokens.mob2.coarseTap.runlog.test.ts`,
and this run log. No file under `.claude/` was touched; no product CSS / JS / DOM
/ ARIA / asset / token change.
