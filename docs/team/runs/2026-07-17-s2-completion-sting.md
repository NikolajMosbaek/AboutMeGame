# S2 — Reward & UI Feedback: the completion sting (#87, slices #97/#98)

**Date:** 2026-07-17 · **Mode:** direct implementation (user-directed, no team
orchestration this run) · **Scope:** slices 1–2 only, per the PO trim (#115):
the UI-cue slices (#99/#100) were closed out-of-scope with the rest of the
unrequested Sound track.

## Problem

Finding the last site — the game's single largest emotional beat — replayed the
ordinary per-find chime. No payoff.

## Decisions

- **`completion()` synth (#97):** a three-note ascent (C5–E5–G5) resolving into
  a held C-major chord with the octave on top, ~1.2 s, built entirely from the
  existing `blip()` primitive — 7 one-shot oscillators that stop themselves,
  0 asset bytes. Distinct from the per-find `chime` (2 notes) and the finale
  `fanfare` (4-note run).
- **Duck without a bus:** S1's bus/duck backbone was closed out-of-scope
  (#115), so the sting dips the ambient bed's own gain to 25 % and restores it
  after 1.2 s. `setAmbientPhase` may schedule its own slow crossfade in that
  window; both ramps converge on the bed's level, so the worst case is a
  slightly early recovery, never a stuck duck.
- **Rising edge, mount-safe (#98):** fired from `AudioSystem`'s existing
  discovery-store subscription. Both baselines (`discoveredCount`,
  `completed`) are captured at mount, so restored saved progress never
  re-chimes and a reload already at full completion never re-stings.
- **The sting replaces the chime on the completing find.** The payoff moment
  shouldn't play the ordinary chime underneath its own reward — one find, one
  sound. The pre-existing chime test was updated to pin this.

## Verification

- Headless: 1547 tests pass. New coverage: 7-voice one-shot, mute gate,
  bed duck + restore ordering (restore lands ≥ 1 s out), no-bed safety,
  rising-edge sting exactly once, chime replacement on the final find, no
  re-sting on unchanged writes, no sting for a mount already at full.
- `npm run build` · `check:bundle` **394.5 / 400 KB gzip** · `lint` ·
  `npm run verify` (Playwright render gate): all green.

## Code-review pass (8-angle finder sweep, verified findings applied)

- **In-flight crossfade cancelled before the duck**: a leftover
  `setAmbientPhase` ramp event would have un-ducked the bed mid-sting and then
  hard-stepped back down (an audible pop at the game's biggest beat).
  `cancelScheduledValues` joined `AudioParamLike` and the duck cancels first;
  the next phase drift re-schedules the crossfade against the same target.
- **One bed-level source**: the `AMBIENT_DAY/NIGHT_GAIN` interpolation now
  lives in a single `bedLevelFor(night)` shared by `setAmbientPhase` and the
  duck restore — a retune can't desynchronise them.
- **`lastCompleted` deleted**: `completed` is derived from the count
  (`discoveryStore`), so inside the count-increase branch the previous
  `completed` is necessarily false — the extra baseline was redundant state.
- Test hygiene: `makeSystem` accepts a pre-seeded store, replacing two
  hand-rolled 11-argument constructions.

## Notes

Audio is never the sole feedback channel here: completion already has the
existing visual completion arc (CompletionPanel). Stacked on the S4 branch
(PR #214) because both touch `AudioEngine`/`AudioSystem` and their fakes.
