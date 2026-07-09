import { afterEach, describe, expect, it } from "vitest";
import {
  readControlChannel,
  resolveControlScheme,
  type ControlEntry,
} from "./controlScheme.ts";

/** Serialise an entry to a single searchable string (label + action). */
function text(entry: ControlEntry): string {
  return `${entry.label} ${entry.action}`;
}

describe("resolveControlScheme", () => {
  it("returns the full first-person keyboard table (W A S D / Mouse / Shift / E / Esc)", () => {
    const scheme = resolveControlScheme("keyboard");
    expect(scheme.channel).toBe("keyboard");

    const labels = scheme.entries.map((e) => e.label);
    for (const key of ["W A S D", "Mouse", "Shift", "E", "Esc"]) {
      expect(labels).toContain(key);
    }

    // The action copy names the explorer verbs.
    const byLabel = (label: string) =>
      scheme.entries.find((e) => e.label === label)?.action;
    expect(byLabel("W A S D")).toBe("Walk");
    expect(byLabel("Mouse")).toBe("Look (click to grab)");
    expect(byLabel("Shift")).toBe("Sprint");
    expect(byLabel("E")).toBe("Use / examine");
    expect(byLabel("Esc")).toBe("Menu");

    // The vehicle-era hints are gone.
    expect(labels).not.toContain("F");
    expect(labels).not.toContain("Space");
  });

  it("returns the on-screen touch controls (joystick / look drag / SPRINT / USE) and never 'W A S D'", () => {
    const scheme = resolveControlScheme("touch");
    expect(scheme.channel).toBe("touch");

    const labels = scheme.entries.map((e) => e.label);
    expect(labels).toContain("SPRINT");
    expect(labels).toContain("USE");
    expect(labels).not.toContain("FLY");
    expect(labels).not.toContain("▲");
    // The drive control is the on-screen joystick, named by its action, not WASD.
    expect(scheme.entries.some((e) => /joystick/i.test(text(e)))).toBe(true);

    // No touch entry leaks the keyboard 'W A S D' token anywhere.
    for (const entry of scheme.entries) {
      expect(text(entry)).not.toContain("W A S D");
    }
  });

  it("is a pure function of its channel argument (same input -> same output)", () => {
    expect(resolveControlScheme("keyboard")).toEqual(resolveControlScheme("keyboard"));
    expect(resolveControlScheme("touch")).toEqual(resolveControlScheme("touch"));
  });
});

describe("readControlChannel", () => {
  it("maps an injected coarse-pointer env to 'touch'", () => {
    expect(readControlChannel({ coarsePointer: true })).toBe("touch");
  });

  it("maps an injected fine-pointer env to 'keyboard'", () => {
    expect(readControlChannel({ coarsePointer: false })).toBe("keyboard");
  });
});

describe("readControlChannel — real default-arg guard", () => {
  const original = Reflect.getOwnPropertyDescriptor(window, "matchMedia");

  afterEach(() => {
    // Restore so the absent-matchMedia stub never leaks into sibling tests.
    if (original) {
      Object.defineProperty(window, "matchMedia", original);
    } else {
      // jsdom defines matchMedia by default; deleting our stub is enough.
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });

  it("defaults to 'keyboard' when matchMedia is absent (SSR/jsdom), via the real guard", () => {
    // Exercise the real readEnv()-style default arg, not an injected fake.
    delete (window as { matchMedia?: unknown }).matchMedia;
    expect(readControlChannel()).toBe("keyboard");
  });

  it("does not leak the absent-matchMedia stub into sibling tests", () => {
    // Runs after the stub test above. If afterEach failed to restore, the own
    // `matchMedia` descriptor would differ from what we captured at setup —
    // proving the cleanup, not just the guard.
    const current = Reflect.getOwnPropertyDescriptor(window, "matchMedia");
    expect(current).toEqual(original);
  });
});
