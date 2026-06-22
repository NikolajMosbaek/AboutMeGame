// Discovery persistence (issue #39): remember which landmarks the player has
// revealed, across reloads, in localStorage. Wrapped so a blocked/absent storage
// (private mode, SSR, tests) degrades to in-memory rather than throwing.

const KEY = "aboutmegame.discovered.v1";

export interface DiscoveryPersistence {
  load(): Set<string>;
  save(ids: Set<string>): void;
  clear(): void;
}

export function createPersistence(
  storage: Storage | undefined = safeLocalStorage(),
): DiscoveryPersistence {
  return {
    load() {
      if (!storage) return new Set();
      try {
        const raw = storage.getItem(KEY);
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? new Set(arr.filter((x) => typeof x === "string")) : new Set();
      } catch {
        return new Set();
      }
    },
    save(ids) {
      if (!storage) return;
      try {
        storage.setItem(KEY, JSON.stringify([...ids]));
      } catch {
        /* quota / blocked — discovery still works in-session */
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

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}
