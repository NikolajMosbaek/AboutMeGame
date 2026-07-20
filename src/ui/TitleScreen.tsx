import { useRef, useEffect } from "react";
import { APP_VERSION, VISION } from "../version.ts";
import { createPersistence } from "../discovery/persistence.ts";
import { createWinPersistence, type WinRecord } from "../quest/winRecord.ts";
import { POI_ANCHORS } from "../world/worldConfig.ts";
import { readControlChannel, type ControlChannel } from "./controlScheme.ts";
import { formatPlayTime } from "./TreasurePanel.tsx";

export interface TitleProgress {
  /** How many pages have been found in a previous session. */
  discovered: number;
  /** The total number of pages (the clue chain + the dig site). */
  total: number;
}

export interface TitleScreenProps {
  /** Enter the world. Wired by `App` to dispatch `{ type: "start" }`. */
  onStart: () => void;
  /** Open the static "can't play" notice (#50). Wired by `App` to dispatch
   *  `{ type: "openTextView" }`. Optional so existing callers/tests need not
   *  pass it; the link is hidden when absent. */
  onReadText?: () => void;
  /** Saved progress, so the CTA reads "Continue" when some exists. Injected so
   *  tests don't touch real storage; defaults to reading the discovery store. */
  progress?: TitleProgress;
  /** Input channel driving the controls hint, so a coarse-pointer visitor sees
   *  touch copy. Injected so tests/previews can force a channel; defaults to the
   *  resolved platform signal (keyboard whenever the pointer is fine or absent). */
  channel?: ControlChannel;
  /** The persisted completion, so a returning winner is recognised (and told
   *  apart from someone who only read every page). Injected so tests don't touch
   *  real storage; defaults to reading the win record. null = never won. */
  win?: WinRecord | null;
}

// Title-local presentational copy for the one controls hint — first-person
// explorer controls (pivot slice B), not the old drive/fly rig. Keyboard is
// held here verbatim (U+00B7 middot); touch names the on-screen joystick/USE
// buttons built by createTouchControls (src/player/input.ts). Held here as the
// screen's own prose — not a re-derivation of controlScheme's resolver entries.
const KEYBOARD_HINT = "WASD to walk · Shift to sprint · E to use";
const TOUCH_HINT = "Joystick to walk · drag to look · tap USE to use";

/** Read persisted progress without spinning up the engine — the title screen
 *  needs only the count and the page total (the clue chain + the dig site,
 *  `POI_ANCHORS.length`) to decide Continue vs Begin the expedition. */
function readProgress(): TitleProgress {
  // Count only ids that exist in the current site set — a save from an older
  // content set must not read as progress (same rule as DiscoverySystem).
  const known = new Set(POI_ANCHORS.map((a) => a.poiId));
  const discovered = [...createPersistence().load()].filter((id) => known.has(id)).length;
  return { discovered, total: POI_ANCHORS.length };
}

/** Read the persisted win without spinning up the engine — same
 *  storage-only pattern as `readProgress`. */
function readWin(): WinRecord | null {
  return createWinPersistence().load();
}

/**
 * The landing screen (#40): the wordmark, the one-line pitch, a short controls
 * hint, and a single CTA. With saved progress it shows "N of total pages found"
 * and the CTA reads "Continue"; otherwise "Begin the expedition". A secondary
 * link opens the static "can't play" notice (#50) for anyone who can't or
 * won't play. Kept presentational — it owns no game state, only the
 * focus-on-mount affordance.
 */
export function TitleScreen({
  onStart,
  onReadText,
  progress = readProgress(),
  channel = readControlChannel(),
  win = readWin(),
}: TitleScreenProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasWon = win !== null;
  const hasProgress = progress.discovered > 0;

  // Move focus to the heading on mount so screen-reader users land at the top
  // of the new screen and keyboard focus has a defined home.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main className="title-screen">
      <h1 ref={headingRef} tabIndex={-1} className="wordmark">
        THE LOST IDOL
      </h1>
      <p className="tagline">{VISION}</p>

      {hasWon ? (
        <p className="title-progress title-progress--won" role="status">
          You found the Lost Idol in {formatPlayTime(win.playSeconds)}
        </p>
      ) : (
        hasProgress && (
          <p className="title-progress" role="status">
            {progress.discovered} of {progress.total} pages found
          </p>
        )
      )}

      <button type="button" className="cta" onClick={onStart}>
        {hasWon ? "Return to the island" : hasProgress ? "Continue" : "Begin the expedition"}
      </button>

      {onReadText && (
        <button type="button" className="title-textlink" onClick={onReadText}>
          Can't play? About this game
        </button>
      )}

      <p className="title-controls">{channel === "touch" ? TOUCH_HINT : KEYBOARD_HINT}</p>

      <p className="version-marker">v{APP_VERSION}</p>
    </main>
  );
}
