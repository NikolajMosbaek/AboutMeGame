import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { Crosshair } from "./Crosshair.tsx";
import { createSession } from "../gameSession.ts";

function setLock(el: Element | null) {
  Object.defineProperty(document, "pointerLockElement", {
    value: el,
    configurable: true,
    writable: true,
  });
  document.dispatchEvent(new Event("pointerlockchange"));
}

afterEach(() => {
  cleanup();
  setLock(null); // reset lock state between tests
});

describe("Crosshair", () => {
  it("shows the reticle while look is live (pointer locked, desktop, playing)", () => {
    setLock(document.body);
    const { container } = render(<Crosshair session={createSession()} touchActive={false} />);
    const dot = container.querySelector(".crosshair");
    expect(dot).not.toBeNull();
    // Decorative only — hidden from assistive tech.
    expect(dot).toHaveAttribute("aria-hidden", "true");
  });

  it("hides when the pointer is not locked (complements LookPrompt's 'click to look')", () => {
    const { container } = render(<Crosshair session={createSession()} touchActive={false} />);
    expect(container.querySelector(".crosshair")).toBeNull();
    act(() => setLock(document.body));
    expect(container.querySelector(".crosshair")).not.toBeNull();
    act(() => setLock(null));
    expect(container.querySelector(".crosshair")).toBeNull();
  });

  it("hides while a modal holds the sim paused, even if locked", () => {
    setLock(document.body);
    const session = createSession();
    session.setPaused("menu", true);
    const { container } = render(<Crosshair session={session} touchActive={false} />);
    expect(container.querySelector(".crosshair")).toBeNull();
  });

  it("never shows on touch (aim is drag-based there, no locked centre)", () => {
    setLock(document.body);
    const { container } = render(<Crosshair session={createSession()} touchActive={true} />);
    expect(container.querySelector(".crosshair")).toBeNull();
  });
});
