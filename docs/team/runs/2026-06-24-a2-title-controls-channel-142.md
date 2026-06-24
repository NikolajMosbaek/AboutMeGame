# Run log — A2 #142 (final slice of epic #127): drive the title controls hint from the resolved channel

Date: 2026-06-24
Branch: `feat/a2-title-controls-channel-142`
Feature: the **final** slice of Epic A2 #127. Drive the single hardcoded
`<p className="title-controls">` hint in `src/ui/TitleScreen.tsx` from the
already-shipped control-scheme resolver (`src/ui/controlScheme.ts`, #140), so a
coarse-pointer / touch visitor arriving via the shared link sees touch-phrased
copy naming the on-screen FLY / USE buttons instead of keyboard-only WASD
instructions — while **keyboard stays the safe default** and the desktop /
keyboard copy is **byte-for-byte unchanged**.

The shipped product diff is two source files (`src/ui/TitleScreen.tsx`,
`src/ui/TitleScreen.test.tsx`); this slice adds the T4 run-log lint
(`src/ui/titleControlsChannel.runlog.test.ts`) and this log. `App.tsx` is
**unchanged** — it passes no `channel`, so the default seam fires and live
behaviour now tracks the device.

## DEC1 — the converged design

- `TitleScreenProps` gains an optional `channel?: ControlChannel` (the type
  imported from `src/ui/controlScheme.ts`), documented like the existing
  `progress?` prop: injected so tests / previews can force a channel; defaults to
  the resolved platform signal.
- The prop is defaulted at the **param-default seam** in the destructure —
  `channel = readControlChannel()` — **exactly mirroring this file's own
  `progress = readProgress()` seam**. The hint is selected from two title-local
  string literals: `<p className="title-controls">{channel === "touch" ?
  TOUCH_HINT : KEYBOARD_HINT}</p>`, keyboard as the literal else-branch default.
- **The channel — not the resolver's entry table — is the only thing consumed
  from `controlScheme.ts`.** The hints are held as named module-level consts in
  `TitleScreen.tsx` (`KEYBOARD_HINT`, `TOUCH_HINT`): the screen's own
  presentational prose, NOT a re-derivation of `resolveControlScheme(channel).
  entries`. No new export, no resolver duplication.
  - `KEYBOARD_HINT = "WASD to drive · F to fly · E to reveal a landmark"` — the
    existing line verbatim, including the U+00B7 middot separator.
  - `TOUCH_HINT = "Drag to drive · tap FLY to fly · tap USE to reveal"` — no
    "WASD", same middot separator, naming the FLY / USE buttons the touch player
    literally sees (built by `createTouchControls`, `src/movement/input.ts`, and
    mirrored in `TOUCH_ENTRIES`, `controlScheme.ts`).

## DEC2 — the one live disagreement: param-default, NOT a useRef

The AC text held an internal tension — "resolved once" vs "mirroring the
`progress = readProgress()` default-from-seam pattern" vs "no added component
state." Backend argued for a **useRef** (literal once-at-mount, mirroring
`Onboarding.tsx`); the Tech Lead, Frontend, 3D, and Quality argued for the
**param-default** form. The converged ruling is the **param-default** form
(`channel = readControlChannel()`), on three grounds:

1. The AC explicitly names the `progress = readProgress()` pattern and forbids
   added component state — and a **useRef IS added component state**.
2. `TitleScreen` — unlike `Onboarding`, which has `useState(open)` and a longer
   dwell — has **no state-driven re-render path** that could swap the hint under
   a reading user, so once-at-mount stability buys nothing.
3. It is the **idiom already in this exact file** (`progress`).

"Resolved once" is read as "resolved from the live seam at render" — the same
cheap stateless reading the file already uses for `progress`. This satisfies the
byte-for-byte-keyboard AC because `readControlChannel()` guards `matchMedia` and
resolves to `"keyboard"` under jsdom (no `matchMedia`), keeping the existing
`/WASD/i` test and the omitted-prop default green. **No useRef / useState, no
`input.touchActive` / engine read, no second `matchMedia` call in the component,
no `isPreview`-style boolean, no singleton.**

## DEC3 — tests (failing-first), keyboard byte-for-byte preserved

`src/ui/TitleScreen.test.tsx` adds three tests, leaving the existing `/WASD/i`
controls-hint test green and untouched:

1. `channel="touch"` → `queryByText(/WASD/i)` is **null** AND a POSITIVE
   assertion that the touch words render (`getByText(/drag to drive/i)` and
   `getByText(/tap FLY/i)`) so a blank / empty hint is not a passing regression.
2. `channel="keyboard"` → exact-string
   `getByText("WASD to drive · F to fly · E to reveal a landmark")`.
3. prop omitted under jsdom → the **same** exact keyboard string, proving the
   safe default.

The rendered `textContent` normalises to the single-spaced canonical keyboard
string: the literal is a single module-level const (not wrapped across source
lines), so no whitespace is added or removed and the byte-for-byte AC and the
exact-string test both hold.

## DEC4 — MEASURED `vite build` gzip delta (T3, cited not asserted)

