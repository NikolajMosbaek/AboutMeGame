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

  it("recognises a returning winner: shows the completion time and a Return to the island CTA", () => {
    render(
      <TitleScreen
        onStart={() => {}}
        progress={{ discovered: 6, total: 6 }}
        win={{ playSeconds: 754, cluesFound: 6, cluesTotal: 6, deaths: 2, fruitEaten: 9 }}
      />,
    );
    expect(screen.getByText("You found the Lost Idol in 12:34")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return to the island" })).toBeInTheDocument();
    // A winner is not shown the mid-run "pages found" line.
    expect(screen.queryByText(/pages found/i)).not.toBeInTheDocument();
  });

  it("tells a page-reader who never won apart from a winner (progress line, Continue CTA)", () => {
    render(
      <TitleScreen onStart={() => {}} progress={{ discovered: 6, total: 6 }} win={null} />,
    );
    expect(screen.getByText("6 of 6 pages found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.queryByText(/You found the Lost Idol/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Return to the island" })).not.toBeInTheDocument();
  });
});
