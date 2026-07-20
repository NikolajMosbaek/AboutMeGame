import { useEffect, useRef, useState } from "react";
import {
  createOnboardingPersistence,
  type OnboardingPersistence,
} from "./onboardingPersistence.ts";
import {
  readControlChannel,
  resolveControlScheme,
  type ControlChannel,
} from "./controlScheme.ts";
import { useFocusTrap } from "./useFocusTrap.ts";

export interface OnboardingProps {
  /** Persistence seam — injected so tests/previews substitute their own. */
  persistence?: OnboardingPersistence;
  /** Notified when the overlay opens/closes, so the shell can suppress other
   *  Escape handling (e.g. opening the menu) while onboarding is up. */
  onOpenChange?: (open: boolean) => void;
  /** Input channel that picks which control hints to teach. Injected so
   *  tests/previews can force a channel; defaults to the resolved platform
   *  signal (`readControlChannel`) once at mount. */
  channel?: ControlChannel;
}

/**
 * First-run onboarding (#43): a one-time overlay listing the controls, dismissed
 * with "Got it, let's go". It does NOT pause the sim — the world keeps running
 * behind it, and dismiss simply removes the overlay (and persists a seen flag so
 * it never returns). Degrades gracefully if storage is blocked (it may re-show,
 * which is harmless). Respects reduced motion via the tokens.css animation rule.
 */
export function Onboarding({ persistence, onOpenChange, channel }: OnboardingProps) {
  // Resolve persistence once (default reads real localStorage). Memoised in a
  // ref so a re-render never rebuilds it or re-reads the flag.
  const persistRef = useRef<OnboardingPersistence>(persistence ?? createOnboardingPersistence());
  // Resolve the channel once at mount, mirroring persistRef: the default reads
  // the platform signal (`window.matchMedia`) exactly once via the ref
  // initializer, so a re-render never swaps the list out under a reading user.
  const channelRef = useRef<ControlChannel>(channel ?? readControlChannel());
  // Frozen module-level lookup — an O(1) constant, so no useMemo ceremony.
  const scheme = resolveControlScheme(channelRef.current);
  const [open, setOpen] = useState(() => !persistRef.current.seen());
  const dismissRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  // Move focus onto the dismiss button so keyboard/AT users land in the dialog.
  useEffect(() => {
    if (open) dismissRef.current?.focus();
  }, [open]);

  // Let the shell know whether the overlay is up (to gate its Escape handler).
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  if (!open) return null;

  const dismiss = () => {
    persistRef.current.markSeen();
    setOpen(false);
  };

  return (
    <div className="onboarding-backdrop">
      <div ref={dialogRef} className="onboarding" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <h2 id="onboarding-title" className="onboarding__title">
          Read the pages, survive the jungle
        </h2>
        <p className="onboarding__lede">
          A torn page waits at your camp, and five more lead to the Emerald Idol — six in
          all. Follow them, drink at the river and forage fruit to stay alive, and keep clear
          of snakes. If a growl comes close, put water or open ground between you and the
          jaguar. In the lagoon you can swim where you look; the river's current is not your
          friend. Dig once you've found them all. Here are the controls:
        </p>
        <dl className="onboarding__controls">
          {scheme.entries.map((entry) => (
            <div key={entry.label} className="onboarding__row">
              <dt>
                {channelRef.current === "touch" ? (
                  <span>{entry.label}</span>
                ) : (
                  <kbd>{entry.label}</kbd>
                )}
              </dt>
              <dd>{entry.action}</dd>
            </div>
          ))}
        </dl>
        <button ref={dismissRef} type="button" className="cta" onClick={dismiss}>
          Got it, let's go
        </button>
      </div>
    </div>
  );
}
