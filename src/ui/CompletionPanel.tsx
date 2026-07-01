import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { DiscoveryStore, DiscoverySnapshot } from "../discovery/discoveryStore.ts";
import { completionFor } from "./discoveryComplete.ts";
import { useShare } from "./useShare.ts";
import type { ShareCapabilities } from "./useShare.ts";
import { realShareCapabilities, realShareUrl } from "./shareCapabilities.ts";
import { shareAnnouncementFor } from "./shareAnnouncement.ts";

export interface CompletionPanelProps {
  store: DiscoveryStore;
  /** Ordered landmark list (from game.discovery.pois, sorted by `order`). */
  pois: { order: number; title: string }[];
  /** Restart discovery from zero (wired to game.discovery.reset()). */
  onReplay: () => void;
  /**
   * The canvas container — focus returns here on dismiss/replay, since the panel
   * has no opener element to restore to. Optional so the panel can mount before
   * the container exists; focus return is simply skipped until it does.
   */
  containerRef?: RefObject<HTMLElement | null>;
  /**
   * Notified when the panel raises/lowers, so the shell can lift a
   * `completionOpen` flag and make its Escape menu-opener bail while the panel
   * is up (mirrors Onboarding's `onOpenChange`).
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Share/clipboard capabilities for the Share CTA — defaults to the
   * real-navigator adapter (src/ui/shareCapabilities.ts). Tests inject plain
   * fakes here; no navigator stubbing. Must be referentially stable (the
   * default is a module-level const; a test's literal is stable per render
   * tree) per useShare's useCallback contract.
   */
  shareCapabilities?: ShareCapabilities;
  /** The URL the Share CTA shares — defaults to the canonical deploy URL. */
  shareUrl?: string;
}

/**
 * The completion moment (the panel shown once the final landmark's reveal is
 * closed). Detection lives entirely here, in a direct store subscriber, using a
 * PERSISTENT `armed` latch rather than a one-frame consumed edge:
 *
 *  • On each snapshot, `completionFor(prev, next)` flags the rising edge of
 *    `completed`. That edge occurs on the 13th-find frame while a reveal is
 *    still open (`open != null`), so we cannot show the panel then. Instead we
 *    set `armed` and leave it set — it survives every snapshot in between.
 *  • On each snapshot we also check `armed && next.open === null`; only then do
 *    we raise the visible panel and clear `armed`. Gating the *show* (not the
 *    *arm*) on `open === null` is what makes the latch immune to the edge
 *    landing while the final reveal is open.
 *
 * Subscribed directly (not via useSyncExternalStore) because it needs the
 * previous snapshot to detect the edge; seeds `prevRef` from `getSnapshot()`
 * before subscribing so a 13/13 reload never fires for already-saved progress.
 *
 * Accessibility (T6, trap reworked in F1 slice 3): a `role="dialog"`
 * `aria-modal` surface labelled by its header. Focus enters on the primary CTA
 * and Tab / Shift+Tab cycle through the dialog's enabled buttons; Escape and a
 * backdrop click dismiss to free-roam; on any dismiss focus returns to the
 * canvas container. The trap contains Tab and Escape ONLY — movement input
 * listens on window unconditionally (src/movement/input.ts), so WASD still
 * reaches the unpaused sim while the panel is up; the trap is not what stops
 * that.
 */
