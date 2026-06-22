import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { RevealPanel } from "./RevealPanel.tsx";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import type { PoiInteraction } from "../content/contentModel.ts";

const GUESS: PoiInteraction = {
  type: "guess",
  prompt: "What clears a change through this gate?",
  options: [
    { text: "Citing the actual build or test output", correct: true },
    { text: 'Saying "tests pass"', correct: false },
  ],
  answerReveal: "Proof, not my word.",
};

const HIGHLIGHT: PoiInteraction = {
  type: "highlight",
  emphasis: "If the sentence won't come, that's the signal.",
};

// A substring of the guess POI body chosen so it appears nowhere in the prompt,
// the options, or the answerReveal — it is present in the DOM only once the
// body is unlocked, so its presence/absence is a faithful body-gate probe.
const GUESS_BODY = "No work clears this gate on my word.";
const GUESS_BODY_PROBE = "clears this gate on my word";

// A substring of the highlight POI body, distinct from its emphasis lede.
const HIGHLIGHT_BODY = "Before I touch a single file.";

function openGuess(store: ReturnType<typeof createDiscoveryStore>) {
  act(() => {
    store.openPoi({
      id: "poi-staff-engineer-gate",
      order: 4,
      title: "The Staff-Engineer Gate",
      body: GUESS_BODY,
      interaction: GUESS,
    });
  });
}

function openHighlight(store: ReturnType<typeof createDiscoveryStore>) {
  act(() => {
    store.openPoi({
      id: "poi-end-state-overlook",
      order: 2,
      title: "The One-Sentence Overlook",
      body: HIGHLIGHT_BODY,
      interaction: HIGHLIGHT,
    });
  });
}

function openPlain(store: ReturnType<typeof createDiscoveryStore>) {
  act(() => {
    store.openPoi({
      id: "poi-arrivals-gate",
      order: 1,
      title: "The Arrivals Gate",
      body: "Welcome to the spawn point.",
    });
  });
}

describe("RevealPanel guess interaction (t4)", () => {
  it("renders the prompt + option buttons in a labelled group and hides the body before a pick", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    render(<RevealPanel store={store} />);

    // The prompt is present and is the group's accessible label.
    const prompt = screen.getByText(GUESS.prompt);
    expect(prompt.id).toBe("reveal-guess-prompt");
    const group = screen.getByRole("group");
    expect(group.getAttribute("aria-labelledby")).toBe("reveal-guess-prompt");

    // Both options render as real, focusable buttons inside the group.
    for (const option of GUESS.options) {
      const button = screen.getByRole("button", { name: option.text });
      expect(group.contains(button)).toBe(true);
    }

    // The distinctive body substring is NOT in the DOM before any pick — the
    // body node is conditionally not rendered, not merely CSS-hidden.
    expect(screen.queryByText(GUESS_BODY_PROBE, { exact: false })).toBeNull();
  });

  it("commits the option's array index, unlocks the body, and marks the chosen option", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    render(<RevealPanel store={store} />);

    const chosenText = GUESS.options[0].text;
    act(() => {
      screen.getByRole("button", { name: chosenText }).click();
    });

    // The store recorded array position 0; the panel reads it back.
    expect(store.getSnapshot().open?.guessChoice).toBe(0);
    expect(store.getSnapshot().open?.bodyUnlocked).toBe(true);

    // The body is now rendered, driven solely by the store's bodyUnlocked.
    expect(screen.getByText(GUESS_BODY)).toBeTruthy();

    // The committed option carries aria-pressed + a non-color affordance class.
    const chosen = screen.getByRole("button", { name: chosenText });
    expect(chosen.getAttribute("aria-pressed")).toBe("true");
    expect(chosen.className).toContain("reveal-panel__option--chosen");

    // answerReveal renders in the emphasis callout post-pick.
    expect(screen.getByText(GUESS.answerReveal!).className).toContain(
      "reveal-panel__emphasis",
    );
  });

  it("announces the unlock once on the false→true transition and re-clicking is idempotent", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    const { container } = render(<RevealPanel store={store} />);

    const status = container.querySelector(".sr-only[role=status]");
    expect(status).toBeTruthy();
    expect(status!.textContent).toBe("");

    const chosenText = GUESS.options[0].text;
    act(() => {
      screen.getByRole("button", { name: chosenText }).click();
    });
    expect(status!.textContent).toBe("Answer revealed.");

    // Re-clicking the same option is a store no-op: still committed, the body
    // stays rendered (no flicker), and the unlock is announced exactly once
    // (no re-fire).
    act(() => {
      screen.getByRole("button", { name: chosenText }).click();
    });
    expect(store.getSnapshot().open?.guessChoice).toBe(0);
    expect(screen.getByText(GUESS_BODY)).toBeTruthy();
    expect(status!.textContent).toBe("Answer revealed.");
  });

  it("does not announce on mount before any pick", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    const { container } = render(<RevealPanel store={store} />);
    expect(container.querySelector(".sr-only[role=status]")!.textContent).toBe("");
  });
});

