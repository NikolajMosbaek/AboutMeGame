# S4 — Mobile-Safari Survival: silent-switch & interrupt recovery (#89)

**Date:** 2026-07-17 · **Mode:** direct implementation (user-directed, no team
orchestration this run) · **Slices:** #105, #106, #107 — all three in one PR.

## Problem

Opted-in sound died silently on the target device in three real cases:

1. The iOS hardware **silent switch** mutes bare Web Audio (it routes to the
   ringer channel).
2. An **interruption** (call, backgrounding) leaves the context
   `suspended`/`interrupted`, and the old `installAudioResume` was one-shot —
   it unbound its listeners after the first gesture, so nothing ever resumed
   the context a second time.
3. `visibilitychange` resumed the render loop but never the audio context.

## Decisions

- **Persistent net, one system (#105).** `installAudioResume` keeps its
  `audio-resume` system id but now holds *persistent* `pointerdown`/`keydown`
  and `visibilitychange → visible` listeners; everything unbinds in
  `dispose()`. One system rather than two because the gesture handlers are
  shared between the context resume and the silent-element arm — one concern
  ("keep opted-in audio alive"), one teardown.
- **Silent-element unlock inlined at the composition root (#106).** A looping
  `<audio>` whose src is an inline 50 ms silent WAV **data-URI (0 download
  bytes; ~1.1 KB of JS, gzips to almost nothing — budget after: 394.3/400 KB
  gzip)**. Playing any HTML5 media element moves iOS audio onto the media
  channel, which ignores the silent switch. `unmute.js` is unmaintained since
  2021, so the technique is inlined, not depended on. The element is appended
  to the game overlay (observable, disposed with it), `aria-hidden`, and only
  ever played from a gesture/visibility handler — no autoplay before a gesture.
- **`interrupted` recovery via the frame loop (#107).** `AudioEngine` surfaces
  `contextState` and `recoverIfInterrupted()`; `AudioSystem.update` calls the
  latter every frame. rAF is throttled while hidden, so the first foreground
  frame is exactly when recovery is wanted. `suspended` is deliberately *not*
  recovered there: pre-gesture autoplay holds belong to the gesture net, and
  mute's suspend to `setMuted`.
- **`resume()` now respects mute.** Mute's suspend is a deliberate idle
  economy; a persistent gesture net would have silently resumed the context on
  every tap and burned the audio thread for a muted mix. `setMuted(false)`
  remains the one path that resumes out of mute.

## Verification

- Headless: 1542 tests pass, including new coverage — persistent (multi-fire)
  resume, visibility resume, unlock element mount/play/teardown, no-autoplay,
  muted no-op, `interrupted`-only recovery, per-frame recovery wiring, full
  teardown on dispose.
- `npm run build`, `npm run check:bundle` (394.3/400 KB gzip), `npm run lint`,
  `npm run verify` (Playwright render gate): all green.

## Code-review pass (8-angle finder sweep, verified findings applied)

- **The silent element now respects mute** (flagged by 5 of 8 angles): it never
  plays for a muted player (a muted game must not seize the iOS media session
  and pause the player's own music), a per-frame sync pauses it on mute and
  re-arms it after unmute/interruption once gesture-unlocked, and it pauses
  when the tab hides (hidden tabs don't throttle HTML5 audio).
- **`pointerup` added to the gesture set**: per the HTML user-activation spec a
  touch `pointerdown` grants no transient activation, so `silent.play()` was
  only ever permitted from the up-half of a tap on the exact devices the fix
  targets.
- **`resume()` now skips an already-running context** — the persistent net
  fires on every tap/key-repeat, so it must cost a string compare, not a
  Promise.
- **`contextState` getter deleted** — zero production callers
  (`recoverIfInterrupted` reads the state internally); the constitution's
  "no uncalled API" rule.
- **Net extracted to `src/audio/resumeNet.ts`** with focused unit tests
  (10 cases against a two-property fake); `buildGame` keeps three integration
  pins. The unlock loop grew to 250 ms (8-bit WAV, still a data-URI) to cut
  loop-wrap churn ~5×.
- Declined: sharing one fake AudioContext across test suites (the two fakes
  deliberately serve different depths); merging the two S2 rising-edge tests.

## Needs verification (honest residual)

- **Real-device silent-switch behaviour**: the media-channel trick is
  iOS-version-sensitive and cannot be exercised headless or in desktop
  Playwright. Acceptance criterion 1 of #89 is therefore **needs
  verification** on hardware; the code path (element mounts, plays on first
  gesture, loops) is what the tests pin.
- **Real interruption end-to-end** (an actual phone call): the state machine is
  tested against the fake context's `state`; the on-device round trip is not.
