import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Onboarding } from "./Onboarding.tsx";
import type { OnboardingPersistence } from "./onboardingPersistence.ts";

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
});