describe("RevealPanel polite announce (t6)", () => {
  // The announce region is local to the guess body — a plain or highlight
  // reveal carries no spurious announcer and therefore makes no sound on mount.
  it("makes no spurious announce on mount for a plain reveal", () => {
    const store = createDiscoveryStore(13);
    openPlain(store);
    const { container } = render(<RevealPanel store={store} />);
    const status = container.querySelector(".sr-only[role=status]");
    expect(status?.textContent ?? "").toBe("");
  });

  it("makes no spurious announce on mount for a highlight reveal", () => {
    const store = createDiscoveryStore(13);
    openHighlight(store);
    const { container } = render(<RevealPanel store={store} />);
    const status = container.querySelector(".sr-only[role=status]");
    expect(status?.textContent ?? "").toBe("");
  });

  it("announces once on commit and not again on a re-click no-op", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    const { container } = render(<RevealPanel store={store} />);
    const status = container.querySelector(".sr-only[role=status]")!;
    expect(status.textContent).toBe("");

    const chosenText = GUESS.options[0].text;
    act(() => {
      screen.getByRole("button", { name: chosenText }).click();
    });
    expect(status.textContent).toBe("Answer revealed.");

    act(() => {
      screen.getByRole("button", { name: chosenText }).click();
    });
    // Idempotent re-click: still committed, announced exactly once.
    expect(store.getSnapshot().open?.guessChoice).toBe(0);
    expect(status.textContent).toBe("Answer revealed.");
  });
});

describe("RevealPanel styling hooks (t3)", () => {
  it("marks the committed guess option with the reveal-panel__option--chosen class", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    render(<RevealPanel store={store} />);

    act(() => {
      screen
        .getByRole("button", { name: "Citing the actual build or test output" })
        .click();
    });

    const chosen = screen.getByRole("button", {
      name: "Citing the actual build or test output",
    });
    expect(chosen.className).toContain("reveal-panel__option--chosen");
  });

  it("renders a highlight emphasis node carrying the reveal-panel__emphasis class", () => {
    const store = createDiscoveryStore(13);
    openHighlight(store);
    render(<RevealPanel store={store} />);

    const emphasis = screen.getByText(HIGHLIGHT.emphasis);
    expect(emphasis.className).toContain("reveal-panel__emphasis");
  });
});

describe("RevealPanel plain regression (t4)", () => {
  it("renders eyebrow, title, body, and the close button with no option buttons", () => {
    const store = createDiscoveryStore(13);
    openPlain(store);
    render(<RevealPanel store={store} />);

    expect(screen.getByText(/Landmark 1 of 13/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "The Arrivals Gate" })).toBeTruthy();
    const body = screen.getByText("Welcome to the spawn point.");
    expect(body.className).toContain("reveal-panel__body");

    // The only button on a plain reveal is the close CTA — no guess group.
    expect(screen.queryByRole("group")).toBeNull();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe("Drive on");
  });
});

describe("RevealPanel highlight interaction (t4)", () => {
  it("shows the emphasis above the body, both immediately with no gate", () => {
    const store = createDiscoveryStore(13);
    openHighlight(store);
    render(<RevealPanel store={store} />);

    const emphasis = screen.getByText(HIGHLIGHT.emphasis);
    const body = screen.getByText(HIGHLIGHT_BODY);
    expect(emphasis.className).toContain("reveal-panel__emphasis");
    expect(body.className).toContain("reveal-panel__body");
    // Emphasis precedes the body in document order (lede/callout above).
    expect(
      emphasis.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // No guess controls.
    expect(screen.queryByRole("group")).toBeNull();
  });
});

describe("RevealPanel close affordances (t4)", () => {
  const open = {
    plain: openPlain,
    highlight: openHighlight,
    guess: openGuess,
  } as const;

  for (const type of ["plain", "highlight", "guess"] as const) {
    it(`closes on the close button for a ${type} reveal`, () => {
      const store = createDiscoveryStore(13);
      open[type](store);
      render(<RevealPanel store={store} />);
      act(() => {
        screen.getByRole("button", { name: "Drive on" }).click();
      });
      expect(store.getSnapshot().open).toBeNull();
    });

    it(`closes on Escape for a ${type} reveal`, () => {
      const store = createDiscoveryStore(13);
      open[type](store);
      render(<RevealPanel store={store} />);
      act(() => {
        fireEvent.keyDown(window, { key: "Escape" });
      });
      expect(store.getSnapshot().open).toBeNull();
    });

    it(`closes on backdrop click for a ${type} reveal`, () => {
      const store = createDiscoveryStore(13);
      open[type](store);
      const { container } = render(<RevealPanel store={store} />);
      const backdrop = container.querySelector(".reveal-panel-backdrop")!;
      act(() => {
        fireEvent.click(backdrop);
      });
      expect(store.getSnapshot().open).toBeNull();
    });
  }

  it("closes an un-answered guess via Drive on without requiring a pick", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    render(<RevealPanel store={store} />);
    expect(store.getSnapshot().open?.guessChoice).toBeNull();
    act(() => {
      screen.getByRole("button", { name: "Drive on" }).click();
    });
    expect(store.getSnapshot().open).toBeNull();
  });
});

