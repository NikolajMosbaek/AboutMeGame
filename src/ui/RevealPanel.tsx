import { useEffect, useRef, useState } from "react";
import { useSyncExternalStore } from "react";
import type { DiscoveryStore, OpenInfo } from "../discovery/discoveryStore.ts";
import { nextUndiscovered } from "../discovery/nextUndiscovered.ts";
import type { PoiInteraction } from "../content/contentModel.ts";

export interface RevealPanelProps {
  store: DiscoveryStore;
  /** Optional (quest slice): while the dig owns the interact key at the fig,
   *  the approach card would advertise "press E to reveal" — a lie. It hides;
   *  the ActionHint's dig prompt is the one truth for the key. */
  quest?: {
    getSnapshot(): { digOwnsKey: boolean };
    subscribe(listener: () => void): () => void;
  };
  /**
   * The full ordered POI projection (id/order/title), injected at the
   * GameCanvas seam from `game.discovery.pois`. It is the candidate set for the
   * "Next landmark" selector (wired in a later slice). RevealPanel imports no
   * content/navStore — this minimal, immutable shape is the only data wire.
   */
  pois: readonly { id: string; order: number; title: string }[];
}

/**
 * The discovery UI (issue #38): two states driven by the discovery store.
 *  • A teaser prompt near a landmark (with an interact hint when in range).
 *  • The full reveal panel (a modal dialog) when a landmark is opened.
 *
 * The panel is pure presentation. The dialog chrome — backdrop, role=dialog,
 * eyebrow, title, close button, Escape, backdrop-click, focus-on-open — is
 * identical across every interaction type and lives here; only the middle body
 * region varies, rendered by `RevealBody` switching on the open interaction's
 * discriminant. Body-unlock is *read* from `snap.open.bodyUnlocked` (the store
 * derives it in `set`); the panel never re-derives it. Selecting a guess option
 * calls `store.answerGuess(index)` with the option's array position — the UI
 * makes no correctness judgement (the `correct` flag is inert this slice).
 */
export function RevealPanel({ store, pois, quest }: RevealPanelProps) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const digOwnsKey = useSyncExternalStore(
    quest?.subscribe ?? (() => () => {}),
    () => quest?.getSnapshot().digOwnsKey ?? false,
  );
  const closeRef = useRef<HTMLButtonElement>(null);
  const firstOptionRef = useRef<HTMLButtonElement>(null);

  const open = snap.open;
  const interactionType = open?.interaction.type;
  const openId = open?.id ?? null;

  // Move focus into the dialog when it opens, and close on Escape. Gated on the
  // open *id* — answerGuess produces a new `open` object, and depending on the
  // whole `open` reference would yank focus back mid-interaction. For a guess,
  // focus lands on the first option (the actionable element); for plain and
  // highlight, on the close button, exactly as before.
  useEffect(() => {
    if (!openId) return;
    if (interactionType === "guess") firstOptionRef.current?.focus();
    else closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") store.closePoi();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, store]);

  return (
    <>
      {!open && snap.nearby && !digOwnsKey && (
        <div className="reveal-prompt" role="status">
          <span className="reveal-prompt__title">{snap.nearby.title}</span>
          <span className="reveal-prompt__teaser">{snap.nearby.teaser}</span>
          {snap.nearby.inRange && (
            <span className="reveal-prompt__hint">Press E · or USE to reveal</span>
          )}
        </div>
      )}

      {open && (
        <div
          className="reveal-panel-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) store.closePoi();
          }}
        >
          <div
            className="reveal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reveal-title"
          >
            <p className="reveal-panel__eyebrow">
              Landmark {open.order} of {snap.total}
            </p>
            <h2 id="reveal-title" className="reveal-panel__title">
              {open.title}
            </h2>

            <RevealBody open={open} store={store} firstOptionRef={firstOptionRef} />

            <RevealActions
              open={open}
              store={store}
              pois={pois}
              discoveredIds={snap.discoveredIds}
              closeRef={closeRef}
            />
          </div>
        </div>
      )}
    </>
  );
}

interface RevealActionsProps {
  open: OpenInfo;
  store: DiscoveryStore;
  pois: readonly { id: string; order: number; title: string }[];
  discoveredIds: readonly string[];
  closeRef: React.RefObject<HTMLButtonElement>;
}

