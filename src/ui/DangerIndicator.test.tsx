import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DangerIndicator } from "./DangerIndicator.tsx";
import { createDangerStore } from "../wildlife/dangerWarning.ts";

afterEach(cleanup);

describe("DangerIndicator", () => {
  it("renders nothing when no threat is active", () => {
    render(<DangerIndicator danger={createDangerStore()} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("warns about a reared snake in an assertive live region", () => {
    const danger = createDangerStore();
    danger.set({ snake: true, predator: false });
    render(<DangerIndicator danger={danger} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveAttribute("aria-live", "assertive");
    expect(banner.textContent).toMatch(/snake/i);
  });

  it("lets the graver predator name the banner when both threats fire at once", () => {
    const danger = createDangerStore();
    danger.set({ snake: true, predator: true });
    render(<DangerIndicator danger={danger} />);
    expect(screen.getByRole("status").textContent).toMatch(/predator/i);
  });
});
