// Observable, persisted settings (#41) — muted / quality / reducedMotion. The
// pause menu (SettingsMenu) writes it; consumers (audio, quality) land in later
// epics, so for now the store just persists. Same observable pattern as the
// discovery/hud stores (cached snapshot for useSyncExternalStore), and the same
// localStorage robustness as discovery/persistence.ts: a blocked/absent storage
// (private mode, SSR, tests) degrades to in-memory rather than throwing.

const KEY = "aboutmegame.settings.v1";

export type Quality = "auto" | "low" | "high";

export interface Settings {
  muted: boolean;
  /** Master volume, 0..1. Scales the engine's master gain; independent of
   *  `muted` (mute still silences whatever the volume is). */
  volume: number;
  /** Mouse/touch look-speed multiplier, clamped to [SENSITIVITY_MIN,
   *  SENSITIVITY_MAX]. 1 = the built-in rate; the explorer scales its look
   *  deltas by it. */
  lookSensitivity: number;
  /** Invert the vertical look axis (push up → look down), a common comfort
   *  preference for first-person games. */
  invertY: boolean;
  quality: Quality;
  reducedMotion: boolean;
}

/** Usable bounds for the look-sensitivity multiplier — shared by the load-time
 *  clamp and the settings slider so a stored value can never freeze or whip the
 *  view, and the UI can't offer an out-of-range value. */
export const SENSITIVITY_MIN = 0.2;
export const SENSITIVITY_MAX = 3;

export interface SettingsStore {
  getSnapshot(): Settings;
  subscribe(listener: () => void): () => void;
  /** Merge a partial update; persists and notifies only on a real change. */
  set(patch: Partial<Settings>): void;
}

const DEFAULTS: Settings = {
  muted: false,
  volume: 1,
  lookSensitivity: 1,
  invertY: false,
  quality: "auto",
  reducedMotion: false,
};
const QUALITIES: readonly Quality[] = ["auto", "low", "high"];

export function createSettingsStore(
  storage: Storage | undefined = safeLocalStorage(),
): SettingsStore {
  const listeners = new Set<() => void>();
  // Cached snapshot — a new object only on a real change, so React doesn't loop.
  let snapshot: Settings = load(storage);

  const changed = (patch: Partial<Settings>): boolean =>
    (Object.keys(patch) as Array<keyof Settings>).some((k) => patch[k] !== snapshot[k]);

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(patch) {
      if (!changed(patch)) return;
      snapshot = { ...snapshot, ...patch };
      save(storage, snapshot);
      for (const l of listeners) l();
    },
  };
}

/** Runtime defaults: like DEFAULTS but with `reducedMotion` seeded from the OS
 *  `prefers-reduced-motion` preference. So a first run with no saved choice
 *  already honours a system-level reduced-motion setting for the JS-gated world
 *  motion (head-bob, FX, sprint FOV, damage flash) — not only the CSS the media
 *  query covers. An explicit in-game choice, once saved, still wins over this. */
function runtimeDefaults(): Settings {
  return { ...DEFAULTS, reducedMotion: prefersReducedMotion() };
}

/** Read + validate persisted settings, dropping anything malformed. */
function load(storage: Storage | undefined): Settings {
  const base = runtimeDefaults();
  if (!storage) return base;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      muted: typeof parsed.muted === "boolean" ? parsed.muted : base.muted,
      volume: isVolume(parsed.volume) ? clamp01(parsed.volume) : base.volume,
      lookSensitivity: isVolume(parsed.lookSensitivity)
        ? clampSensitivity(parsed.lookSensitivity)
        : base.lookSensitivity,
      invertY: typeof parsed.invertY === "boolean" ? parsed.invertY : base.invertY,
      quality: isQuality(parsed.quality) ? parsed.quality : base.quality,
      reducedMotion:
        typeof parsed.reducedMotion === "boolean" ? parsed.reducedMotion : base.reducedMotion,
    };
  } catch {
    return base;
  }
}

function save(storage: Storage | undefined, settings: Settings): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* quota / blocked — settings still apply in-session */
  }
}

function isQuality(v: unknown): v is Quality {
  return typeof v === "string" && (QUALITIES as readonly string[]).includes(v);
}

function isVolume(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Clamp a persisted/updated volume into the valid 0..1 range. */
function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Clamp look sensitivity into its usable range (never 0/negative → frozen or
 *  inverted-by-magnitude look, never absurdly high → whip). */
function clampSensitivity(v: number): number {
  return Math.min(SENSITIVITY_MAX, Math.max(SENSITIVITY_MIN, v));
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

/** The OS's `prefers-reduced-motion: reduce` preference, guarded like storage
 *  above: a missing `matchMedia` (SSR, jsdom without a stub) degrades to false
 *  rather than throwing. */
function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
