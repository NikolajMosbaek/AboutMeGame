import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { NavMarkers } from "./NavMarkers.tsx";
import { createNavStore } from "./navStore.ts";

describe("NavMarkers", () => {
  it("renders an on-screen dot and an off-screen arrow with their labels", () => {
    const nav = createNavStore();
    nav.set([
      { id: "near", color: 0xffcb47, label: "20 m", onScreen: true, x: 50, y: 40, edgeAngle: 0 },
      { id: "far", color: 0x7ad1ff, label: "300 m", onScreen: false, x: 0, y: 0, edgeAngle: 1.2 },
    ]);
    const { container } = render(<NavMarkers nav={nav} />);
    expect(container.querySelector(".nav-dot")).not.toBeNull();
    expect(container.querySelector(".nav-arrow")).not.toBeNull();
    expect(container.textContent).toContain("20 m");
    expect(container.textContent).toContain("300 m");
  });

  it("renders nothing when there are no markers", () => {
    const { container } = render(<NavMarkers nav={createNavStore()} />);
    expect(container.querySelector(".nav-dot")).toBeNull();
    expect(container.querySelector(".nav-arrow")).toBeNull();
  });
});
