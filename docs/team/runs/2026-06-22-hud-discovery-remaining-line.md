# Team Run — 2026-06-22 — HUD "N to go" momentum line (#45)

## Feature

Add a per-landmark "N to go" momentum cue to the discovery HUD so players see
how many landmarks remain, and a clear "All discovered" state at completion —
without introducing a second screen-reader announcer or letting an
empty/unloaded store read as complete.

## Acceptance Criteria

- **AC#1** — The discovery progress badge shows a subordinate "N to go" line
  alongside the existing "Discovered N / total" count, derived as
  `total - discoveredCount`.
- **AC#2** — At completion the line reads "All discovered", driven off the
  store's `completed` flag (already guarded by `total > 0`), never off
  `remaining === 0`, so an empty/unloaded store never reads as complete or
  "0 to go".
- **AC#3** — No second live region: the momentum line is `aria-hidden`, and its
  meaning folds into the badge's single `aria-label`, so there is exactly one
  announcement path (the existing DiscoveryAnnouncer polite region) and no
  double-announce.
- **AC#4** — `npm test` green and `npm run build` (typecheck + bundle) passes;
  no WebGL/draw-call/perf-budget impact (pure DOM/text change in the HUD shell).

## Consensus Design

A thin presentational change confined to the HUD React component plus its CSS.

**Key decisions:**

1. **DERIVED REMAINING** — `remaining = d.total - d.discoveredCount`, computed
   in render from the existing discovery snapshot; no new store field.
2. **COMPLETION OFF `d.completed`** — The "All discovered" branch reads the
   store's derived `completed` flag (guarded `total > 0`), not `remaining === 0`,
   so a zeroed/unloaded store never false-reports completion.
3. **SINGLE ANNOUNCER** — The visible momentum span is `aria-hidden`; its
   content is incorporated into the badge's one `aria-label`
   ("Discovered N of total landmarks, N to go" / "All total landmarks
   discovered"). No new live region; preserves the single-announce invariant.
4. **STYLING** — `.discovery-remaining` rendered as a subordinate cue under the
   badge (smaller, de-emphasized) in `tokens.css`.

**Rejected alternatives:** a new live region for the remaining line (would
double-announce against DiscoveryAnnouncer); deriving completion from
`remaining === 0` (an empty store would false-positive); a new store field for
remaining (pure derivation suffices).

## Task Plan

| ID | Owner | Title | Depends |
|----|-------|-------|---------|
| T1 | frontend | Add per-landmark 'N to go' momentum line to HUD | — |
| T2 | quality  | Cover completed boundary shows 'All discovered' not '0 to go' | T1 |
| T3 | quality  | Assert HUD remaining line adds no second live region | T1 |
| T4 | ux       | Style `.discovery-remaining` as a subordinate cue under the badge | T1 |

## Implementation Summary

- **T1** (frontend, `39eb5c2`) — `remaining` derived in `Hud.tsx`; momentum span
  added; badge `aria-label` extended.
- **T2** (quality, `788f71e`) — `Hud.test.tsx` boundary: completed shows
  "All discovered", not "0 to go".
- **T3** (quality, `3410c58`) — `Hud.test.tsx` asserts no second live region.
- **T4** (ux, `60e4e2b`) — `.discovery-remaining` styled as a subordinate cue
  in `tokens.css`.

## Verification Result

- `npm test` — green: 43 files, 208 tests passed, exit 0.
- `npm run build` (tsc --noEmit + vite build) — passed, exit 0; bundle shape
  unchanged (three.js chunk 477.63 kB / index 210.55 kB).
- Diff confined to `src/ui/Hud.tsx`, `src/ui/Hud.test.tsx`, and `src/tokens.css`.
- No WebGL canvas / draw-call / perf-budget / engine-loop file in the diff.
- All gates green.

## Ship

- **Branch:** `feat/discovery-remaining-style`
- **PR:** (see below)
- **Merged:** yes