`npm run build` (`tsc --noEmit` + `vite build`) exits **0** on the branch.
Measured branch (HEAD) vs a clean `main` (`af96e76`) — two `npx vite build`
builds in detached worktrees sharing the repo's installed `node_modules` (same
`package-lock.json`, no network). Raw bytes via `wc -c`; gzip reproducibly via
`gzip -9 -c <file> | wc -c`. Script: `scratchpad/measure-gzip-delta.sh`. The
delta is a **MEASURED** build figure, **never an asserted runtime `expect()`** —
there is no runtime expression that yields a bundle-size delta, so a runtime
`expect(delta).toBe(~0)` would be a fabrication (mirrors
`src/world/landmarks.gzip.runlog.test.ts`).

| chunk | `main` raw | `main` gzip-9 | branch raw | branch gzip-9 | gzip Δ |
|-------|-----------:|--------------:|-----------:|--------------:|-------:|
| entry `index-*.js` | 230,015 | 75,859 | 230,109 | **75,871** | **+12 bytes** |
| vendor `three-*.js` | 500,276 | 124,649 | 500,276 | 124,649 | **0 — byte-identical** |
| `index-*.css` | 17,541 | 3,750 | 17,541 | 3,750 | **0 — byte-identical** |

- **Entry-chunk gzip delta: +12 bytes** (raw +94 bytes) — exactly what the
  converged design predicted (one new string literal + a ternary + a
  type / function import from the already-bundled `controlScheme.ts` module). The
  expectation was sub-100-byte growth; the **measured** figure is **+12 bytes
  gzip**, comfortably inside that. This is the honest result — **not** an asserted
  "~0". The `three` vendor chunk (`COLka6mN`) and the CSS (`CEEfcEHH`) are
  **byte-identical**, as expected: `TitleScreen` consumes only the channel from a
  module already in the entry graph; nothing moved into the vendor chunk.
- **Within `docs/perf-budget.md`.** First-load JS is the entry chunk + the
  `three` vendor chunk — **~75.9 KB + ~124.6 KB ≈ 200.5 KB gz** (gzip-9; vite's
  lighter own report reads ~76.05 + ~125.83 KB), tracking the LIVE perf-budget
  figures (~199.1 KB first-load) and well **within** the **400 KB gz** JS cap.
  CSS (3.75 KB gz) is unchanged. Total initial download is far under the 6 MB
  ceiling. **PASS.**

vite's own build report (branch, lighter gzip level than `gzip -9`, for
cross-reference):

```
dist/index.html                   2.05 kB │ gzip:   0.84 kB
dist/assets/index-CEEfcEHH.css   17.54 kB │ gzip:   3.74 kB
dist/assets/index-BshnrCEA.js   230.01 kB │ gzip:  76.05 kB   <- entry chunk
dist/assets/three-COLka6mN.js   500.28 kB │ gzip: 125.83 kB   <- vendor chunk (untouched)
✓ built in 646ms
```

## DEC5 — fully-green `npm test` (no red-allowance)

`npm test` (`vitest run`) is **fully green: 731/731 passing across 80 test
files** on the committed branch tree (this log's own count after the new tests
land). The three new `TitleScreen` channel tests prove the channel→copy mapping
via the injected `channel` prop; the new run-log lint
(`src/ui/titleControlsChannel.runlog.test.ts`) guards this very file. **Zero
exclusions; zero red carried in; none introduced.** The lint asserts the
PRESENCE and SHAPE of the required claims, never a pinned ossifying file / test
count (the stale MOB1 hard-coded-count trap).

## NEEDS VERIFICATION on a real device (no silent on-device pass)

> This heading needs verification on a real device.

Per the charter's standing **on-device-verification-gap** policy, the following
is the non-silent gap this slice **cannot** prove and does **not** claim:

- The channel→copy mapping is **unit-tested via the injected `channel="touch"`**
  prop (DEC3): with `channel="touch"`, `.title-controls` renders the touch copy
  and contains no "WASD"; with `channel="keyboard"` or omitted, it renders the
  exact keyboard line. That is the seam, asserted headlessly.
- The **live `matchMedia('(pointer: coarse)')` resolution** — i.e. that a real
  coarse-pointer phone arriving via the shared link actually resolves to the
  `"touch"` channel and therefore sees `TOUCH_HINT` — is what **needs
  verification on device**. It is **unprovable by headless Vitest** (jsdom has no
  `matchMedia`, so `readControlChannel()` deterministically degrades to
  `"keyboard"` — which is exactly why the omitted-prop default test is the
  keyboard string) and **unprovable by the desktop-Chromium Playwright** smoke
  (a desktop pointer is fine, not coarse). On a physical touchscreen phone,
  confirm the title screen's controls hint reads the touch wording
  ("Drag to drive · tap FLY to fly · tap USE to reveal"), with **no "WASD"**.

This log records that coarse-pointer resolution as a NEEDS-VERIFICATION item; it
is **never asserted** as a pass and this log makes **no affirmative on-device
claim**.

## Scope guardrail (held to slice #142)

Product code + docs only. No new control widgets, no haptics, no
force-scheme / settings toggle, no gamepad onboarding, no HUD / Onboarding
change, **`App.tsx` unchanged**, and **no duplication of the resolver** —
`TitleScreen` consumes only the channel from the existing `controlScheme.ts`
module. The diff is exactly: `src/ui/TitleScreen.tsx`,
`src/ui/TitleScreen.test.tsx`, `src/ui/titleControlsChannel.runlog.test.ts`, and
this run log. **No file under `.claude/` was created, edited, or deleted.**
