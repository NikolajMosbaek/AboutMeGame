import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Hud } from "./Hud.tsx";
import { createHudStore } from "./hudStore.ts";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";

describe("Hud", () => {
  it("shows DRIVE mode and speed but hides altitude on the ground", () => {
    const hud = createHudStore();
    hud.set({ mode: "drive", speed: 42, altitude: 0 });
    render(<Hud hud={hud} discovery={createDiscoveryStore(13)} onOpenMenu={() => {}} onOpenJournal={() => {}} />);
    expect(screen.getByText("DRIVE")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.queryByText(/alt/i)).not.toBeInTheDocument();
  });

  it("shows FLY mode and altitude in flight", () => {
    const hud = createHudStore();
    hud.set({ mode: "fly", speed: 30, altitude: 88 });
    render(<Hud hud={hud} discovery={createDiscoveryStore(13)} onOpenMenu={() => {}} onOpenJournal={() => {}} />);
    expect(screen.getByText("FLY")).toBeInTheDocument();
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.getByText(/alt/i)).toBeInTheDocument();
  });

  it("renders the single discovery-progress badge from the discovery store", () => {
    const discovery = createDiscoveryStore(13);
    discovery.setDiscovered(["a", "b", "c"]);
    render(<Hud hud={createHudStore()} discovery={discovery} onOpenMenu={() => {}} onOpenJournal={() => {}} />);
    expect(screen.getByText("Discovered 3 / 13")).toBeInTheDocument();
  });

  it('shows remaining "N to go" mid-journey and updates on re-render', () => {
    const discovery = createDiscoveryStore(13);
    discovery.setDiscovered(["a", "b", "c"]);
    render(<Hud hud={createHudStore()} discovery={discovery} onOpenMenu={() => {}} onOpenJournal={() => {}} />);
    expect(screen.getByText("Discovered 3 / 13")).toBeInTheDocument();
    expect(screen.getByText("10 to go")).toBeInTheDocument();

    act(() => discovery.setDiscovered(["a", "b", "c", "d", "e"]));
    expect(screen.getByText("8 to go")).toBeInTheDocument();
    expect(screen.queryByText("10 to go")).not.toBeInTheDocument();
  });

  it("shows the singular boundary as '1 to go' (not '1 to gos')", () => {
    const discovery = createDiscoveryStore(13);
    discovery.setDiscovered(Array.from({ length: 12 }, (_, i) => `p${i}`));
    render(<Hud hud={createHudStore()} discovery={discovery} onOpenMenu={() => {}} onOpenJournal={() => {}} />);
    expect(screen.getByText("1 to go")).toBeInTheDocument();
    expect(screen.queryByText("1 to gos")).not.toBeInTheDocument();
  });

  it("renders '13 to go' for an empty/uninitialized store and not the completed state", () => {
    const discovery = createDiscoveryStore(13);
    render(<Hud hud={createHudStore()} discovery={discovery} onOpenMenu={() => {}} onOpenJournal={() => {}} />);
    expect(screen.getByText("13 to go")).toBeInTheDocument();
    expect(screen.queryByText("All discovered")).not.toBeInTheDocument();
  });

  it('shows "All discovered" at the completed boundary and never "0 to go"', () => {
    const discovery = createDiscoveryStore(13);
    discovery.setDiscovered(Array.from({ length: 13 }, (_, i) => `p${i}`));
    render(<Hud hud={createHudStore()} discovery={discovery} onOpenMenu={() => {}} onOpenJournal={() => {}} />);
    expect(screen.getByText("All discovered")).toBeInTheDocument();
    expect(screen.queryByText(/0 to go/)).not.toBeInTheDocument();
  });

  it("introduces no second live region; remaining meaning is in the single discovery-progress aria-label", () => {
    // Baseline: the HUD's only live region is the telemetry role=status.
    // The discovery-progress badge and the new discovery-remaining line must
    // NOT add a second aria-live / role=status node — DiscoveryAnnouncer stays
    // the sole polite announcer.
    const baseline = render(
      <Hud hud={createHudStore()} discovery={createDiscoveryStore(13)} onOpenMenu={() => {}} onOpenJournal={() => {}} />,
    );
    const baselineCount =
      baseline.container.querySelectorAll("[aria-live],[role=status]").length;
    baseline.unmount();

    const discovery = createDiscoveryStore(13);
    discovery.setDiscovered(["a", "b", "c"]);
    const { container } = render(
      <Hud hud={createHudStore()} discovery={discovery} onOpenMenu={() => {}} onOpenJournal={() => {}} />,
    );

    expect(container.querySelectorAll("[aria-live],[role=status]").length).toBe(
      baselineCount,
    );

    const remaining = container.querySelector(".discovery-remaining");
    expect(remaining).not.toBeNull();
    expect(remaining).toHaveAttribute("aria-hidden", "true");
    expect(remaining).not.toHaveAttribute("aria-live");
    expect(remaining).not.toHaveAttribute("role");

    const progress = container.querySelector(".discovery-progress");
    expect(progress).toHaveAttribute(
      "aria-label",
      "Discovered 3 of 13 landmarks, 10 to go",
    );
  });

  it("folds the completed meaning into the single discovery-progress aria-label", () => {
    const discovery = createDiscoveryStore(13);
    discovery.setDiscovered(Array.from({ length: 13 }, (_, i) => `p${i}`));
    const { container } = render(
      <Hud hud={createHudStore()} discovery={discovery} onOpenMenu={() => {}} onOpenJournal={() => {}} />,
    );
    expect(container.querySelector(".discovery-progress")).toHaveAttribute(
      "aria-label",
      "All 13 landmarks discovered",
    );
    expect(container.querySelector(".discovery-remaining")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("styles .discovery-remaining as a subordinate cue under the badge (smaller, right-aligned, in .hud-top-right)", () => {
    // T5 is pure CSS. Load the shipped HUD stylesheet into a real <style> so
    // jsdom's CSSOM applies it, then assert the remaining line is visually
    // subordinate to the progress badge and lives directly inside the cluster.
    const css = readFileSync(resolve(process.cwd(), "src/tokens.css"), "utf8");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    const discovery = createDiscoveryStore(13);
    discovery.setDiscovered(["a", "b", "c"]);
    const { container } = render(
      <Hud hud={createHudStore()} discovery={discovery} onOpenMenu={() => {}} onOpenJournal={() => {}} />,
    );

    const progress = container.querySelector<HTMLElement>(".discovery-progress")!;
    const remaining = container.querySelector<HTMLElement>(".discovery-remaining")!;

    // Sits directly under the badge, inside the top-right cluster.
    expect(remaining.parentElement).toBe(progress);
    expect(progress.closest(".hud-top-right")).not.toBeNull();

    // jsdom returns the declared rem value (not resolved px). The badge sets
    // its size via the `font:` shorthand, so read font-size from either the
    // longhand or the shorthand, then compare numerically.
    const rem = (el: HTMLElement) => {
      const cs = getComputedStyle(el);
      const raw = cs.fontSize || /(\d*\.?\d+)rem/.exec(cs.font)?.[1] + "rem";
      return parseFloat(raw);
    };
    expect(rem(remaining)).toBeGreaterThan(0);
    expect(rem(progress)).toBeGreaterThan(0);
    expect(rem(remaining)).toBeLessThan(rem(progress));

    // Right-aligned to the cluster (lower-emphasis cue tucked under the count).
    expect(getComputedStyle(remaining).textAlign).toBe("right");

    style.remove();
  });

  afterEach(() => {
    document.head.querySelectorAll("style").forEach((s) => s.remove());
  });

  it("opens the menu when the menu button is clicked", () => {
    const onOpenMenu = vi.fn();
    render(
      <Hud
        hud={createHudStore()}
        discovery={createDiscoveryStore(13)}
        onOpenMenu={onOpenMenu}
        onOpenJournal={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(onOpenMenu).toHaveBeenCalledOnce();
  });

  it("renders a journal button beside the menu button and calls onOpenJournal on click", () => {
    const onOpenJournal = vi.fn();
    const onOpenMenu = vi.fn();
    const { container } = render(
      <Hud
        hud={createHudStore()}
        discovery={createDiscoveryStore(13)}
        onOpenMenu={onOpenMenu}
        onOpenJournal={onOpenJournal}
      />,
    );

    const journalBtn = screen.getByRole("button", { name: "Open journal" });
    const menuBtn = screen.getByRole("button", { name: "Open menu" });

    // Both live in the same top-right cluster, journal beside the menu button.
    expect(journalBtn.closest(".hud-top-right")).not.toBeNull();
    expect(menuBtn.closest(".hud-top-right")).not.toBeNull();
    expect(journalBtn.parentElement).toBe(menuBtn.parentElement);

    fireEvent.click(journalBtn);
    expect(onOpenJournal).toHaveBeenCalledOnce();
    expect(onOpenMenu).not.toHaveBeenCalled();

    // Single-live-region invariant unchanged: only the telemetry role=status.
    expect(container.querySelectorAll("[aria-live],[role=status]").length).toBe(1);
  });
});