describe("RevealPanel focus management (t7)", () => {
  it("focuses the first option button when a guess opens", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    render(<RevealPanel store={store} />);

    const firstOption = screen.getByRole("button", { name: GUESS.options[0].text });
    expect(document.activeElement).toBe(firstOption);
  });

  it("focuses the close button when a plain reveal opens", () => {
    const store = createDiscoveryStore(13);
    openPlain(store);
    render(<RevealPanel store={store} />);

    const close = screen.getByRole("button", { name: "Drive on" });
    expect(document.activeElement).toBe(close);
  });

  it("focuses the close button when a highlight reveal opens", () => {
    const store = createDiscoveryStore(13);
    openHighlight(store);
    render(<RevealPanel store={store} />);

    const close = screen.getByRole("button", { name: "Drive on" });
    expect(document.activeElement).toBe(close);
  });

  it("does not yank focus off the active element when a guess is committed", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    render(<RevealPanel store={store} />);

    // Move focus to the second option, as a keyboard user would, then commit it.
    // answerGuess produces a NEW `open` object; a focus effect keyed on the whole
    // `open` reference would re-fire and snap focus back to the first option.
    const secondOption = screen.getByRole("button", { name: GUESS.options[1].text });
    act(() => {
      secondOption.focus();
      secondOption.click();
    });

    // Focus stays on the committed option — the focus effect is gated on open.id,
    // which is unchanged across the commit, so it does not re-fire.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: GUESS.options[1].text }),
    );
  });

  it("keeps the close button reachable after the body unlocks (it is never removed by the body gate)", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    render(<RevealPanel store={store} />);

    act(() => {
      screen.getByRole("button", { name: GUESS.options[0].text }).click();
    });

    const close = screen.getByRole("button", { name: "Drive on" });
    expect(close.tagName).toBe("BUTTON");
    // Tab order reaches it (native button, not aria-hidden / disabled).
    expect(close.hasAttribute("disabled")).toBe(false);
  });
});

describe("RevealPanel close affordances per type (t7)", () => {
  const open = {
    plain: openPlain,
    highlight: openHighlight,
    guess: openGuess,
  } as const;

  for (const type of ["plain", "highlight", "guess"] as const) {
    it(`Escape, backdrop-click, and the close button each close an un-answered ${type} reveal`, () => {
      // Close button.
      const s1 = createDiscoveryStore(13);
      open[type](s1);
      render(<RevealPanel store={s1} />);
      expect(s1.getSnapshot().open?.guessChoice ?? null).toBeNull();
      act(() => {
        screen.getByRole("button", { name: "Drive on" }).click();
      });
      expect(s1.getSnapshot().open).toBeNull();

      // Escape.
      const s2 = createDiscoveryStore(13);
      open[type](s2);
      render(<RevealPanel store={s2} />);
      act(() => {
        fireEvent.keyDown(window, { key: "Escape" });
      });
      expect(s2.getSnapshot().open).toBeNull();

      // Backdrop click.
      const s3 = createDiscoveryStore(13);
      open[type](s3);
      const { container } = render(<RevealPanel store={s3} />);
      act(() => {
        fireEvent.click(container.querySelector(".reveal-panel-backdrop")!);
      });
      expect(s3.getSnapshot().open).toBeNull();
    });
  }
});

describe("RevealPanel keyboard accessibility (t4)", () => {
  it("renders guess options as native buttons (Tab-reachable) that activate on click", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    render(<RevealPanel store={store} />);

    const button = screen.getByRole("button", { name: GUESS.options[1].text });
    // Native <button type=button> is focusable and Enter/Space-activated by the
    // platform; assert the element type and that activation commits the index.
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    act(() => {
      button.click();
    });
    expect(store.getSnapshot().open?.guessChoice).toBe(1);
  });
});

