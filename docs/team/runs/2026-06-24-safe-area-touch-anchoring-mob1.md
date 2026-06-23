# Run log — Safe-area re-anchoring of the five touch affordances (epic MOB1)

Date: 2026-06-24
Feature: Re-anchor `.touch-joystick`, `.touch-thrust`, `.touch-fly`, `.touch-use`,
`.reveal-prompt` above the device safe area so the **USE → reveal** core verb is
reachable on a phone. First not-Done slice of epic MOB1 ("Reach the reveal on a
phone").

## Scope as actually shipped (the honest, corrected statement — D4)

> **Correction.** An earlier draft of this log framed the work as a CSS-and-DOM
> change only, claiming the touch-input file was untouched and that #151 was out
> of scope. **That framing is false against the shipped diff and has been
> retracted.** Branch `fix/mob1-safe-area-eager-touch`
> ships **two slices together**, by deliberate decision D4:
>
> - **slice #148** — the safe-area + dynamic-viewport (`dvh`) CSS-token layer in
>   `src/tokens.css` (commit `a2b629f`): four `--safe-top/right/bottom/left:
>   env(safe-area-inset-*, 0px)` tokens, the `--vh-dynamic: 100vh → 100dvh`
>   `@supports` ladder, and the five affordances re-pointed onto
>   `calc(<vh/vw> + var(--safe-*))` in the base rule and both media blocks.
> - **slice #151** — eager-mount of the touch controls via an injectable
>   `createInput(overlay, touchCapable?)` seam in `src/movement/input.ts`
>   (commit `17e66c1`): **`src/movement/input.ts` +60/-10** and
>   **`src/movement/input.test.ts` +49**.
>
> **Why the pairing is defensible:** re-anchoring the USE button **without** the
> eager-mount fix would relocate a button whose *first* tap is still swallowed by
> the lazy `touchstart → build()` path — i.e. we would move a still-broken
> button. Shipping #148 + #151 together is what actually delivers the verb
> "tap USE → see the reveal." The pairing is named here rather than hidden behind
> a "CSS-only" claim the diff contradicts.
>
> **Still out of scope:** slice **#152** (first-tap / `touchActive` correction)
> remains a separate, later slice — not touched on this branch. No change to
> `consumeInteract()` / `DiscoverySystem`, to content, or to `src/engine/`.

The consolidated, code-cited design for the shipped branch lives in the sibling
log `2026-06-24-mob1-safe-area-eager-touch-148-slice1.md`; this log records the
MOB1 re-anchoring framing and the scope correction above.

## Grounding verified this run
- `src/tokens.css`: 0 occurrences of `env(safe-area`, `dvh`, `svh` at the start
  of the run; the slice adds the token layer (now present, per the diff).
- `index.html:7` carries `viewport-fit=cover` (confirmed; left unchanged).
- Baseline `npm test` is green; the true current baseline after the committed
  slices is **72 files / 647 tests** (confirmed via `npm test` this run: Test
  Files 72 passed, Tests 647 passed). The earlier stale figure is retired — it
  predated the new `tokens.css`, `tokens.safeArea.quality`,
  `tokens.safeArea.runlog`, and eager-mount `input.test.ts` additions, so the
  +3 files / +34 tests over it are those committed tests (the latest +5 are the
  T4 NEEDS-VERIFICATION checklist-completeness assertions in
  `tokens.safeArea.runlog.test.ts`). "Stay green" is measured against a
  fully-green baseline.
- The touch DOM nodes are constructed in `src/movement/input.ts`; `.reveal-prompt`
  is a className in `src/ui/RevealPanel.tsx`. Re-anchoring itself is class-targeted
  CSS; the **first-tap repair** is the `input.ts` eager-mount change (slice #151).
- jsdom CSSOM probe (run this session): given two `bottom:` declarations on one
  rule, jsdom does NOT mangle the value but SILENTLY COLLAPSES to the LAST
  declaration — the vh fallback line is invisible to CSSOM. Consequence: the
  fallback-ordering gate can only be satisfied by a raw `readFileSync(tokens.css)`
  text scan, never via `cssRules[].cssText` / `getComputedStyle`.

## NEEDS VERIFICATION (cannot be proven headless — per charter on-device policy, D5)

The consolidated, final on-device checklist for this branch. Three categories,
each a single deliberate pass on real hardware. **Every item below is flagged,
not asserted** — the headless Vitest suite and the desktop-Chromium Playwright
smoke cannot reproduce the OS gesture inset or evaluate `env()`/`dvh`, so none of
these may be recorded as success until a person runs them on a phone.

**(a) Home-indicator / USE-tap clearance.** On iOS Safari in **portrait AND
landscape**, with the **URL bar shown AND collapsed**, and on **Android Chrome**:
the relocated USE button sits entirely above the safe-area inset and a deliberate
USE tap reaches it — it is NOT intercepted by the OS home-indicator / swipe
gesture band. (This is the core verb "tap USE → reveal"; the eager-mount slice
#151 is what makes the *first* such tap land, not just later ones.)

**(b) `.reveal-prompt` overlap.** The in-range `.reveal-prompt` is readable and
**not visually overlapped** by the relocated buttons in **portrait AND
landscape** on the running build. The slice lifts the prompt and the buttons by
the *same* inset, so it introduces no NEW overlap; the prompt is
`pointer-events:none` and `z-index:15 < 20`, so a tap still reaches the button.
But the pre-existing portrait/landscape proximity (see "Pre-existing layout
facts" below) means readable-and-unobstructed must be eyeballed on-device, not
claimed.

**(c) Audio unlock (confirmation, not a regression introduced here).** With the
silent switch ON, a tap on the moved USE button still drives the discovery
reveal; after backgrounding the tab and returning, a tap on the relocated USE
button still resumes a suspended/interrupted audio context. `installAudioResume`
binds resume to `window` (not to the USE button), so re-anchoring the button
**cannot break** the audio-unlock path — these are confirmation checks, recorded
in the same on-device pass, not regressions this slice could introduce.

These three items are flagged, not asserted — they remain open until run on a
real device.

## Pre-existing layout facts the slice does NOT change (honest scope)
- Portrait: `.touch-thrust` (right:6vw, 18vh) and `.touch-use` (right:6vw, 7vh)
  share the same right column; their edges are ~1.4px apart on an SE-class screen
  today. The chosen bottom gap is capped so the lifted USE top edge does not cross
  the thrust bottom edge.
- Landscape: `.touch-thrust` (14vh) and `.touch-use` (4vh) share right:6vw and
  already visually overlap at base on short screens — pre-existing, not introduced
  here. The centered `.reveal-prompt` (left:50%, max-width min(34rem,88vw)) and the
  edge buttons share the bottom band at base; the prompt is `pointer-events:none`
  and `z-index:15 < 20`, so the tap still reaches the button. This slice keeps both
  at the same lifted offset — it introduces no NEW overlap but cannot fully resolve
  the pre-existing visual overlap. The AC's overlap line is therefore satisfied as
  "no NEW overlap introduced" + on-device NEEDS-VERIFICATION, not a blanket claim.

## Measured build delta
- `npm run build` (this run): CSS `17.29 kB` (gzip `3.71 kB`), JS index
  `229.10 kB` (gzip `75.83 kB`), three `500.28 kB` (gzip `125.83 kB`);
  `tsc --noEmit` clean. The CSS-text delta (the tokens, the `@supports` block,
  the `calc()` wrappers) plus the small eager-mount JS delta (it pulls only the
  existing `deviceCapability` read — zero new dependencies) is well within the
  `docs/perf-budget.md` 400 KB gz JS / 6 MB total budget. **Not literally "zero
  new bytes" on the CSS side** — a few hundred authored bytes are added.
