# Run log — MOB1 #148 slice 1: repair USE→reveal on iOS Safari

Date: 2026-06-24
Branch: `fix/mob1-safe-area-eager-touch`
Feature: Repair the **USE→reveal core verb** on iOS Safari with a shared
safe-area + dynamic-viewport (`dvh`) layout-token layer and an **eager-mount** of
the touch controls behind an injectable capability seam. **CSS + input-wiring
only**; zero new dependencies, zero new asset bytes of JS.

Scope is exactly the USE→reveal path: the bottom touch controls
(`.touch-joystick` / `.touch-thrust` / `.touch-fly` / `.touch-use`), the reveal
prompt (`.reveal-prompt`), the reveal panel + completion panel and their
backdrops. **OUT of scope (inherit the layer later, explicitly not touched):**
MOB2 (#149 HUD/Settings) and A2 (#127 onboarding wall) — `.onboarding` / `.menu`
stay on their existing raw `vh`.

> Note on the sibling run log: `2026-06-24-safe-area-touch-anchoring-mob1.md`
> recorded an earlier, narrower framing of MOB1 (CSS/DOM-only re-anchoring of the
> five affordances, with eager-mount/`touchActive` split into siblings #151/#152
> and no `--vh-dynamic`). This log records the **converged #148 slice-1 design**:
> the shared token layer **plus** eager-mount behind the injectable seam, as a
> single coordinated change to the USE→reveal path.

## The three root causes (with code citations, verified this run)

1. **Lazy-mount swallow — the first USE tap built the button instead of pressing
   it.** The touch overlay only constructed its controls on the first
   `touchstart` (`createTouchControls`'s `onFirstTouch = () => build()` listener,
   `src/movement/input.ts`). The opening tap that *should* fire
   `consumeInteract()` was spent building the DOM, so on a phone the very first
   USE tap registered nothing and a second tap was required to reach the reveal —
   the core verb silently failed on first contact. (Design citation:
   `input.ts:255-256` `onFirstTouch` swallow / lazy-mount, in the pre-fix file.)

2. **Raw `vh` / fixed offsets with no safe-area consumer.** The bottom-pinned
   controls were positioned with raw `vh` and the reveal/completion panels sized
   with static `vh`, so on a notched iPhone the USE button and the panel's
   `Drive on` / `Next` actions tucked **under the home indicator** and the panel
   could overflow the dynamic (URL-bar-shrunk) viewport. Design citations
   (pre-fix file): `.touch-*` raw bottom `vh` ~`tokens.css:313-327`; base
   `.reveal-panel` `max-height: 86vh` ~`tokens.css:389`; the grouped media
   overrides `max-height: 92vh` (`@media(max-width:480px)`) ~`tokens.css:1006-1011`
   and `96vh` (`@media(max-height:480px)`) ~`tokens.css:1074-1077` — which **won
   by CSS source order** on the small/short iPhone the P0 targets, silently
   reverting the panel to raw `vh`; and `.completion-panel` ~`tokens.css:513`.

3. **`viewport-fit=cover` with no `env()` consumer.** `index.html:7` ships
   `viewport-fit=cover` (verified, unchanged), which *extends* the layout into the
   notch/home-indicator region — but nothing in the CSS read
   `env(safe-area-inset-*)`, so the cover-extension was all downside and no
   inset compensation.

## What slice 1 changed (where the fixes landed — post-fix citations)

- **D1 — token layer** in `src/tokens.css` `:root`:
  `--safe-top/right/bottom/left: env(safe-area-inset-*, 0px)` (`tokens.css:43-46`,
  the `0px` fallback makes desktop/jsdom a defined zero, byte-identical to today
  on zero-inset devices); `--vh-dynamic: 100vh` declared **first**
  (`tokens.css:52`), upgraded to `100dvh` only under
  `@supports (height: 100dvh)` (`tokens.css:61-63`) — the vh-first ladder is
  mandatory so iOS <15.4 / non-`dvh` engines degrade to today's behaviour.
- **D2 — re-point every in-scope rule** to the tokens:
  `.touch-joystick` `left: calc(5vw + var(--safe-left))` +
  `bottom: calc(6vh + var(--safe-bottom))` (`tokens.css:302-303`);
  `.touch-thrust/.touch-fly/.touch-use` gain `var(--safe-right)` /
  `var(--safe-bottom)` (`tokens.css:339-349`); `.reveal-prompt`
  `bottom: calc(8vh + var(--safe-bottom))` (`tokens.css:371`); base
  `.reveal-panel` (`tokens.css:418`) and `.completion-panel` (`tokens.css:545`)
  `max-height: calc(var(--vh-dynamic) * 0.86)`; backdrops gain
  `padding-top/bottom: calc(var(--space-2) + var(--safe-*))`
  (`tokens.css:410-411`, `538-539`). Insets are **added** to offsets, never
  subtracted from `--tap-min` (≥44px, WCAG 2.5.5).
- **D2(d) quality-flaw fix** — `.reveal-panel` is split out of both grouped media
  rules into its own rule: `max-height: calc(var(--vh-dynamic) * 0.92)`
  (`@media max-width:480px`, `tokens.css:1056`) and `* 0.96`
  (`@media max-height:480px`, `tokens.css:1130`), so no in-scope raw-`vh`
  max-height survives where it wins by source order on the small/short iPhone.
  `.onboarding` / `.menu` stay on their existing `vh` (out of scope).
- **D2(e)** — the offsets **inside** both media queries are migrated too: the
  portrait `.reveal-prompt` override (`tokens.css:1098`) and the landscape
  `@media max-height:480px` `.touch-*` / `.reveal-prompt` offsets
  (`tokens.css:1140-1147`) all use `calc(<vh> + var(--safe-bottom))`. **No raw
  bottom `vh` left in any in-scope rule, portrait or landscape.**
- **D3 — eager-mount behind the injectable seam:**
  `createInput(overlay, touchCapable?: boolean)` (`src/movement/input.ts:68`),
  defaulting to a `readEnv()`-derived resolver
  (`touchCapable = env.coarsePointer || env.maxTouchPoints > 0`), threaded into
  `createTouchControls(overlay, h, touchCapable)` (`input.ts:108`, `220`). There
  is **one** `build()` path: when `touchCapable` it runs eagerly at construction
  (`if (touchCapable) build();`, `input.ts:293`) so the USE `<button>` exists
  before any input and the **first** tap fires `consumeInteract()` exactly once.
  The `touchstart → build()` listener (`input.ts:295-296`) stays **only** as an
  idempotent `built`-guarded fallback (`built` flag, `input.ts:221`, `230-231`),
  not a second construction path. When `touchCapable` is false (desktop / jsdom
  default) nothing mounts.

## Injectable-seam decision (D3 — no new global)

The eager-mount / coarse-pointer decision **reuses `src/perf/deviceCapability.ts`**
via the optional `touchCapable` arg, not a new global. The default resolver mirrors
the existing `isTouch` predicate at `deviceCapability.ts:38`
(`env.coarsePointer || env.maxTouchPoints > 0`), so the codebase keeps **one**
coarse-pointer notion. The optional second arg keeps all existing single-arg
`createInput(overlay)` call sites compiling, and the default returns
`touchCapable=false` under jsdom (where `matchMedia` is guarded to false and
`maxTouchPoints` reads 0), so there is no headless behaviour change.

## Audio-unlock invariant (D4 — no audio code added)

The first USE tap must both **fire interact** and **unlock the `AudioContext`**.
That is preserved by leaving the audio path alone:

- The touch USE handler keeps `e.preventDefault()` and **adds no
  `stopPropagation()`** (`input.ts:284-287`; `grep stopPropagation src/movement/input.ts`
  → no matches, confirmed this run). So the `pointerdown` still **bubbles**.
- `installAudioResume` stays on `window`, bubbling, `{ once: true }` for
  `pointerdown` **and** `keydown` (`src/buildGame.ts:136-137`). The bubbling tap
  therefore reaches it and calls `audio.resume()` exactly once.
- Mounting the controls eagerly **does not** call `audio.resume()` /
  `startMusic()` at mount time (WCAG 1.4.2, no autoplay) — `build()` only appends
  DOM and binds pointer handlers; audio is unlocked **only** by the first gesture.

## AC7 byte note (honest, not literally zero on the CSS side)

`npm run build` and `npm test` both exit 0 this run. The input-wiring change pulls
**only** the existing `deviceCapability` read — **zero new asset bytes of JS**.
The CSS **does** add a few bytes (the tokens, the `@supports` block, the `calc()`
wrappers, the backdrop padding, the split-out media rules) — trivially within
budget, but **not literally "zero new bytes" on the CSS side.**

Measured this run (`npm run build`):

```
dist/assets/index-SA6ftpcZ.css   17.29 kB │ gzip:   3.71 kB
dist/assets/index-G1IIBAKd.js   229.10 kB │ gzip:  75.83 kB
dist/assets/three-COLka6mN.js   500.28 kB │ gzip: 125.83 kB
```

Entry-chunk JS gzip 75.83 KB + three 125.83 KB ≈ 201.7 KB, well within the
`docs/perf-budget.md` 400 KB gz JS budget. CSS is a separate ~3.7 KB gz bundle.
Full suite: `npm test` → **71 files / 632 tests passed**.

## NEEDS VERIFICATION ON A PHYSICAL iPHONE (no silent on-device pass)

The headless Vitest suite proves token **consumption** (authored-rule text /
CSSOM references the inset / `dvh` tokens, including the **split-out media-query
rules** so the D2(d) gap cannot silently pass) and input **behaviour** (the first
plain `Event('pointerdown', { bubbles:true })` on `.touch-use` queues
`consumeInteract()` exactly once; both seam branches; the `built`-guard
no-double-append). It **cannot** evaluate `env()` / `@media` / `dvh` or reproduce
the OS gesture inset. The following are **flagged, not asserted**:

1. **Rendered safe-area / `dvh` result.** On a notched iPhone (portrait **and**
   landscape, URL bar shown **and** collapsed) the USE button and the reveal
   panel's `Drive on` / `Next` actions clear the home-indicator inset and the
   panel does not overflow the dynamic viewport. (CSS consumes
   `var(--safe-bottom)` / `var(--vh-dynamic)`; the rendered clearance is
   on-device only.)
2. **First-discovery chime audible after the first USE tap.** With the silent
   switch as-is, the **first** tap on the relocated USE button both drives the
   reveal **and** unlocks the `AudioContext` (D4 bubbling path), so the
   first-discovery chime is audible. The unlock path is wired headlessly; whether
   the chime is **audible** on the device is on-device only.

Per the charter's standing on-device-verification gap policy, neither is claimed
as an on-device pass.

## Scope guardrail

Product code + docs only. No file under `.claude/` was created, edited, or
deleted. Diff vs `main`: `src/tokens.css`, `src/movement/input.ts`,
`src/movement/input.test.ts`, `src/tokens.css.test.ts`,
`src/tokens.safeArea.quality.test.ts`, plus this run log.