export function CompletionPanel({
  store,
  pois,
  onReplay,
  containerRef,
  onOpenChange,
  shareCapabilities = realShareCapabilities,
  shareUrl = realShareUrl,
}: CompletionPanelProps) {
  const [shown, setShown] = useState(false);
  const [pending, setPending] = useState(false);
  // The share-outcome message, rendered on BOTH surfaces (the sr-only live
  // region and the visible mirror line); null = say nothing / show nothing.
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const { share } = useShare(shareCapabilities, shareUrl);
  const prevRef = useRef<DiscoverySnapshot | null>(null);
  const armedRef = useRef(false);
  const replayRef = useRef<HTMLButtonElement>(null);
  const shareRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Liveness token for in-flight shares: bumped on every dismiss, captured at
  // click. Every path to hiding the panel runs through dismiss(), so
  // "generation unchanged" implies "panel still shown since this click" — one
  // check covers both liveness conditions.
  const shareGenRef = useRef(0);
  // Set (inside the generation guard only) when native `disabled` dropped
  // focus out of the dialog during a pending share; consumed by the
  // focus-restore effect below once the CTA re-enables.
  const restoreShareFocusRef = useRef(false);

  useEffect(() => {
    // Seed the baseline so saved progress at mount isn't read as a fresh edge.
    prevRef.current = store.getSnapshot();
    const onChange = () => {
      const next = store.getSnapshot();
      // Persistent arm on the rising edge — never cleared per-frame.
      if (completionFor(prevRef.current, next)) armedRef.current = true;
      prevRef.current = next;
      // Raise the panel only once the final reveal has closed.
      if (armedRef.current && next.open === null) {
        armedRef.current = false;
        setShown(true);
      }
    };
    return store.subscribe(onChange);
  }, [store]);

  // Lift the open/close state so GameCanvas's Escape menu-opener bails while up.
  useEffect(() => {
    onOpenChange?.(shown);
  }, [shown, onOpenChange]);

  // Lower the panel and return focus to the canvas container (the panel has no
  // opener to restore to). `onDismiss` lets GameCanvas clear `completionOpen`.
  // Bumping the share generation invalidates any in-flight share's cosmetics
  // (announcement + focus restore — never the pending clear), and resetting
  // the message matters because the component renders null while hidden but
  // never unmounts: without it, stale text would survive to a re-raised panel.
  const dismiss = useCallback(() => {
    shareGenRef.current += 1;
    setAnnouncement(null);
    setShown(false);
    containerRef?.current?.focus();
  }, [containerRef]);

  const handleReplay = useCallback(() => {
    onReplay();
    dismiss();
  }, [onReplay, dismiss]);

  // Share the canonical URL. `share()` is invoked with no preceding await —
  // an async function body runs synchronously up to its first await, and
  // performShare calls the capability before ITS first await — so the share
  // sheet opens inside the click gesture's transient activation (iOS gates
  // navigator.share on it). setPending(false) is an UNCONDITIONAL finally:
  // the panel renders null while hidden but never unmounts (see the early
  // return below), so the setState is safe after a mid-pending dismissal —
  // and a liveness-gated clear would leave a sticky latch bricking Share for
  // the session. share() never rejects (performShare's contract), but
  // finally keeps the latch structurally unstickable either way.
  //
  // Only the COSMETICS — the outcome announcement and the focus-restore flag
  // — sit behind the generation guard: dismiss() bumps the token, so an
  // unchanged token means the panel has stayed up since this click. For
  // "cancelled"/"shared" the mapped message is null (deliberate silence),
  // which also clears any previous message without speaking.
  const handleShare = useCallback(async () => {
    const gen = shareGenRef.current;
    setPending(true);
    try {
      const outcome = await share();
      if (shareGenRef.current === gen) {
        setAnnouncement(shareAnnouncementFor(outcome));
        // Native `disabled` relinquishes focus in Chromium, dropping a
        // keyboard user to <body>; queue a restore to the Share button for
        // once it re-enables. HONEST FLAG: jsdom never blurs a disabled
        // control, so this branch is unexercisable under Vitest — it is on
        // the run log's needs-verification list, not claimed as proven.
        const dialog = dialogRef.current;
        if (dialog && !dialog.contains(document.activeElement)) {
          restoreShareFocusRef.current = true;
        }
      }
    } finally {
      setPending(false);
    }
  }, [share]);

  // Consume the focus-restore flag AFTER the commit that clears `disabled` —
  // focusing a still-disabled button is a silent no-op, so the handler above
  // cannot do this itself. The flag is only ever set inside the generation
  // guard, so a dismissed panel never steals focus back.
  useEffect(() => {
    if (pending || !restoreShareFocusRef.current) return;
    restoreShareFocusRef.current = false;
    shareRef.current?.focus();
  }, [pending]);

  // Move focus to the primary CTA on open; contain Tab and Escape while up.
  // NOTE this trap contains Tab/Escape ONLY — movement input listens on window
  // unconditionally (src/movement/input.ts), so it is not what keeps WASD from
  // the sim. The Tab cycle is a full index-managed model over a LIVE query of
  // the dialog's enabled buttons: on every Tab/Shift+Tab we preventDefault and
  // move focus programmatically (jsdom has no native tab navigation, so middle
  // transitions are otherwise untestable), and `:not(:disabled)` auto-skips any
  // button disabled at that instant. Accepted cosmetic asymmetry: in engines
  // where a disabled button keeps focus, it falls out of the query, so Tab from
  // it recovers to the FIRST button (Shift+Tab to the last) rather than its
  // neighbour — a sub-second window, not pinned by tests.
  useEffect(() => {
    if (!shown) return;
    replayRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const buttons = Array.from(
        dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
      );
      if (buttons.length === 0) return;
      e.preventDefault();
      const n = buttons.length;
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      // Recovery preserved: focus outside the set re-enters at the first
      // button on Tab, the last on Shift+Tab.
      const next =
        i === -1
          ? e.shiftKey
            ? n - 1
            : 0
          : (i + (e.shiftKey ? -1 : 1) + n) % n;
      buttons[next].focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, dismiss]);

  if (!shown) return null;

  // The panel is raised only once every landmark is discovered, so every row is
  // a discovered row. Each is marked with a checkmark glyph (decorative, hidden
  // from assistive tech) PAIRED WITH a textual "Discovered" status — never a
  // glyph or colour alone (WCAG 1.4.1).
  return (
    <div
      className="completion-panel-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        ref={dialogRef}
        className="completion-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="completion-title"
      >
        <h2 id="completion-title" className="completion-panel__title">
          You found everything
        </h2>
        <ol className="completion-panel__list">
          {pois.map((p) => (
            <li key={p.order} className="completion-panel__item">
              <span className="completion-panel__check" aria-hidden="true">
                {"\u2713"}
              </span>
              <span className="completion-panel__item-title">{p.title}</span>
              <span className="completion-panel__item-status">Discovered</span>
            </li>
          ))}
        </ol>
        <button
          ref={replayRef}
          type="button"
          className="cta"
          onClick={handleReplay}
        >
          Replay
        </button>
        {/* Middle placement is CONSTRAINED, not chosen: the protected a11y
            cases pin Replay as genuine-first and Keep exploring as
            genuine-last, and a side-effectful action must never receive
            default dialog focus. Native `disabled` (not aria-disabled) while
            pending: it blocks the click event outright — double-activation
            protection — and the trap's live :not(:disabled) query skips it. */}
        <button
          ref={shareRef}
          type="button"
          className="cta"
          onClick={handleShare}
          disabled={pending}
        >
          Share
        </button>
        <button type="button" className="cta" onClick={dismiss}>
          Keep exploring
        </button>
        {announcement !== null && (
          // Visible mirror of the announcement, aria-hidden so AT hears the
          // message exactly once — via the live region below. Renders only
          // for the non-null outcomes ("copied"/"failed").
          <p className="completion-panel__share-status" aria-hidden="true">
            {announcement}
          </p>
        )}
        {/* Polite live region — DiscoveryAnnouncer's pattern verbatim.
            PERSISTENT and mounted EMPTY from panel open, INSIDE the
            aria-modal dialog: AT may silently drop a sibling region under
            aria-modal, and a region injected together with its first message
            is unreliably announced. Setting its text never moves focus.
            Known AT coalescing of repeated identical strings is accepted
            parity with DiscoveryAnnouncer. */}
        <div
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </div>
      </div>
    </div>
  );
}
