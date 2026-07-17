// The mobile-Safari audio survival net (S4, #89) — everything needed to keep an
// OPTED-IN mix audible on a phone, packaged as one `System` so `buildGame`
// stays pure wiring and this iOS-sensitive behaviour can be unit-tested without
// constructing the whole game:
//
//  - a PERSISTENT resume-on-gesture / resume-on-foreground net (a one-shot
//    unbind goes deaf the first time iOS interrupts the context after the
//    opening tap) — `pointerdown`, `pointerup`, `keydown`, and
//    `visibilitychange → visible`;
//  - the silent-element media-channel unlock: playing any HTML5 media element
//    moves iOS audio onto the *media* channel, which the hardware silent
//    switch does NOT mute (bare Web Audio rides the ringer channel, which it
//    does). The same trick unmute.js shipped; inlined because that library is
//    unmaintained. On-device behaviour is iOS-version-sensitive — see the S4
//    run log for the "needs verification" status of the real-hardware check.
//
// `pointerup` is load-bearing, not belt-and-braces: per the HTML
// user-activation spec, a `pointerdown` whose pointerType is "touch" does NOT
// grant transient activation (only mouse pointerdown, non-mouse pointerup,
// touchend, keydown, mousedown do) — so on the touch devices this net exists
// for, `silent.play()` is only permitted from the `pointerup` half of the tap.
//
// The unlock element respects the player's choice: it never plays while the
// engine is muted (a muted game must not seize the iOS media session and pause
// the player's own music), pauses when the tab hides, and re-arms itself once
// unmuted/visible again. Everything unbinds and unmounts in `dispose`.

import type { System } from "../engine/types.ts";

/** The slice of `AudioEngine` the net needs — injected, so tests drive the net
 *  with a two-property fake instead of a real engine. */
export interface ResumableAudio {
  /** Resume the underlying context (no-op while muted/disposed/running). */
  resume(): void;
  /** The player's live mute choice — gates the silent unlock element. */
  readonly isMuted: boolean;
}

/** 250 ms of silent 8-bit mono WAV as an inline data-URI — 0 download bytes
 *  against the asset budget (~2.7 KB of JS that gzips to almost nothing).
 *  Long enough that the looping element isn't seek-thrashing the media stack
 *  (a 50 ms loop wraps ~20×/s), short enough to stay a trivial constant. */
const SILENT_UNLOCK_SRC =
  "data:audio/wav;base64,UklGRvQHAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YdAHAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==";

/**
 * Install the survival net. Returns a `System` so the engine's dispose tears
 * the whole thing down (listeners unbound, element unmounted). The element is
 * appended to `host` (the game overlay) so its lifecycle is observable and
 * scoped, not floating in `document.body`.
 */
export function installAudioResume(audio: ResumableAudio, host: HTMLElement): System {
  let unbind = () => {};
  let sync = () => {};

  if (typeof window !== "undefined") {
    const silent = document.createElement("audio");
    silent.src = SILENT_UNLOCK_SRC;
    silent.loop = true;
    silent.preload = "auto";
    silent.dataset.silentUnlock = "true";
    silent.setAttribute("aria-hidden", "true");
    host.appendChild(silent);

    // True once a gesture-play has succeeded: from then on iOS permits
    // programmatic re-plays (after an interruption paused the element, or
    // after unmute), so the per-frame sync below may re-arm without a gesture.
    let unlocked = false;

    const tryPlay = () => {
      try {
        const p = silent.play();
        // Very old Safari returns void from play(); treat that as unlocked.
        if (p)
          p.then(() => {
            unlocked = true;
          }).catch(() => {});
        else unlocked = true;
      } catch {
        /* jsdom: play() is unimplemented — the net stays up */
      }
    };
    const pauseSilent = () => {
      try {
        silent.pause();
      } catch {
        /* jsdom: pause() is unimplemented */
      }
    };

    const onGesture = () => {
      audio.resume();
      if (!audio.isMuted && silent.paused) tryPlay();
    };
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        // Hidden tabs don't throttle HTML5 audio the way they throttle rAF —
        // without this, the loop would run in the background indefinitely.
        pauseSilent();
        return;
      }
      onGesture();
    };

    // Keep the element honest against live state every frame: mute (from the
    // pause menu) pauses it — a muted game must not hold the iOS media
    // session — and unmute/interruption-recovery re-arms it once unlocked.
    // rAF is throttled while hidden, so this never fights the hidden pause.
    sync = () => {
      if (audio.isMuted) {
        if (!silent.paused) pauseSilent();
      } else if (silent.paused && unlocked) {
        tryPlay();
      }
    };

    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("pointerup", onGesture);
    window.addEventListener("keydown", onGesture);
    document.addEventListener("visibilitychange", onVisibility);
    unbind = () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("pointerup", onGesture);
      window.removeEventListener("keydown", onGesture);
      document.removeEventListener("visibilitychange", onVisibility);
      pauseSilent();
      silent.removeAttribute("src");
      silent.remove();
    };
  }

  return {
    id: "audio-resume",
    update() {
      sync();
    },
    dispose() {
      unbind();
    },
  };
}
