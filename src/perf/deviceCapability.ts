// Device-capability detection (#47).
//
// A coarse hardware tier — "low" | "medium" | "high" — derived from the cheap
// signals a browser exposes. It's the input to the quality scaler (quality.ts):
// in "auto" mode the detected tier picks the render budget. Kept a *pure*
// function of an injectable `CapabilityEnv` so it's unit-testable with fakes and
// reads no globals itself; `readEnv()` is the only place real `navigator`/
// `window` are touched, and it degrades safely when a signal is absent.

export type DeviceTier = "low" | "medium" | "high";

/** The hardware signals the tier is derived from. All optional/raw — `readEnv`
 *  fills them from the platform; tests supply their own. */
export interface CapabilityEnv {
  /** Logical CPU cores (`navigator.hardwareConcurrency`), or undefined if absent. */
  hardwareConcurrency: number | undefined;
  /** Approx device RAM in GB (`navigator.deviceMemory`), or undefined if absent.
   *  Only Chromium exposes it, so it's a bonus signal, never required. */
  deviceMemory: number | undefined;
  /** `window.devicePixelRatio` — a high DPR multiplies fill cost. */
  devicePixelRatio: number;
  /** True when the primary pointer is coarse (`pointer: coarse`) — a touch
   *  device, which we never trust to match a desktop GPU. */
  coarsePointer: boolean;
  /** `navigator.maxTouchPoints` — a second, cheaper touch signal. */
  maxTouchPoints: number;
}

/**
 * Map the raw signals to a tier. The bias is conservative: missing signals land
 * on "medium" (never assume a powerhouse), and any touch/coarse-pointer device
 * is capped at "medium" no matter how many cores it reports — a phone SoC with 8
 * cores still can't carry a desktop-high render budget.
 */
export function detectTier(env: CapabilityEnv): DeviceTier {
  const cores = env.hardwareConcurrency ?? 4; // unknown ⇒ assume a modest 4
  const mem = env.deviceMemory ?? 4; // unknown ⇒ assume a modest 4 GB
  const isTouch = env.coarsePointer || env.maxTouchPoints > 0;

  // Low: clearly weak — few cores or little memory. A high-DPR touch screen is
  // an extra cost signal that nudges a borderline phone down.
  if (cores <= 2 || mem <= 2) return "low";
  if (isTouch && mem <= 3 && env.devicePixelRatio >= 2) return "low";

  // High: a desktop-class machine only — plenty of cores and memory, and not a
  // touch device. Touch caps out at medium below.
  if (!isTouch && cores >= 8 && mem >= 8) return "high";

  // Everything else — mid laptops, capable phones, unknown hardware.
  return "medium";
}

/** Read the real platform signals, guarding every one so SSR/jsdom/old browsers
 *  don't throw. The single impure entry point; everything else is pure. */
export function readEnv(): CapabilityEnv {
  const nav: Partial<Navigator & { deviceMemory?: number }> =
    typeof navigator !== "undefined" ? navigator : {};
  const coarsePointer =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(pointer: coarse)").matches
      : false;
  return {
    hardwareConcurrency:
      typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : undefined,
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : undefined,
    devicePixelRatio:
      typeof window !== "undefined" && typeof window.devicePixelRatio === "number"
        ? window.devicePixelRatio
        : 1,
    coarsePointer,
    maxTouchPoints: typeof nav.maxTouchPoints === "number" ? nav.maxTouchPoints : 0,
  };
}

/** Convenience: detect the tier of the real device. Defers to the pure pair so
 *  callers can still inject a fake env in tests. */
export function detectDeviceTier(env: CapabilityEnv = readEnv()): DeviceTier {
  return detectTier(env);
}
