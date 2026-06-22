import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

  it("opens the menu when the menu button is clicked", () => {
    const onOpenMenu = vi.fn();
    render(<Hud hud={createHudStore()} discovery={createDiscoveryStore(13)} onOpenMenu={onOpenMenu} />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(onOpenMenu).toHaveBeenCalledOnce();
  });
});
