import { useCallback, useEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import { useFocusTrap } from "./useFocusTrap.ts";
import type { QuestStore } from "../quest/questStore.ts";
import { useShare, type ShareCapabilities } from "./useShare.ts";
import { realShareCapabilities, realShareUrl } from "./shareCapabilities.ts";
import { shareAnnouncementFor } from "./shareAnnouncement.ts";

export interface TreasurePanelProps {
  quest: QuestStore;
  /** Lift the "treasure" pause and return to free roaming. */
  onKeepExploring: () => void;
  /** Start the expedition over (wipe progress, wake at camp fresh). */
  onReplay: () => void;
  /** Injected for tests; defaults to the real capability probe. */
  shareCapabilities?: ShareCapabilities;
  /** The link shared/copied; defaults to the canonical deploy URL. */
  shareUrl?: string;
}

/** mm:ss for the stats row. */
export function formatPlayTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * The win screen (pivot slice G — replaces the discovery-count CompletionPanel).
 * Opens on the treasureFound rising edge, never on a reload of a finished
 * session (the initial snapshot is the baseline, same contract the old panel
 * had). Shows the expedition stats the quest store froze at the dig, and three
 * CTAs in DOM = visual = tab order: Replay, Share, Keep exploring. Share goes
 * through the same never-rejecting useShare seam; its outcome is announced in
 * the one polite live region.
 */
export function TreasurePanel({
  quest,
  onKeepExploring,
  onReplay,
  shareCapabilities = realShareCapabilities,
  shareUrl = realShareUrl,
}: TreasurePanelProps) {
  const q = useSyncExternalStore(quest.subscribe, quest.getSnapshot);
  const [dismissed, setDismissed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const firstRef = useRef<HTMLButtonElement>(null);
  const baselineRef = useRef<boolean | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);
  const { share } = useShare(shareCapabilities, shareUrl);

  // Reload guard: if the very first snapshot already says treasureFound, that
  // is restored state, not a win moment — never pop the panel for it.
  if (baselineRef.current === null) baselineRef.current = q.treasureFound;

  const open = q.treasureFound && !baselineRef.current && !dismissed;

  useEffect(() => {
    if (open) firstRef.current?.focus();
  }, [open]);

  const keepExploring = useCallback(() => {
    setDismissed(true);
    onKeepExploring();
  }, [onKeepExploring]);

  // Escape = keep exploring (the least destructive dismissal).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        keepExploring();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, keepExploring]);

  if (!open) return null;

  const handleShare = async () => {
    const outcome = await share();
    setAnnouncement(shareAnnouncementFor(outcome) ?? "");
  };

  return (
    <div ref={dialogRef} className="treasure-panel" role="dialog" aria-modal="true" aria-labelledby="treasure-title">
      <div className="treasure-panel__card">
        <p className="treasure-panel__eyebrow">Between the roots, exactly where the eyes led —</p>
        <h2 id="treasure-title">The Emerald Idol is yours.</h2>
        <p className="treasure-panel__flavor">
          M. and the others never made it home. You did — and you brought the
          truth up with it.
        </p>
        <dl className="treasure-panel__stats">
          <div>
            <dt>Expedition time</dt>
            <dd>{formatPlayTime(q.playSeconds)}</dd>
          </div>
          <div>
            <dt>Pages found</dt>
            <dd>
              {q.cluesFound} / {q.cluesTotal}
            </dd>
          </div>
          <div>
            <dt>Times the jungle won</dt>
            <dd>{q.deaths}</dd>
          </div>
          <div>
            <dt>Fruit eaten</dt>
            <dd>{q.fruitEaten}</dd>
          </div>
        </dl>
        <div className="treasure-panel__ctas">
          <button ref={firstRef} type="button" className="cta" onClick={onReplay}>
            Replay
          </button>
          {/* Secondary weight: Share produces the least-valuable outcome (a bare
              link), so it shouldn't compete with Replay as a primary CTA. */}
          <button type="button" className="cta cta--quiet" onClick={handleShare}>
            Share
          </button>
          <button type="button" className="cta cta--quiet" onClick={keepExploring}>
            Keep exploring
          </button>
        </div>
        <p role="status" aria-live="polite" className="treasure-panel__announce">
          {announcement}
        </p>
      </div>
    </div>
  );
}
