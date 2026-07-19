import { describe, expect, it, vi } from "vitest";
import { createSettingsStore, type Settings } from "./settingsStore.ts";

/** An in-memory Storage shim (no real localStorage), like discovery.test.ts. */
function mem(seed?: Record<string, string>) {
  const m = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

const DEFAULTS: Settings = {
  muted: false,
  quality: "auto",
  reducedMotion: false,
};

describe("settingsStore", () => {
  it("defaults when storage is empty", () => {
    const store = createSettingsStore(mem());
    expect(store.getSnapshot()).toEqual(DEFAULTS);
  });

  it("persists and round-trips changes", () => {
    const storage = mem();
    const store = createSettingsStore(storage);
    store.set({ muted: true, quality: "low" });
    expect(store.getSnapshot()).toEqual({ muted: true, quality: "low", reducedMotion: false });

    // A fresh store reading the same storage sees the persisted values.
    const reloaded = createSettingsStore(storage);
    expect(reloaded.getSnapshot()).toEqual({ muted: true, quality: "low", reducedMotion: false });
  });

  it("returns a stable snapshot reference when a set changes nothing", () => {
    const store = createSettingsStore(mem());
    const first = store.getSnapshot();
    store.set({ muted: false });
    expect(store.getSnapshot()).toBe(first);
  });

  it("emits to subscribers on a real change and stops after unsubscribe", () => {
    const store = createSettingsStore(mem());
    const listener = vi.fn();
    const unsub = store.subscribe(listener);
    store.set({ muted: true });
    expect(listener).toHaveBeenCalledOnce();
    unsub();
    store.set({ muted: false });
    expect(listener).toHaveBeenCalledOnce();
  });

  it("ignores malformed persisted JSON and unknown keys, falling back to defaults", () => {
    expect(createSettingsStore(mem({ "aboutmegame.settings.v1": "{not json" })).getSnapshot()).toEqual(DEFAULTS);
    expect(
      createSettingsStore(mem({ "aboutmegame.settings.v1": JSON.stringify({ quality: "ultra", muted: "yes" }) })).getSnapshot(),
    ).toEqual(DEFAULTS);
  });

  it("loads a persisted reducedMotion:true and round-trips set across a fresh store", () => {
    const storage = mem({
      "aboutmegame.settings.v1": JSON.stringify({ reducedMotion: true }),
    });
    // A persisted true survives load (the validating branch, not the default).
    expect(createSettingsStore(storage).getSnapshot().reducedMotion).toBe(true);

    // A malformed/absent value falls back to the false default.
    expect(createSettingsStore(mem()).getSnapshot().reducedMotion).toBe(false);
    expect(
      createSettingsStore(
        mem({ "aboutmegame.settings.v1": JSON.stringify({ reducedMotion: "yes" }) }),
      ).getSnapshot().reducedMotion,
    ).toBe(false);

    // set persists and a fresh store reads it back true (reload reflection).
    const fresh = mem();
    createSettingsStore(fresh).set({ reducedMotion: true });
    expect(createSettingsStore(fresh).getSnapshot().reducedMotion).toBe(true);
  });

  it("seeds reducedMotion from the OS prefers-reduced-motion when nothing is saved", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("reduce"),
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    }));
    try {
      // No saved choice → the default follows the OS preference (reduce → true),
      // both with and without a storage backend.
      expect(createSettingsStore(mem()).getSnapshot().reducedMotion).toBe(true);
      expect(createSettingsStore(undefined).getSnapshot().reducedMotion).toBe(true);
      // An explicit saved choice still wins over the OS preference.
      const saved = mem({ "aboutmegame.settings.v1": JSON.stringify({ reducedMotion: false }) });
      expect(createSettingsStore(saved).getSnapshot().reducedMotion).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("degrades gracefully when storage is absent", () => {
    const store = createSettingsStore(undefined);
    expect(store.getSnapshot()).toEqual(DEFAULTS);
    store.set({ muted: true }); // must not throw
    expect(store.getSnapshot().muted).toBe(true);
  });
});
