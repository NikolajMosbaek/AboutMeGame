import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TitleScreen } from "./TitleScreen.tsx";
import { VISION } from "../version.ts";

describe("TitleScreen", () => {
  it("renders the game title as the page heading and focuses it on mount", () => {
    render(<TitleScreen onStart={() => {}} />);
    const heading = screen.getByRole("heading", { level: 1, name: "AboutMeGame" });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveFocus();
  });

  it("shows the real product vision as the tagline", () => {
    render(<TitleScreen onStart={() => {}} />);
    expect(screen.getByText(VISION)).toBeInTheDocument();
  });

  it("presents a Drive in CTA that calls onStart once when clicked", () => {
    const onStart = vi.fn();
    render(<TitleScreen onStart={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: "Drive in" }));
    expect(onStart).toHaveBeenCalledOnce();
  });
});
