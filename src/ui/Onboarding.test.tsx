import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Onboarding } from "./Onboarding.tsx";
import type { OnboardingPersistence } from "./onboardingPersistence.ts";
import type { ControlChannel } from "./controlScheme.ts";

/** A persistence stub backed by a plain flag, so the test owns the seen state. */
function fakePersistence(initial = false): OnboardingPersistence & { seenFlag: boolean } {
  const p = {
    seenFlag: initial,
    seen() {
      return p.seenFlag;
    },
    markSeen() {
      p.seenFlag = true;
    },
  };
  return p;
}

describe("Onboarding", () => {
  it("shows the controls overlay on first run", () => {
    render(<Onboarding persistence={fakePersistence(false)} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/W A S D/)).toBeInTheDocument();
  });

  it("does not show when already seen", () => {
    render(<Onboarding persistence={fakePersistence(true)} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("dismisses and persists the seen flag", () => {
    const p = fakePersistence(false);
    render(<Onboarding persistence={p} />);
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(p.seenFlag).toBe(true);
  });

  it("defaults to the keyboard list with no channel prop in jsdom", () => {
    // No channel prop: the default reads the platform signal once. jsdom has no
    // `window.matchMedia`, so `readControlChannel` falls back to "keyboard" — the
    // safe default — and the dialog must still teach the keyboard hints (W A S D).
    render(<Onboarding persistence={fakePersistence(false)} />);
    expect(screen.getByText(/W A S D/)).toBeInTheDocument();
  });

  it("lists the touch on-screen controls under the touch channel", () => {
    render(<Onboarding channel="touch" persistence={fakePersistence(false)} />);

    // The four on-screen widgets a touch visitor actually has, each paired with
    // its action in the adjacent <dd> (mirrors resolveControlScheme("touch")).
    const expected: ReadonlyArray<[string, string]> = [
      ["Joystick", "Drive / steer"],
      ["▲", "Climb (in flight)"],
      ["FLY", "Toggle flight"],
      ["USE", "Reveal a landmark"],
    ];
    for (const [label, action] of expected) {
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByText(action)).toBeInTheDocument();
    }

    // No keyboard hints leak into the touch scheme.
    expect(screen.queryByText(/W A S D/)).toBeNull();
  });

  it("renders keyboard labels as <kbd> and touch labels as plain <span> in the same <dt>", () => {
    const { container: kbdContainer } = render(
      <Onboarding channel="keyboard" persistence={fakePersistence(false)} />,
    );
    // Under the keyboard channel the 'W A S D' label is a key-cap <kbd> in a <dt>.
    const kbd = kbdContainer.querySelector("dt kbd");
    expect(kbd).not.toBeNull();
    expect(kbd?.textContent).toBe("W A S D");

    const { container: touchContainer } = render(
      <Onboarding channel="touch" persistence={fakePersistence(false)} />,
    );
    // Under the touch channel no label is a <kbd>: 'FLY' is a button name, not a
    // key, so it renders as a plain leaf inside its <dt> with no key-cap chrome.
    expect(touchContainer.querySelector("dt kbd")).toBeNull();
    const fly = screen.getByText("FLY");
    expect(fly.closest("dt")).not.toBeNull();
  });

  // The channel seam must not regress the dialog's focus/dismiss behaviour under
  // either scheme. Dismiss in particular is the gesture that unlocks the
  // suspended AudioContext on mobile Safari, so it must stay a real <button> with
  // an unchanged onClick that runs the persistence markSeen and closes the dialog.
  const channels: ReadonlyArray<[ControlChannel]> = [["keyboard"], ["touch"]];

  it.each(channels)("focuses the dismiss button on open (%s channel)", (channel) => {
    render(<Onboarding channel={channel} persistence={fakePersistence(false)} />);
    const dismiss = screen.getByRole("button", { name: /got it/i });
    // It is a real, focusable <button> element (not a div/role hack), and focus
    // lands on it when the overlay opens so keyboard/AT users start inside it.
    expect(dismiss.tagName).toBe("BUTTON");
    expect(dismiss).toHaveFocus();
  });

  it.each(channels)(
    "dismiss persists seenFlag and removes the dialog (%s channel)",
    (channel) => {
      const p = fakePersistence(false);
      render(<Onboarding channel={channel} persistence={p} />);
      const dismiss = screen.getByRole("button", { name: /got it/i });
      // Clicking the unchanged onClick handler marks the flag and tears the
      // dialog down — the AudioContext-unlock gesture is preserved verbatim.
      fireEvent.click(dismiss);
      expect(p.seenFlag).toBe(true);
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );
});
