// F1 slice 3 (#131) — the real-navigator share adapter.
//
// This is the composition point the useShare contract defers to: useShare.ts
// itself reads zero globals (source-scan enforced), so the ONE place that
// touches `navigator` and `import.meta.env` is this leaf module, imported only
// by UI composition code. The builder is pure and unit-testable with plain
// fakes; the module-level consts read the globals once at import time (fine in
// browser and jsdom alike) and give useShare's `useCallback` the referential
// stability its contract requires — by construction, not by memo discipline.

import type { ShareCapabilities } from "./useShare.ts";
import { socialUrlHref } from "../share/socialMeta.ts";

/**
 * The slice of `navigator` this adapter reads — structural, so the real
 * `Navigator` and plain test fakes both fit without casts.
 */
export interface ShareNavigatorLike {
  share?: (data: { url: string }) => Promise<void>;
  clipboard?: ShareCapabilities["clipboard"];
}

/**
 * Build {@link ShareCapabilities} from a navigator-shaped object.
 *
 * - `share` is **arrow-wrapped**, never passed through as a bare reference:
 *   `navigator.share` is this-sensitive and throws "Illegal invocation" when
 *   called with the wrong receiver, so the wrapper always invokes it as a
 *   method on `nav`.
 * - `clipboard` passes through unchanged — performShare calls `writeText` as
 *   a method on the clipboard object, so its `this` binding survives intact.
 */
export function shareCapabilitiesFrom(nav: ShareNavigatorLike): ShareCapabilities {
  return {
    // The non-null assertion is sound: the ternary guard proved `nav.share`
    // is a function, and the arrow re-reads it off `nav` (a method call) so
    // the receiver — and therefore `this` — is preserved.
    share:
      typeof nav.share === "function" ? (data) => nav.share!(data) : undefined,
    clipboard: nav.clipboard,
  };
}

/**
 * The real capabilities, built once at module scope so every render of the
 * consuming component sees the same object identity (useShare's `useCallback`
 * is keyed on it).
 */
export const realShareCapabilities: ShareCapabilities =
  shareCapabilitiesFrom(navigator);

/**
 * The canonical share URL: origin + Vite base from the single existing source
 * (F1 slice 1, #129). NOTE: under the dev server BASE_URL is "/", so dev
 * shares copy `https://nikolajmosbaek.github.io/` — a wrong link missing the
 * `/AboutMeGame/` base. Dev-only; production builds carry the full base.
 */
export const realShareUrl: string = socialUrlHref(import.meta.env.BASE_URL);
