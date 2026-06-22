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
    render(<TitleScreen onStart={onStart} progress={{ discovered: 0, total: 13 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Drive in" }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("shows a controls hint", () => {
    render(<TitleScreen onStart={() => {}} progress={{ discovered: 0, total: 13 }} />);
    expect(screen.getByText(/WASD/i)).toBeInTheDocument();
  });

  it("reads Drive in with no saved progress and shows no progress line", () => {
    render(<TitleScreen onStart={() => {}} progress={{ discovered: 0, total: 13 }} />);
    expect(screen.getByRole("button", { name: "Drive in" })).toBeInTheDocument();
    expect(screen.queryByText(/discovered/i)).not.toBeInTheDocument();
  });

  it("reads Continue and shows the saved progress when some landmarks are found", () => {
    render(<TitleScreen onStart={() => {}} progress={{ discovered: 4, total: 13 }} />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.getByText("4 / 13 discovered")).toBeInTheDocument();
  });
});
