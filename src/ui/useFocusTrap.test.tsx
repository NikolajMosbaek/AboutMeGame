import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useFocusTrap } from "./useFocusTrap.ts";

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  return (
    <div>
      <button>outside</button>
      <div ref={ref} role="dialog">
        <button>first</button>
        <button>middle</button>
        <button>last</button>
      </div>
    </div>
  );
}

afterEach(cleanup);

describe("useFocusTrap", () => {
  it("wraps Tab from the last focusable back to the first", () => {
    render(<Harness />);
    const first = screen.getByRole("button", { name: "first" });
    const last = screen.getByRole("button", { name: "last" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
  });

  it("wraps Shift+Tab from the first focusable back to the last", () => {
    render(<Harness />);
    const first = screen.getByRole("button", { name: "first" });
    const last = screen.getByRole("button", { name: "last" });
    first.focus();
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("pulls focus back into the dialog if it has escaped to the background", () => {
    render(<Harness />);
    const first = screen.getByRole("button", { name: "first" });
    const outside = screen.getByRole("button", { name: "outside" });
    outside.focus();
    fireEvent.keyDown(outside, { key: "Tab" });
    expect(document.activeElement).toBe(first); // never the background button
  });

  it("leaves a Tab in the middle of the dialog to the browser's natural order", () => {
    render(<Harness />);
    const middle = screen.getByRole("button", { name: "middle" });
    middle.focus();
    const e = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    middle.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false); // not at a boundary → not intercepted
  });
});
