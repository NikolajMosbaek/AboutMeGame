import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installAudioResume } from "./resumeNet.ts";
import type { FrameContext } from "../engine/types.ts";

// The net is driven with a two-property fake audio (no real engine, no game
// build) and jsdom's real event plumbing. jsdom has no media pipeline, so
// play/pause are stubbed on the prototype — in beforeEach/afterEach, so a
// failing assertion can never leak the stubs into other suites.

const CTX: FrameContext = { scene: {} as never, camera: {} as never, dt: 0.016, elapsed: 0 };

function fakeAudio(muted = false) {
  return { resume: vi.fn(), isMuted: muted };
}

/** Force jsdom's readonly `paused` (always true there) to a chosen value. */
function setPaused(el: HTMLAudioElement, paused: boolean) {
  Object.defineProperty(el, "paused", { get: () => paused, configurable: true });
}

describe("installAudioResume (S4 survival net)", () => {
  let play: ReturnType<typeof vi.spyOn>;
  let pause: ReturnType<typeof vi.spyOn>;
  let host: HTMLElement;

  beforeEach(() => {
    play = vi
      .spyOn(window.HTMLMediaElement.prototype, "play")
      .mockImplementation(async () => {});
    pause = vi
      .spyOn(window.HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    host = document.createElement("div");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const element = () => host.querySelector<HTMLAudioElement>("audio[data-silent-unlock]");

  it("keeps resuming on every gesture — persistent, not one-shot (#105)", () => {
    const audio = fakeAudio();
    const sys = installAudioResume(audio, host);

    window.dispatchEvent(new Event("pointerdown"));
    window.dispatchEvent(new Event("pointerdown"));
    window.dispatchEvent(new Event("pointerup"));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    expect(audio.resume).toHaveBeenCalledTimes(4);

    sys.dispose?.();
  });

  it("resumes when the tab becomes visible again (#105)", () => {
    const audio = fakeAudio();
    const sys = installAudioResume(audio, host);

    // jsdom's visibilityState is "visible" — this exercises the foreground branch.
    document.dispatchEvent(new Event("visibilitychange"));
    expect(audio.resume).toHaveBeenCalledTimes(1);

    sys.dispose?.();
  });

  it("mounts a looping silent data-URI element; no autoplay before a gesture (#106)", () => {
    const audio = fakeAudio();
    const sys = installAudioResume(audio, host);

    const el = element();
    expect(el).not.toBeNull();
    expect(el?.loop).toBe(true);
    // 0 download bytes: the loop is an inline data-URI, not a fetched asset.
    expect(el?.src.startsWith("data:audio/wav;base64,")).toBe(true);
    expect(play).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("pointerdown"));
    expect(play).toHaveBeenCalled();

    sys.dispose?.();
  });

  it("arms from pointerup too — touch pointerdown grants no user activation (#106)", () => {
    const audio = fakeAudio();
    const sys = installAudioResume(audio, host);

    window.dispatchEvent(new Event("pointerup"));
    expect(play).toHaveBeenCalled();

    sys.dispose?.();
  });

  it("never plays the unlock element for a muted player (#106)", () => {
    const audio = fakeAudio(true);
    const sys = installAudioResume(audio, host);

    window.dispatchEvent(new Event("pointerdown"));
    window.dispatchEvent(new Event("pointerup"));
    document.dispatchEvent(new Event("visibilitychange"));
    // The context resume still fires (the engine owns its own mute guard),
    // but the media channel is never seized for a muted mix.
    expect(audio.resume).toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();

    sys.dispose?.();
  });

  it("pauses a playing unlock element when the player mutes (per-frame sync)", () => {
    const audio = fakeAudio();
    const sys = installAudioResume(audio, host);
    setPaused(element()!, false); // as if the first gesture already armed it

    audio.isMuted = true;
    sys.update(CTX);
    expect(pause).toHaveBeenCalled();

    sys.dispose?.();
  });

  it("re-arms a paused element after unmute/interruption, once gesture-unlocked", async () => {
    const audio = fakeAudio();
    const sys = installAudioResume(audio, host);

    window.dispatchEvent(new Event("pointerup")); // gesture-play succeeds…
    await Promise.resolve(); // …and the unlocked flag lands on the microtask
    await Promise.resolve();
    play.mockClear();

    // Element is paused (an interruption, or a mute round-trip) but the mix
    // is opted-in again — the next frame re-arms it without a gesture.
    sys.update(CTX);
    expect(play).toHaveBeenCalled();

    sys.dispose?.();
  });

  it("does not re-arm per frame before any gesture ever unlocked playback", () => {
    const audio = fakeAudio();
    const sys = installAudioResume(audio, host);

    sys.update(CTX);
    sys.update(CTX);
    expect(play).not.toHaveBeenCalled();

    sys.dispose?.();
  });

  it("pauses the loop when the tab hides — hidden tabs don't throttle HTML5 audio", () => {
    const audio = fakeAudio();
    const sys = installAudioResume(audio, host);

    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(pause).toHaveBeenCalled();
    expect(audio.resume).not.toHaveBeenCalled(); // hidden ⇒ no resume attempt
    visibility.mockRestore();

    sys.dispose?.();
  });

  it("tears everything down on dispose: listeners unbound, element gone (#105/#106)", () => {
    const audio = fakeAudio();
    const sys = installAudioResume(audio, host);

    sys.dispose?.();
    expect(element()).toBeNull();

    window.dispatchEvent(new Event("pointerdown"));
    window.dispatchEvent(new Event("pointerup"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(audio.resume).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });
});
