// F1 slice 2 (#130) — Web-Share with clipboard fallback, as injectable logic.
//
// This module is the React-shell's share behaviour with ZERO global reads: the
// capabilities (share sheet, clipboard) AND the page url are required injected
// inputs — no navigator, window, location, or document anywhere in the code,
// enforced by a comment-stripped source-scan test in useShare.test.tsx. All
// branching lives in the pure async core `performShare` (house pattern:
// discoveryAnnounce.ts / deviceCapability.ts); `useShare` is a thin, stateless
// useCallback binder. The composition point — real navigator wiring, the
// button, the live region — is #131's job, not this module's.

import { useCallback } from "react";

/**
 * The result of one share attempt — a **closed four-member union** so the
 * caller (#131) can exhaustiveness-check with a `never` guard and map each
 * outcome to an announcement with zero further branching.
 *
 * Recommended announcement per outcome:
 *
 * - `"shared"` — the native share sheet accepted the URL. Announcement:
 *   **optional / none** — the OS provides its own feedback.
 * - `"copied"` — the URL landed on the clipboard (primary path or fallback).
 *   Announcement: **"Link copied", mandatory** — nothing visible happened
 *   otherwise, so silence reads as a broken button.
 * - `"cancelled"` — the user dismissed the share sheet (an `AbortError`
 *   rejection). Announcement: **silence** — the user acted deliberately; do
 *   not nag.
 * - `"failed"` — no capability succeeded. Announcement: **recoverable copy**,
 *   e.g. "Couldn't share — copy the link from the address bar."
 */
export type ShareOutcome = "shared" | "copied" | "cancelled" | "failed";

/**
 * The injected share/clipboard capabilities. Structurally this mirrors the
 * slice of `navigator` the feature needs, but the module itself never reads a
 * global — the composition point (#131) wires the real thing:
 *
 * ```ts
 * const capabilities: ShareCapabilities = {
 *   // Arrow-wrap navigator.share: an unbound method reference loses its
 *   // `this` and throws "Illegal invocation" when called.
 *   share: "share" in navigator ? (data) => navigator.share(data) : undefined,
 *   clipboard: navigator.clipboard,
 * };
 * ```
 *
 * `writeText` is optional on an optional `clipboard` so partial-capability
 * WebViews (clipboard object present, method missing) route to `"failed"`
 * via a `typeof` function check instead of throwing.
 */
export interface ShareCapabilities {
  share?: (data: { url: string }) => Promise<void>;
  clipboard?: { writeText?: (text: string) => Promise<void> };
}

/**
 * Attempt to share `url` using the injected capabilities, degrading
 * gracefully. Pure async core — all branching is here so the hook stays a
 * stateless binder and every path is unit-testable with plain fakes.
 *
 * Decision ladder:
 *
 * 1. `capabilities.share` present → it is invoked **synchronously** (no
 *    `await` before the capability call, preserving the user gesture's
 *    transient activation) with `{ url }` → resolves `"shared"`.
 * 2. share rejects or synchronously throws with `err?.name === "AbortError"`
 *    (a string check, never `instanceof`) → resolves `"cancelled"`; the
 *    clipboard is positively NOT touched.
 * 3. share rejects/throws with anything else → the clipboard fallback is
 *    **awaited**: fulfilled → `"copied"`; rejected, thrown, or absent →
 *    `"failed"`. (On Safari both APIs are gesture-gated, so a
 *    NotAllowedError-after-NotAllowedError is the expected real-device path.)
 * 4. share absent and `clipboard.writeText` is a function → `writeText(url)`
 *    → `"copied"`; rejected/thrown → `"failed"`.
 * 5. Neither capability usable → `"failed"`.
 *
 * The returned promise **never rejects** on any path — synchronous throws
 * from either capability and non-Error rejection values (strings, undefined)
 * are all classified, so a fire-and-forget caller cannot create an unhandled
 * rejection.
 */
export async function performShare(
  capabilities: ShareCapabilities,
  url: string,
): Promise<ShareOutcome> {
  // Contract-only stub: the decision ladder above lands in the next #130
  // task, test-first against the matrix in useShare.test.tsx.
  void capabilities;
  void url;
  throw new Error("performShare: not implemented — contract-only slice");
}

/**
 * React binding for {@link performShare}: returns a `share()` whose identity
 * is stable via `useCallback` keyed on `[capabilities, url]`. Stateless — the
 * outcome is returned to the caller, never held in the hook; #131 owns the
 * announcement state and the live region.
 *
 * Caller obligations (#131's composition point):
 *
 * - **Disable the CTA while a `share()` call is pending.** There is no
 *   re-entrancy latch in here; double-tap protection is the button's
 *   disabled state. Concurrent calls each resolve independently.
 * - **Pass referentially stable `capabilities` and `url`** (module-level or
 *   memoized) — the `useCallback` identity guarantee is conditional on it.
 * - **Arrow-wrap `navigator.share`** when building the capabilities (see
 *   {@link ShareCapabilities}); an unbound reference throws
 *   "Illegal invocation".
 * - **Inject `socialUrlHref(import.meta.env.BASE_URL)`** from
 *   `src/share/socialMeta.ts` as the canonical share URL — the single
 *   existing source of the deploy origin + base (F1 slice 1, #129), not an
 *   open decision.
 */
export function useShare(
  capabilities: ShareCapabilities,
  url: string,
): { share: () => Promise<ShareOutcome> } {
  const share = useCallback(
    () => performShare(capabilities, url),
    [capabilities, url],
  );
  return { share };
}
