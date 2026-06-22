import { describe, expect, it } from "vitest";
import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { CompletionPanel } from "./CompletionPanel.tsx";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";

// T6 — accessibility + input-leak guard. The panel is an unpaused modal, so a
// focus trap (not pause) is what stops keyboard input leaking to the vehicle
// controls while it's up. Focus enters on the primary CTA, Tab/Shift+Tab cycle
// within the two CTAs, Escape and backdrop click dismiss to free-roam, and on
// dismiss focus returns to the canvas container (the panel has no opener).

const THIRTEEN = Array.from({ length: 13 }, (_, i) => ({
  order: i + 1,
  title: `Landmark ${i + 1}`,
}));

function driveToShown(store: ReturnType<typeof createDiscoveryStore>) {
  act(() => {
    store.openPoi({ id: "p13", order: 13, title: "Landmark 13", body: "…" });
    store.setDiscovered(THIRTEEN.map((_, i) => `p${i + 1}`));
  });
  act(() => store.closePoi());
}

/** A focusable stand-in for GameCanvas's `.game-canvas-container` div. */
function mountWithContainer(onOpenChange?: (open: boolean) => void) {
  const store = createDiscoveryStore(13);
  const containerRef = createRef<HTMLDivElement>();
  render(
    <div ref={containerRef} tabIndex={-1} data-testid="canvas-container">
      <CompletionPanel
        store={store}
        pois={THIRTEEN}
        onReplay={() => {}}
        containerRef={containerRef}
        onOpenChange={onOpenChange}
      />
    </div>,
  );
  driveToShown(store);
  return { store, containerRef };
}

describe("CompletionPanel accessibility (T6)", () => {
  it("exposes the dialog with role, aria-modal and aria-labelledby its header", () => {
    mountWithContainer();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const labelledby = dialog.getAttribute("aria-labelledby");
    expect(labelledby).toBeTruthy();
    const header = document.getElementById(labelledby!);
    expect(header).not.toBeNull();
    expect(header!.tagName).toBe("H2");
  });

  it("focuses the primary CTA (Replay) on open", () => {
    mountWithContainer();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /replay/i }),
    );
  });

  it("traps Tab from the last CTA back to the first (no leak past the panel)", () => {
    mountWithContainer();
    const replay = screen.getByRole("button", { name: /replay/i });
    const keep = screen.getByRole("button", { name: /keep exploring/i });

    // Focus starts on Replay; Tab from the last control wraps to the first.
    keep.focus();
    fireEvent.keyDown(keep, { key: "Tab" });
    expect(document.activeElement).toBe(replay);
  });

  it("traps Shift+Tab from the first CTA back to the last (no leak past the panel)", () => {
    mountWithContainer();
    const replay = screen.getByRole("button", { name: /replay/i });
    const keep = screen.getByRole("button", { name: /keep exploring/i });

    replay.focus();
    fireEvent.keyDown(replay, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(keep);
  });

  it("dismisses to free-roam on Escape and returns focus to the canvas container", () => {
    const opens: boolean[] = [];
    const { containerRef } = mountWithContainer((open) => opens.push(open));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(containerRef.current);
    // The shell is told the panel raised then lowered (so its Escape guard
    // bails while up, then stops bailing). A mount-time `false` may precede it.
    expect(opens.slice(-2)).toEqual([true, false]);
  });

  it("dismisses to free-roam on backdrop click and returns focus to the canvas container", () => {
    const opens: boolean[] = [];
    const { containerRef } = mountWithContainer((open) => opens.push(open));
    const dialog = screen.getByRole("dialog");
    const backdrop = dialog.parentElement!;
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(containerRef.current);
    expect(opens.slice(-2)).toEqual([true, false]);
  });

  it("returns focus to the canvas container when 'Keep exploring' is clicked", () => {
    const { containerRef } = mountWithContainer();
    act(() => {
      screen.getByRole("button", { name: /keep exploring/i }).click();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(containerRef.current);
  });

  it("returns focus to the canvas container when 'Replay' is clicked", () => {
    const { containerRef } = mountWithContainer();
    act(() => {
      screen.getByRole("button", { name: /replay/i }).click();
    });
    expect(document.activeElement).toBe(containerRef.current);
  });
});
