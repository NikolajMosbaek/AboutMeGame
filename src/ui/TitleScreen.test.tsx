import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TitleScreen } from "./TitleScreen.tsx";
import { VISION } from "../version.ts";

describe("TitleScreen", () => {
  it("renders the game title as the page heading and focuses it on mount", () => {
    render(<TitleScreen onStart={() => {}} />);
    const heading = screen.getByRole("heading", { level: 1, name: "THE LOST IDOL" });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveFocus();
  });

  it("shows the real product vision as the tagline", () => {
    render(<TitleScreen onStart={() => {}} />);
    expect(screen.getByText(VISION)).toBeInTheDocument();
  });

  it("presents a Begin the expedition CTA that calls onStart once when clicked", () => {
    const onStart = vi.fn();
    render(<TitleScreen onStart={onStart} progress={{ discovered: 0, total: 6 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Begin the expedition" }));
    expect(onStart).toHaveBeenCalledOnce();
  });

  it("shows a controls hint", () => {
    render(<TitleScreen onStart={() => {}} progress={{ discovered: 0, total: 6 }} />);
    expect(screen.getByText(/WASD/i)).toBeInTheDocument();
  });

  it("renders touch-phrased controls hint when channel is touch", () => {
    render(
      <TitleScreen onStart={() => {}} progress={{ discovered: 0, total: 6 }} channel="touch" />,
    );
    // No keyboard-only WASD copy for a coarse-pointer visitor...
    expect(screen.queryByText(/WASD/i)).not.toBeInTheDocument();
    // ...and the touch wording naming the on-screen joystick/USE buttons is
    // present, so a blank/empty hint can't pass as a regression.
    expect(screen.getByText(/joystick to walk/i)).toBeInTheDocument();
    expect(screen.getByText(/tap USE/i)).toBeInTheDocument();
  });

  it("renders the exact keyboard hint when channel is keyboard", () => {
    render(
      <TitleScreen onStart={() => {}} progress={{ discovered: 0, total: 6 }} channel="keyboard" />,
    );
    expect(screen.getByText("WASD to walk · Shift to sprint · E to use")).toBeInTheDocument();
  });

  it("defaults to the exact keyboard hint when channel is omitted (jsdom has no matchMedia)", () => {
    render(<TitleScreen onStart={() => {}} progress={{ discovered: 0, total: 6 }} />);
    expect(screen.getByText("WASD to walk · Shift to sprint · E to use")).toBeInTheDocument();
  });

  it("reads Begin the expedition with no saved progress and shows no progress line", () => {
    render(<TitleScreen onStart={() => {}} progress={{ discovered: 0, total: 6 }} />);
    expect(screen.getByRole("button", { name: "Begin the expedition" })).toBeInTheDocument();
    expect(screen.queryByText(/pages found/i)).not.toBeInTheDocument();
  });

  it("reads Continue and shows the saved progress when some pages are found", () => {
    render(<TitleScreen onStart={() => {}} progress={{ discovered: 4, total: 6 }} />);
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.getByText("4 of 6 pages found")).toBeInTheDocument();
  });

  it("offers a text-view link that calls onReadText", () => {
    const onReadText = vi.fn();
    render(
      <TitleScreen onStart={() => {}} onReadText={onReadText} progress={{ discovered: 0, total: 6 }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /about this game/i }));
    expect(onReadText).toHaveBeenCalledOnce();
  });

  it("hides the text-view link when onReadText is not provided", () => {
    render(<TitleScreen onStart={() => {}} progress={{ discovered: 0, total: 6 }} />);
    expect(screen.queryByRole("button", { name: /about this game/i })).not.toBeInTheDocument();
  });
});