/**
 * The dialog footer (M2 slice 4). "Drive on" is the always-present unnamed
 * dismiss; it stays first in DOM/tab order so the focus-on-open contract
 * (plain/highlight → close button) is untouched. "Next: <title> →" is a named
 * forward move toward a concrete landmark, placed AFTER "Drive on".
 *
 * Visibility collapses to one rule: render Next ONLY when the body is unlocked
 * AND the cyclic-successor selector names a target. So an unanswered guess
 * (body locked) hides Next — forward-nav cannot bypass the unread payload — and
 * the last undiscovered landmark hides it too (the selector returns null). The
 * current open id is passed explicitly so it is excluded independently of
 * `discoveredIds` (the open POI is already discovered while the panel is open).
 *
 * On activate Next calls only `store.closePoi()` — it never mutates the
 * discovered set, reveals a body, teleports, or touches NavSystem/navStore: the
 * POI's existing nav marker is simply live again once the player is back in the
 * world.
 */
function RevealActions({ open, store, pois, discoveredIds, closeRef }: RevealActionsProps) {
  const next = open.bodyUnlocked
    ? nextUndiscovered(pois, discoveredIds, open.id, open.order)
    : null;

  return (
    <div className="reveal-panel__actions">
      <button
        ref={closeRef}
        type="button"
        className="cta reveal-panel__close"
        onClick={() => store.closePoi()}
      >
        Drive on
      </button>
      {next && (
        <button
          type="button"
          className="cta reveal-panel__next"
          onClick={() => store.closePoi()}
        >
          Next: {next.title} →
        </button>
      )}
    </div>
  );
}

interface RevealBodyProps {
  open: OpenInfo;
  store: DiscoveryStore;
  firstOptionRef: React.RefObject<HTMLButtonElement>;
}

/**
 * The middle region of the dialog, the only part that varies by interaction
 * type. Pure render-by-discriminant with a `never` exhaustiveness default
 * mirroring `parseInteraction`; the surrounding chrome (close/Escape/backdrop/
 * focus) stays in `RevealPanel`.
 */
function RevealBody({ open, store, firstOptionRef }: RevealBodyProps) {
  const interaction = open.interaction;
  switch (interaction.type) {
    case "plain":
      return <p className="reveal-panel__body">{open.body}</p>;

    case "highlight":
      return (
        <>
          <p className="reveal-panel__emphasis">{interaction.emphasis}</p>
          <p className="reveal-panel__body">{open.body}</p>
        </>
      );

    case "guess":
      return (
        <GuessBody
          open={open}
          interaction={interaction}
          store={store}
          firstOptionRef={firstOptionRef}
        />
      );

    default: {
      // Exhaustiveness: a new variant added to PoiInteraction without an arm
      // here fails to typecheck.
      const _exhaustive: never = interaction;
      void _exhaustive;
      return null;
    }
  }
}

interface GuessBodyProps {
  open: OpenInfo;
  interaction: Extract<PoiInteraction, { type: "guess" }>;
  store: DiscoveryStore;
  firstOptionRef: React.RefObject<HTMLButtonElement>;
}

/**
 * Guess interaction: the prompt plus its options as native buttons. Before a
 * pick the body is *not rendered* (conditional, not CSS-hidden); selecting an
 * option commits its array index via `store.answerGuess`, the store derives
 * `bodyUnlocked`, and the body renders driven solely by that flag. A polite
 * sr-only region announces once on the false→true transition (DiscoveryAnnouncer
 * pattern, guarded by a previous-value ref so it never fires on mount or on a
 * re-click no-op). RevealPanel is a *sibling* of the Hud, so this local live
 * region does not trip the Hud-scoped single-live-region invariant.
 */
function GuessBody({ open, interaction, store, firstOptionRef }: GuessBodyProps) {
  const [announcement, setAnnouncement] = useState("");
  const prevUnlockedRef = useRef(open.bodyUnlocked);

  useEffect(() => {
    if (open.bodyUnlocked && !prevUnlockedRef.current) {
      setAnnouncement("Answer revealed.");
    }
    prevUnlockedRef.current = open.bodyUnlocked;
  }, [open.bodyUnlocked]);

  return (
    <>
      <p id="reveal-guess-prompt" className="reveal-panel__prompt">
        {interaction.prompt}
      </p>
      <div
        className="reveal-panel__options"
        role="group"
        aria-labelledby="reveal-guess-prompt"
      >
        {interaction.options.map((option, i) => {
          const chosen = open.guessChoice === i;
          return (
            <button
              key={i}
              ref={i === 0 ? firstOptionRef : undefined}
              type="button"
              className={
                "reveal-panel__option" +
                (chosen ? " reveal-panel__option--chosen" : "")
              }
              aria-pressed={chosen}
              onClick={() => store.answerGuess(i)}
            >
              {option.text}
            </button>
          );
        })}
      </div>

      {open.bodyUnlocked && (
        <>
          {interaction.answerReveal && (
            <p className="reveal-panel__emphasis">{interaction.answerReveal}</p>
          )}
          <p className="reveal-panel__body">{open.body}</p>
        </>
      )}

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </>
  );
}
