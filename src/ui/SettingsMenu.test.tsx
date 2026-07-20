import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SettingsMenu } from "./SettingsMenu.tsx";
import { createSettingsStore } from "../settings/settingsStore.ts";

/** A store with no persistence backend, so the test never touches localStorage. */
function store() {
  return createSettingsStore(undefined);
}

describe("SettingsMenu", () => {
  it("toggles mute through the settings store", () => {
    const settings = store();
    render(
      <SettingsMenu settings={settings} onClose={() => {}} onExit={() => {}} onResetProgress={() => {}} />,
    );
    const sound = screen.getByRole("switch", { name: /sound/i });
    expect(sound).toHaveAttribute("aria-checked", "true"); // on (not muted)
    fireEvent.click(sound);
    expect(settings.getSnapshot().muted).toBe(true);
  });

  it("selects a quality preset", () => {
    const settings = store();
    render(
      <SettingsMenu settings={settings} onClose={() => {}} onExit={() => {}} onResetProgress={() => {}} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Low" }));
    expect(settings.getSnapshot().quality).toBe("low");
  });

  it("wires Resume and Back to title", () => {
    const onClose = vi.fn();
    const onExit = vi.fn();
    render(
      <SettingsMenu settings={store()} onClose={onClose} onExit={onExit} onResetProgress={() => {}} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Back to title" }));
    expect(onExit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("guards Reset progress behind an explicit confirm", () => {
    const onResetProgress = vi.fn();
    render(
      <SettingsMenu settings={store()} onClose={() => {}} onExit={() => {}} onResetProgress={onResetProgress} />,
    );
    // The first click only arms the confirm — it must NOT wipe the run.
    fireEvent.click(screen.getByRole("button", { name: "Reset progress" }));
    expect(onResetProgress).not.toHaveBeenCalled();

    // Cancel backs out cleanly, restoring the idle button.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onResetProgress).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reset progress" })).toBeInTheDocument();

    // Arm again, then confirm — now it resets exactly once and acknowledges.
    fireEvent.click(screen.getByRole("button", { name: "Reset progress" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, reset" }));
    expect(onResetProgress).toHaveBeenCalledOnce();
    expect(screen.getByText("Progress reset.")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <SettingsMenu settings={store()} onClose={onClose} onExit={() => {}} onResetProgress={() => {}} />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

});
