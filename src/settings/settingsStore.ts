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
  quality: Quality;
  reducedMotion: boolean;
}

export interface SettingsStore {
  getSnapshot(): Settings;
  subscribe(listener: () => void): () => void;
  /** Merge a partial update; persists and notifies only on a real change. */
  set(patch: Partial<Settings>): void;
}

const DEFAULTS: Settings = {
  muted: false,
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

/** Read + validate persisted settings, dropping anything malformed. */
function load(storage: Storage | undefined): Settings {
  if (!storage) return { ...DEFAULTS };
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      muted: typeof parsed.muted === "boolean" ? parsed.muted : DEFAULTS.muted,
      quality: isQuality(parsed.quality) ? parsed.quality : DEFAULTS.quality,
      reducedMotion:
        typeof parsed.reducedMotion === "boolean" ? parsed.reducedMotion : DEFAULTS.reducedMotion,
    };
  } catch {
    return { ...DEFAULTS };
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

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}
