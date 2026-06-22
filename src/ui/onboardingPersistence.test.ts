import { describe, expect, it } from "vitest";
import { createOnboardingPersistence } from "./onboardingPersistence.ts";

/** In-memory Storage shim (no real localStorage), like discovery.test.ts. */
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

describe("onboarding persistence", () => {
  it("reports not-seen on a fresh storage", () => {
    expect(createOnboardingPersistence(mem()).seen()).toBe(false);
  });

  it("records and round-trips the seen flag", () => {
    const storage = mem();
    const p = createOnboardingPersistence(storage);
    p.markSeen();
    expect(p.seen()).toBe(true);
    // A fresh reader over the same storage still sees it.
    expect(createOnboardingPersistence(storage).seen()).toBe(true);
  });

  it("degrades to not-seen when storage throws (blocked / private mode)", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    const p = createOnboardingPersistence(blocked);
    expect(p.seen()).toBe(false);
    p.markSeen(); // must not throw
    expect(p.seen()).toBe(false);
  });
});
