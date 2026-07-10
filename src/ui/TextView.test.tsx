import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TextView } from "./TextView.tsx";

describe("TextView", () => {
  it("renders a WebGL-unavailable notice with a title and explanatory copy, focusing the heading on mount", () => {
    render(<TextView onBack={() => {}} />);
    const heading = screen.getByRole("heading", { level: 1, name: "THE LOST IDOL" });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveFocus();
    expect(screen.getByText(/needs webgl\/3d/i)).toBeInTheDocument();
    expect(screen.getByText(/emerald idol/i)).toBeInTheDocument();
  });

  it("wires the Back control", () => {
    const onBack = vi.fn();
    render(<TextView onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
