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

  it("wires Resume, Reset progress and Back to title", () => {
    const onClose = vi.fn();
    const onExit = vi.fn();
    const onResetProgress = vi.fn();
    render(
      <SettingsMenu settings={store()} onClose={onClose} onExit={onExit} onResetProgress={onResetProgress} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset progress" }));
    expect(onResetProgress).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Back to title" }));
    expect(onExit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(onClose).toHaveBeenCalledOnce();
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
