// Win-record persistence: remember that the expedition was completed — and the
// stats frozen the instant the dig finished — across reloads, in localStorage.
// Mirrors src/discovery/persistence.ts exactly in shape: wrapped so a
// blocked/absent storage (private mode, SSR, tests) degrades to in-memory
// rather than throwing, and a corrupt or foreign payload reads as "no win"
// rather than a false trophy.
//
// The win is the ONE durable artifact of a run — the fixed-seed world makes the
// completion time a real cross-player number, so it must survive a reload.
// Mid-run transient state (position, meters, the live timer) is deliberately
// NOT persisted: a launch is always a clean expedition; only the *completion*
// is remembered. That keeps "Continue" honest (same island, pages you already
// read) without pretending a reload resumes an exact body/position.

const KEY = "aboutmegame.win.v1";

/** The frozen completion record — the stats the win screen shows, captured the
 *  instant the dig finished (so a reload during the finale still keeps the win). */
export interface WinRecord {
  playSeconds: number;
  cluesFound: number;
  cluesTotal: number;
  deaths: number;
  fruitEaten: number;
}

export interface WinPersistence {
  /** The stored win, or null when none / storage is absent / the blob is junk. */
  load(): WinRecord | null;
  save(record: WinRecord): void;
  clear(): void;
}

export function createWinPersistence(
  storage: Storage | undefined = safeLocalStorage(),
): WinPersistence {
  return {
    load() {
      if (!storage) return null;
      try {
        const raw = storage.getItem(KEY);
        if (!raw) return null;
        return parseRecord(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    save(record) {
      if (!storage) return;
      try {
        storage.setItem(KEY, JSON.stringify(sanitize(record)));
      } catch {
        /* quota / blocked — the in-session win still shows */
      }
    },
    clear() {
      try {
        storage?.removeItem(KEY);
      } catch {
        /* ignore */
      }
    },
  };
}

/** A stored payload is a win only if every field is a finite number — a foreign
 *  or truncated blob reads as "no win", never a fake trophy. */
function parseRecord(value: unknown): WinRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const r = value as Record<string, unknown>;
  const keys = ["playSeconds", "cluesFound", "cluesTotal", "deaths", "fruitEaten"] as const;
  for (const k of keys) {
    if (typeof r[k] !== "number" || !Number.isFinite(r[k])) return null;
  }
  return sanitize(r as unknown as WinRecord);
}

/** Clamp to non-negative whole numbers — the record is a display artifact, so a
 *  fractional or negative value would only ever be corruption. */
function sanitize(r: WinRecord): WinRecord {
  const n = (v: number) => Math.max(0, Math.floor(v));
  return {
    playSeconds: n(r.playSeconds),
    cluesFound: n(r.cluesFound),
    cluesTotal: n(r.cluesTotal),
    deaths: n(r.deaths),
    fruitEaten: n(r.fruitEaten),
  };
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}
