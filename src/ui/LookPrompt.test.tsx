import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { LookPrompt } from "./LookPrompt.tsx";
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

describe("LookPrompt", () => {
  it("shows 'click to look' while playing with no pointer lock (desktop)", () => {
    render(<LookPrompt session={createSession()} touchActive={false} />);
    expect(screen.getByText(/click to look/i)).toBeInTheDocument();
  });

  it("hides once the pointer is locked", () => {
    render(<LookPrompt session={createSession()} touchActive={false} />);
    expect(screen.getByText(/click to look/i)).toBeInTheDocument();
    act(() => setLock(document.body));
    expect(screen.queryByText(/click to look/i)).toBeNull();
  });

  it("hides while a modal holds the sim paused", () => {
    const session = createSession();
    session.setPaused("menu", true);
    render(<LookPrompt session={session} touchActive={false} />);
    expect(screen.queryByText(/click to look/i)).toBeNull();
  });

  it("never shows on touch (there is no pointer lock there)", () => {
    render(<LookPrompt session={createSession()} touchActive={true} />);
    expect(screen.queryByText(/click to look/i)).toBeNull();
  });
});
