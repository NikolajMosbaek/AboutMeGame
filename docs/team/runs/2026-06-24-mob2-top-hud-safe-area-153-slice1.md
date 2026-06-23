# Run log — MOB2 #153 slice 1: lift the top HUD clear of the notch (safe-area `max()` clamps)

Date: 2026-06-24
Branch: `fix/mob1-safe-area-eager-touch`
Feature: Lift the **top HUD cluster** — runtime stats, the centred telemetry
chip, the discovery badge, and the top-right journal + **menu/Settings** buttons
— clear of the notch / status bar / Dynamic Island by wrapping the top/right/left
offsets of the top-anchored fixed HUD rules in `src/tokens.css` so they honour
MOB1's existing `--safe-*` tokens. **CSS-only; reposition, never restyle.** No JS,
no assets, no DOM, no IA / z-index / type-scale change.

This is MOB2 slice 1 (#153). It rides MOB1's already-shipped token layer
(`--safe-top/right/bottom/left: env(safe-area-inset-*, 0px)` in `:root`); it adds
no new token and no new dependency.

## Baseline (restated, clean tree)

- The brief's quoted pre-existing red — `src/world/dayCycle.scope.test.ts` — is a
  **phantom**: that file does not exist in the tree. There is no such failing test
  to inherit.
- Suite was **green** on a clean tree at HEAD `47859a0`: **651/651**. After this
  slice's own implementation commit (`db5590c`) added the MOB2 consumption test
  (`src/tokens.mob2.css.test.ts`, +5 tests / +1 file), the live committed count is
  **656/656 passing, 74 files** (this T5 run log lint adds its own file on top).
  No red carried in, none introduced.
- A stray, **unrelated** working-tree edit to a *different* MOB1 run log
  (`docs/team/runs/2026-06-24-safe-area-touch-anchoring-mob1.md`) was present and
  not part of MOB2; it was set aside (stashed) so it could not pollute this run's
  green baseline. It is not part of slice #153's diff.

## The fix (where it landed — post-fix citations in `src/tokens.css`)

The roundtable's central dispute was the **idiom**, settled empirically (D1). The
top HUD is a **fixed clearance gutter**, so each offset is wrapped as
`max(var(--space-N), var(--safe-*))` — the `max()` clamp with MOB1's `--safe-*`
tokens **inside** `max()`. NOT raw `env()` at the call site, and NOT the additive
`calc(offset + var(--safe-*))` form (which stays reserved for the vh-stacked
**bottom** controls). The base rules wrapped:

- `.stats-overlay` — `top: max(var(--space-1), var(--safe-top))` (`tokens.css:276`);
  `left: max(var(--space-1), var(--safe-left))` (`tokens.css:277`).
- `.discovery-progress` (standalone) — `top: max(var(--space-1), var(--safe-top))`
  (`tokens.css:357`); `right: max(var(--space-2), var(--safe-right))`
  (`tokens.css:358`) — the **actual** authored values (`--space-1` top, `--space-2`
  right).
- `.hud-telemetry` — `top: max(var(--space-1), var(--safe-top))` **only**
  (`tokens.css:586`). It is centre-anchored (`left: 50%` + `translateX`); a
  left/right inset would skew the centring, so **none is added**.
- `.hud-top-right` (carries **both** the journal and the **menu/Settings**
  buttons) — `top: max(var(--space-1), var(--safe-top))` (`tokens.css:623`);
  `right: max(var(--space-1), var(--safe-right))` (`tokens.css:624`) — wrapping the
  **actual** value (`right` is `--space-1`, not the brief's stale `--space-2`,
  which would have shifted desktop).
- `@media (max-width: 480px) .hud-telemetry` (D3 source-order guard) —
  `left: max(var(--space-1), var(--safe-left))` (`tokens.css:1071`): on the
  small-phone target a landscape-left notch would otherwise re-clip telemetry
  after the base fix. No other media-block top declaration exists, so no other
  override is touched.

The `.hud-top-right .discovery-progress` **nested** override (`:635`, which forces
that badge `position: static; top/right: auto` in the shipped HUD) is **not**
touched.

## D1 — the empirical idiom finding (the dispute, settled in a real browser)

A real-browser probe (Playwright / Chromium) measured
`max(var(--space-1), var(--safe-top))`:

- **= 8px** on a zero-inset root (desktop / no notch) — i.e. the raw `--space-1`
  token wins, **byte-for-byte the same** rendered offset as before.
- **= 47px** with the inset present (a notch) — i.e. `--safe-top` wins.

This **overturns** the "token form is a silent 0px no-op" claim: `--safe-top` is
`env(safe-area-inset-top, 0px)`, so on a notch the inset wins; `0px` is only the
**fallback** on a zero-inset device. It also **supersedes** the initial additive
lean — additive is the bottom-control form, not the top-gutter form. The desktop
fallback stayed byte-identical, so AC "desktop unchanged" holds.

## D4 — `.discovery-progress` standalone wrap is belt-and-suspenders (stated plainly)

The `.discovery-progress` **standalone** wrap (`tokens.css:357-358`) is
**defense-in-depth / belt-and-suspenders**, not a live-DOM fix. In the shipped
HUD that badge is forced `position: static; top/right: auto` by the
`.hud-top-right .discovery-progress` override (`:635-642`), so its own offset is
**inert** in the assembled HUD — `.hud-top-right` is what actually clears the notch
for the menu/Settings cluster. The AC names the standalone rule and the wrap is
cheap, so it is kept; this log states plainly that it only matters for a
**standalone `.discovery-progress` render path**, not the assembled HUD.

## Reported build deltas (honest — NOT "zero bytes")

`npm run build` and `npm test` both exit 0 this slice.

- **JS:** `229.10 kB` — **unchanged**. No JS / DOM / asset touched, so the
  JS and asset delta is **~0**.
- **CSS:** the source **grows a few hundred authored bytes** (the eight `max()`
  wrappers over what were bare `var(--space-N)` offsets). This is reported
  honestly: it is **NOT "zero bytes"** on the CSS side. Measured raw CSS moved
  from the `17.29 kB` baseline by a few hundred bytes — trivially within
  `docs/perf-budget.md`.

Suite: **656/656 passing** on the committed tree (74 files) plus this run-log lint.

## Scope guardrail (slice 1 holds)

Product code + docs only. No file under `.claude/` was created, edited, or
deleted. The slice diff is exactly **`src/tokens.css`** (the eight `max()`
wrappers) **+ one new consumption test** (`src/tokens.mob2.css.test.ts`) **+ this
run log and its lint** (`src/tokens.mob2.runlog.test.ts`). Untouched, as fenced:
`Hud.tsx`/JSX, `index.html` (`viewport-fit=cover` already present), IA / z-index /
telemetry centring / type scale, the menu/journal buttons themselves, #154 `dvh`,
#155 tap-min / dialog-focus, the bottom touch-control offsets, and any new
panel / content / hint text.

The new consumption test is an **authored-source-TEXT** proof carrying the
verbatim HONESTY CONTRACT: it proves token **consumption** in authored CSS, NOT
rendered geometry (jsdom evaluates no `env()` / `@media`). It asserts the
**in-media** `(max-width: 480px) .hud-telemetry` `left` wrap (the D3 source-order
guard), not only the base rules.

## NEEDS VERIFICATION on a physical notched iPhone (no silent on-device pass)

Per the charter's standing on-device-verification-gap policy, the following is the
non-silent gap this slice **cannot** prove and does **not** claim. It is flagged,
not asserted, and **cannot be proven** by headless **Vitest** or by
desktop-**Chromium Playwright** (neither reproduces the OS notch / status-bar /
Dynamic-Island inset, and jsdom evaluates no `env()` / `@media`):

- On a notched iPhone in **portrait and landscape**, with the **URL bar shown and
  collapsed**, the **menu/Settings** button and the **telemetry** chip sit
  **fully below** the status bar / notch / Dynamic Island (no clipping, no
  overlap), AND the **menu button opens Settings on tap** (the Settings gateway is
  reachable and tappable in the relocated position).

The CSS **consumes** `var(--safe-top)` / `var(--safe-right)` / `var(--safe-left)`
via the `max()` clamp (the probe above shows the clamp behaves: 8px desktop / 47px
notch); the **rendered clearance and tap** on a real device are on-device only and
are recorded here as a NEEDS-VERIFICATION item, never asserted as a pass.
