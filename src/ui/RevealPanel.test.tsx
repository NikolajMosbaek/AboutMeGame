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
