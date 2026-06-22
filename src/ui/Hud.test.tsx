import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Hud } from "./Hud.tsx";
import { createHudStore } from "./hudStore.ts";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";

describe("Hud", () => {
  it("shows DRIVE mode and speed but hides altitude on the ground", () => {
    const hud = createHudStore();
    hud.set({ mode: "drive", speed: 42, altitude: 0 });
    render(<Hud hud={hud} discovery={createDiscoveryStore(13)} onOpenMenu={() => {}} />);
    expect(screen.getByText("DRIVE")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.queryByText(/alt/i)).not.toBeInTheDocument();
  });

  it("shows FLY mode and altitude in flight", () => {
    const hud = createHudStore();
    hud.set({ mode: "fly", speed: 30, altitude: 88 });
    render(<Hud hud={hud} discovery={createDiscoveryStore(13)} onOpenMenu={() => {}} />);
    expect(screen.getByText("FLY")).toBeInTheDocument();
    expect(screen.getByText("88")).toBeInTheDocument();
    expect(screen.getByText(/alt/i)).toBeInTheDocument();
  });

  it("renders the single discovery-progress badge from the discovery store", () => {
    const discovery = createDiscoveryStore(13);
    discovery.setDiscovered(["a", "b", "c"]);
    render(<Hud hud={createHudStore()} discovery={discovery} onOpenMenu={() => {}} />);
    expect(screen.getByText("Discovered 3 / 13")).toBeInTheDocument();
  });

  it('shows remaining "N to go" mid-journey and updates on re-render', () => {
    const discovery = createDiscoveryStore(13);
    discovery.setDiscovered(["a", "b", "c"]);
    render(<Hud hud={createHudStore()} discovery={discovery} onOpenMenu={() => {}} />);
    expect(screen.getByText("Discovered 3 / 13")).toBeInTheDocument();
    expect(screen.getByText("10 to go")).toBeInTheDocument();

    act(() => discovery.setDiscovered(["a", "b", "c", "d", "e"]));
    expect(screen.getByText("8 to go")).toBeInTheDocument();
    expect(screen.queryByText("10 to go")).not.toBeInTheDocument();
  });

  it("shows the singular boundary as '1 to go' (not '1 to gos')", () => {
    const discovery = createDiscoveryStore(13);
    discovery.setDiscovered(Array.from({ length: 12 }, (_, i) => `p${i}`));
    render(<Hud hud={createHudStore()} discovery={discovery} onOpenMenu={() => {}} />);
    expect(screen.getByText("1 to go")).toBeInTheDocument();
    expect(screen.queryByText("1 to gos")).not.toBeInTheDocument();
  });

  it("renders '13 to go' for an empty/uninitialized store and not the completed state", () => {
    const discovery = createDiscoveryStore(13);
    render(<Hud hud={createHudStore()} discovery={discovery} onOpenMenu={() => {}} />);
    expect(screen.getByText("13 to go")).toBeInTheDocument();
    expect(screen.queryByText("All discovered")).not.toBeInTheDocument();
  });

  it("opens the menu when the menu button is clicked", () => {
    const onOpenMenu = vi.fn();
    render(<Hud hud={createHudStore()} discovery={createDiscoveryStore(13)} onOpenMenu={onOpenMenu} />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(onOpenMenu).toHaveBeenCalledOnce();
  });
});