describe("RevealPanel keyboard activation (t8)", () => {
  // jsdom does not synthesize a click from an Enter/Space keystroke on a native
  // button (the platform does that at the browser layer, not in JSDOM). So a
  // bare fireEvent.keyDown(Enter) would test nothing here. Instead this suite
  // proves the two things that make platform Enter/Space activation work and be
  // honest about the seam:
  //   1. The option is a real <button type="button"> — not a div+role, not a
  //      tabindex hack — so the platform activates it on Enter/Space and Tab
  //      reaches it. We assert the element contract directly.
  //   2. The option's activation handler commits the guess identically to a
  //      click (the same onClick the platform dispatches on Enter/Space),
  //      unlocking the body exactly as a mouse click does.
  // We also assert the *Tab order*: the prompt is inert (not focusable), the
  // options are focusable in authored order, and the close button follows them
  // in document order — so Tab walks prompt-group → close as designed.

  function focusableInDialog(container: HTMLElement): HTMLElement[] {
    const dialog = container.querySelector('[role="dialog"]')!;
    return Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("disabled"));
  }

  it("activates an option via the platform contract: native button + commit handler, identical to a click", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    render(<RevealPanel store={store} />);

    const option = screen.getByRole("button", { name: GUESS.options[0].text });

    // A keyboard user focuses the option; it must be a genuinely focusable
    // native button (the platform's Enter/Space → click contract).
    act(() => {
      option.focus();
    });
    expect(document.activeElement).toBe(option);
    expect(option.tagName).toBe("BUTTON");
    expect(option.getAttribute("type")).toBe("button");
    expect(option.hasAttribute("disabled")).toBe(false);
    // The body is gated until activation.
    expect(screen.queryByText(GUESS_BODY_PROBE, { exact: false })).toBeNull();

    // Enter/Space activation dispatches the same click the handler runs on —
    // committing the index and unlocking the body identically to a mouse click.
    act(() => {
      option.click();
    });
    expect(store.getSnapshot().open?.guessChoice).toBe(0);
    expect(store.getSnapshot().open?.bodyUnlocked).toBe(true);
    expect(screen.getByText(GUESS_BODY)).toBeTruthy();
  });

  it("Enter and Space each commit the guess and unlock the body identically to a click", () => {
    // Enter.
    const enterStore = createDiscoveryStore(13);
    openGuess(enterStore);
    const enterRender = render(<RevealPanel store={enterStore} />);
    const enterOption = enterRender.getByRole("button", { name: GUESS.options[0].text });
    act(() => {
      enterOption.focus();
      // Drive a faithful Enter activation: keyDown then the click the platform
      // dispatches for Enter on a focused native button.
      fireEvent.keyDown(enterOption, { key: "Enter", code: "Enter" });
      enterOption.click();
    });
    expect(enterStore.getSnapshot().open?.guessChoice).toBe(0);
    expect(enterStore.getSnapshot().open?.bodyUnlocked).toBe(true);
    expect(enterRender.getByText(GUESS_BODY)).toBeTruthy();
    enterRender.unmount();

    // Space — same body-unlock outcome, on the other option.
    const spaceStore = createDiscoveryStore(13);
    openGuess(spaceStore);
    const spaceRender = render(<RevealPanel store={spaceStore} />);
    const spaceOption = spaceRender.getByRole("button", { name: GUESS.options[1].text });
    act(() => {
      spaceOption.focus();
      fireEvent.keyDown(spaceOption, { key: " ", code: "Space" });
      spaceOption.click();
    });
    expect(spaceStore.getSnapshot().open?.guessChoice).toBe(1);
    expect(spaceStore.getSnapshot().open?.bodyUnlocked).toBe(true);
    expect(spaceRender.getByText(GUESS_BODY)).toBeTruthy();
    spaceRender.unmount();
  });

  it("tabbing walks from the option group to the close button (options before close in tab order)", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    const { container } = render(<RevealPanel store={store} />);

    // The prompt is a <p>, not focusable — it labels the group, it is not a stop.
    const prompt = screen.getByText(GUESS.prompt);
    expect(prompt.tagName).toBe("P");
    expect(prompt.hasAttribute("tabindex")).toBe(false);

    const focusable = focusableInDialog(container);
    // The option buttons come first, in authored order, then the close button.
    const optionA = screen.getByRole("button", { name: GUESS.options[0].text });
    const optionB = screen.getByRole("button", { name: GUESS.options[1].text });
    const close = screen.getByRole("button", { name: "Drive on" });

    expect(focusable).toEqual([optionA, optionB, close]);
    // Close is the last focusable stop, reached by Tab after the options.
    expect(focusable.indexOf(close)).toBe(focusable.length - 1);
    expect(focusable.indexOf(optionA)).toBeLessThan(focusable.indexOf(optionB));
    expect(focusable.indexOf(optionB)).toBeLessThan(focusable.indexOf(close));
  });
});
