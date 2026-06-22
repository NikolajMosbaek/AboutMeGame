// Onboarding "seen" flag (#43): remember that the first-run controls overlay was
// dismissed, so it only shows once. Same localStorage robustness as
// discovery/persistence.ts — a blocked/absent storage (private mode, SSR, tests)
// degrades to "not seen" rather than throwing (worst case the overlay re-shows).

const KEY = "aboutmegame.onboarding.v1";

export interface OnboardingPersistence {
  seen(): boolean;
  markSeen(): void;
}

export function createOnboardingPersistence(
  storage: Storage | undefined = safeLocalStorage(),
): OnboardingPersistence {
  return {
    seen() {
      if (!storage) return false;
      try {
        return storage.getItem(KEY) === "1";
      } catch {
        return false;
      }
    },
    markSeen() {
      if (!storage) return;
      try {
        storage.setItem(KEY, "1");
      } catch {
        /* quota / blocked — the overlay may re-show next session */
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
