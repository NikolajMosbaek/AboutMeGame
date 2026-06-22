import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { RevealPanel } from "./RevealPanel.tsx";
import { createDiscoveryStore } from "../discovery/discoveryStore.ts";
import { nextUndiscovered } from "../discovery/nextUndiscovered.ts";
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

// The ordered POI projection threaded into RevealPanel (M2 slice 4). It mirrors
// the three fixtures opened below so the (later-wired) selector has real
// candidates; T2 only widens the prop, so no `Next:` button renders yet.
const POIS = [
  { id: "poi-arrivals-gate", order: 1, title: "The Arrivals Gate" },
  { id: "poi-end-state-overlook", order: 2, title: "The One-Sentence Overlook" },
  { id: "poi-staff-engineer-gate", order: 4, title: "The Staff-Engineer Gate" },
];

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

describe("RevealPanel pois prop wiring (t4)", () => {
  // The `pois` projection feeds the "Next landmark" selector. The existing
  // reveal/teaser/guess body behaviour stays unchanged; Next now renders for an
  // unlocked POI with a concrete next-by-order target, and is gated off until a
  // guess is committed.
  it("renders the plain reveal unchanged and shows Next (unlocked)", () => {
    const store = createDiscoveryStore(13);
    openPlain(store);
    render(<RevealPanel store={store} pois={POIS} />);

    expect(screen.getByText("The Arrivals Gate")).toBeTruthy();
    expect(screen.getByText("Welcome to the spawn point.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Next:/ })).toBeTruthy();
  });

  it("renders the highlight reveal unchanged and shows Next (unlocked)", () => {
    const store = createDiscoveryStore(13);
    openHighlight(store);
    render(<RevealPanel store={store} pois={POIS} />);

    expect(screen.getByText("The One-Sentence Overlook")).toBeTruthy();
    expect(screen.getByText(HIGHLIGHT.emphasis as string)).toBeTruthy();
    expect(screen.getByText(HIGHLIGHT_BODY)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Next:/ })).toBeTruthy();
  });

  it("renders the guess reveal unchanged: Next absent pre-pick, present post-pick", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    render(<RevealPanel store={store} pois={POIS} />);

    expect(screen.getByText("The Staff-Engineer Gate")).toBeTruthy();
    expect(screen.getByText(GUESS.prompt)).toBeTruthy();
    expect(screen.queryByText(GUESS_BODY_PROBE, { exact: false })).toBeNull();
    // Body locked -> Next is gated off, so forward-nav cannot skip the payload.
    expect(screen.queryByRole("button", { name: /^Next:/ })).toBeNull();

    act(() => {
      store.answerGuess(0);
    });

    // Body unlocks as before; Next now appears for the committed guess.
    expect(screen.getByText(GUESS_BODY)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Next:/ })).toBeTruthy();
  });
});

describe("RevealPanel guess interaction (t4)", () => {
  it("renders the prompt + option buttons in a labelled group and hides the body before a pick", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    render(<RevealPanel store={store} pois={POIS} />);

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
    render(<RevealPanel store={store} pois={POIS} />);

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
    const { container } = render(<RevealPanel store={store} pois={POIS} />);

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
    const { container } = render(<RevealPanel store={store} pois={POIS} />);
    expect(container.querySelector(".sr-only[role=status]")!.textContent).toBe("");
  });
});

describe("RevealPanel polite announce (t6)", () => {
  // The announce region is local to the guess body — a plain or highlight
  // reveal carries no spurious announcer and therefore makes no sound on mount.
  it("makes no spurious announce on mount for a plain reveal", () => {
    const store = createDiscoveryStore(13);
    openPlain(store);
    const { container } = render(<RevealPanel store={store} pois={POIS} />);
    const status = container.querySelector(".sr-only[role=status]");
    expect(status?.textContent ?? "").toBe("");
  });

  it("makes no spurious announce on mount for a highlight reveal", () => {
    const store = createDiscoveryStore(13);
    openHighlight(store);
    const { container } = render(<RevealPanel store={store} pois={POIS} />);
    const status = container.querySelector(".sr-only[role=status]");
    expect(status?.textContent ?? "").toBe("");
  });

  it("announces once on commit and not again on a re-click no-op", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    const { container } = render(<RevealPanel store={store} pois={POIS} />);
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
    render(<RevealPanel store={store} pois={POIS} />);

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
    render(<RevealPanel store={store} pois={POIS} />);

    const emphasis = screen.getByText(HIGHLIGHT.emphasis);
    expect(emphasis.className).toContain("reveal-panel__emphasis");
  });
});

describe("RevealPanel plain regression (t4)", () => {
  it("renders eyebrow, title, body, and the close button with no option buttons", () => {
    const store = createDiscoveryStore(13);
    openPlain(store);
    render(<RevealPanel store={store} pois={POIS} />);

    expect(screen.getByText(/Landmark 1 of 13/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "The Arrivals Gate" })).toBeTruthy();
    const body = screen.getByText("Welcome to the spawn point.");
    expect(body.className).toContain("reveal-panel__body");

    // No guess group on a plain reveal. The footer carries the always-present
    // "Drive on" first, then the named "Next: <title> →" (M2 slice 4) since this
    // unlocked POI has a concrete next-by-order target.
    expect(screen.queryByRole("group")).toBeNull();
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe("Drive on");
    expect(buttons[1].textContent).toMatch(/^Next:/);
  });
});

describe("RevealPanel highlight interaction (t4)", () => {
  it("shows the emphasis above the body, both immediately with no gate", () => {
    const store = createDiscoveryStore(13);
    openHighlight(store);
    render(<RevealPanel store={store} pois={POIS} />);

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
      render(<RevealPanel store={store} pois={POIS} />);
      act(() => {
        screen.getByRole("button", { name: "Drive on" }).click();
      });
      expect(store.getSnapshot().open).toBeNull();
    });

    it(`closes on Escape for a ${type} reveal`, () => {
      const store = createDiscoveryStore(13);
      open[type](store);
      render(<RevealPanel store={store} pois={POIS} />);
      act(() => {
        fireEvent.keyDown(window, { key: "Escape" });
      });
      expect(store.getSnapshot().open).toBeNull();
    });

    it(`closes on backdrop click for a ${type} reveal`, () => {
      const store = createDiscoveryStore(13);
      open[type](store);
      const { container } = render(<RevealPanel store={store} pois={POIS} />);
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
    render(<RevealPanel store={store} pois={POIS} />);
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
    render(<RevealPanel store={store} pois={POIS} />);

    const firstOption = screen.getByRole("button", { name: GUESS.options[0].text });
    expect(document.activeElement).toBe(firstOption);
  });

  it("focuses the close button when a plain reveal opens", () => {
    const store = createDiscoveryStore(13);
    openPlain(store);
    render(<RevealPanel store={store} pois={POIS} />);

    const close = screen.getByRole("button", { name: "Drive on" });
    expect(document.activeElement).toBe(close);
  });

  it("focuses the close button when a highlight reveal opens", () => {
    const store = createDiscoveryStore(13);
    openHighlight(store);
    render(<RevealPanel store={store} pois={POIS} />);

    const close = screen.getByRole("button", { name: "Drive on" });
    expect(document.activeElement).toBe(close);
  });

  it("does not yank focus off the active element when a guess is committed", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    render(<RevealPanel store={store} pois={POIS} />);

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
    render(<RevealPanel store={store} pois={POIS} />);

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
      render(<RevealPanel store={s1} pois={POIS} />);
      expect(s1.getSnapshot().open?.guessChoice ?? null).toBeNull();
      act(() => {
        screen.getByRole("button", { name: "Drive on" }).click();
      });
      expect(s1.getSnapshot().open).toBeNull();

      // Escape.
      const s2 = createDiscoveryStore(13);
      open[type](s2);
      render(<RevealPanel store={s2} pois={POIS} />);
      act(() => {
        fireEvent.keyDown(window, { key: "Escape" });
      });
      expect(s2.getSnapshot().open).toBeNull();

      // Backdrop click.
      const s3 = createDiscoveryStore(13);
      open[type](s3);
      const { container } = render(<RevealPanel store={s3} pois={POIS} />);
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
    render(<RevealPanel store={store} pois={POIS} />);

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
    render(<RevealPanel store={store} pois={POIS} />);

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
    const enterRender = render(<RevealPanel store={enterStore} pois={POIS} />);
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
    const spaceRender = render(<RevealPanel store={spaceStore} pois={POIS} />);
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

  it("tabbing walks options → close → next once the body is unlocked (Next after Drive on)", () => {
    const store = createDiscoveryStore(13);
    openGuess(store);
    const { container } = render(<RevealPanel store={store} pois={POIS} />);

    // The prompt is a <p>, not focusable — it labels the group, it is not a stop.
    const prompt = screen.getByText(GUESS.prompt);
    expect(prompt.tagName).toBe("P");
    expect(prompt.hasAttribute("tabindex")).toBe(false);

    // Commit a pick so the body unlocks and the Next affordance appears. M2
    // slice 4: Next is rendered ONLY when bodyUnlocked is true and the selector
    // returns non-null; for this open (a non-last guess) both hold.
    act(() => {
      screen.getByRole("button", { name: GUESS.options[0].text }).click();
    });

    const focusable = focusableInDialog(container);
    // The option buttons come first, in authored order, then the close button,
    // then Next placed AFTER Drive on in DOM/tab order.
    const optionA = screen.getByRole("button", { name: GUESS.options[0].text });
    const optionB = screen.getByRole("button", { name: GUESS.options[1].text });
    const close = screen.getByRole("button", { name: "Drive on" });
    const next = screen.getByRole("button", { name: /^Next:/ });

    expect(focusable).toEqual([optionA, optionB, close, next]);
    // Next is the last focusable stop, reached by Tab after Drive on.
    expect(focusable.indexOf(next)).toBe(focusable.length - 1);
    expect(focusable.indexOf(optionA)).toBeLessThan(focusable.indexOf(optionB));
    expect(focusable.indexOf(optionB)).toBeLessThan(focusable.indexOf(close));
    expect(focusable.indexOf(close)).toBeLessThan(focusable.indexOf(next));
  });
});

describe("RevealPanel Next landmark affordance (t4)", () => {
  // The full ordered POI set for the selector. POI orders 1, 2, 4 mirror the
  // openPlain / openHighlight / openGuess fixtures so every opened POI has a
  // concrete next-by-order target under the cyclic-successor rule.
  const SELECTOR_POIS = POIS;

  it("renders Next: <next-by-order title> for an unlocked plain reveal; activating it only closes", () => {
    const store = createDiscoveryStore(13);
    openPlain(store); // order 1, plain -> bodyUnlocked immediately
    render(<RevealPanel store={store} pois={SELECTOR_POIS} />);

    // The selector names the next-by-order undiscovered POI (cyclic successor):
    // current order 1, nothing else discovered -> order 2.
    const expected = nextUndiscovered(
      SELECTOR_POIS,
      store.getSnapshot().discoveredIds,
      "poi-arrivals-gate",
      1,
    );
    expect(expected).toEqual({
      id: "poi-end-state-overlook",
      order: 2,
      title: "The One-Sentence Overlook",
    });

    // The only assertable "steer": a native button whose text contains that
    // POI's title.
    const next = screen.getByRole("button", { name: /^Next:/ });
    expect(next.tagName).toBe("BUTTON");
    expect(next.getAttribute("type")).toBe("button");
    expect(next.textContent).toContain(expected!.title);

    // Activating Next calls store.closePoi() and nothing else: the panel closes,
    // the discovered set is untouched, and no body is revealed.
    const discoveredBefore = store.getSnapshot().discoveredIds;
    act(() => {
      next.click();
    });
    expect(store.getSnapshot().open).toBeNull();
    expect(store.getSnapshot().discoveredIds).toBe(discoveredBefore);
  });

  it("seats Next and Drive on together in the .reveal-panel__actions footer, both as .cta", () => {
    // T5 footer structure (token-driven sizing/focus ring is asserted by the CSS
    // tokens, not the DOM): both controls share the .cta recipe and live inside
    // one .reveal-panel__actions row so they read as the panel's trailing pair.
    const store = createDiscoveryStore(13);
    openPlain(store); // unlocked plain reveal -> Next present alongside Drive on
    render(<RevealPanel store={store} pois={SELECTOR_POIS} />);

    const driveOn = screen.getByRole("button", { name: "Drive on" });
    const next = screen.getByRole("button", { name: /^Next:/ });

    // Both carry the shared CTA token class (>=44px hit target + focus ring).
    expect(driveOn.classList.contains("cta")).toBe(true);
    expect(next.classList.contains("cta")).toBe(true);

    // Both sit inside the same .reveal-panel__actions footer element.
    const footer = driveOn.closest(".reveal-panel__actions");
    expect(footer).not.toBeNull();
    expect(footer!.contains(next)).toBe(true);
    expect(next.closest(".reveal-panel__actions")).toBe(footer);
  });

  it("renders Next on a committed guess (body unlocked) and is absent before the pick", () => {
    const store = createDiscoveryStore(13);
    openGuess(store); // order 4, guess -> locked until a pick
    render(<RevealPanel store={store} pois={SELECTOR_POIS} />);

    // Unanswered guess: bodyUnlocked false -> Next not rendered.
    expect(screen.queryByRole("button", { name: /^Next:/ })).toBeNull();

    act(() => {
      screen.getByRole("button", { name: GUESS.options[0].text }).click();
    });

    // Post-pick: bodyUnlocked true, selector for order 4 (highest open) wraps to
    // the lowest-order remaining (order 1).
    const expected = nextUndiscovered(
      SELECTOR_POIS,
      store.getSnapshot().discoveredIds,
      "poi-staff-engineer-gate",
      4,
    );
    expect(expected).toEqual({
      id: "poi-arrivals-gate",
      order: 1,
      title: "The Arrivals Gate",
    });
    const next = screen.getByRole("button", { name: /^Next:/ });
    expect(next.textContent).toContain(expected!.title);
  });

  it("hides Next on the last undiscovered landmark — only Drive on remains", () => {
    const store = createDiscoveryStore(13);
    // Only ONE POI exists in the candidate set, and it is the open one: the
    // selector returns null, so Next is absent and Drive on is the lone CTA.
    const lone = [{ id: "poi-arrivals-gate", order: 1, title: "The Arrivals Gate" }];
    openPlain(store);
    render(<RevealPanel store={store} pois={lone} />);

    expect(
      nextUndiscovered(lone, store.getSnapshot().discoveredIds, "poi-arrivals-gate", 1),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /^Next:/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Drive on" })).toBeTruthy();
  });

  it("hides Next for an unanswered guess for BOTH reasons: last-only, and not-last", () => {
    // Unanswered guess that is also the last undiscovered: Next absent because
    // the body is locked AND because the selector returns null.
    const lastStore = createDiscoveryStore(13);
    const loneGuess = [{ id: "poi-staff-engineer-gate", order: 4, title: "The Staff-Engineer Gate" }];
    openGuess(lastStore);
    const lastRender = render(<RevealPanel store={lastStore} pois={loneGuess} />);
    expect(lastStore.getSnapshot().open?.bodyUnlocked).toBe(false);
    expect(
      nextUndiscovered(loneGuess, lastStore.getSnapshot().discoveredIds, "poi-staff-engineer-gate", 4),
    ).toBeNull();
    expect(lastRender.queryByRole("button", { name: /^Next:/ })).toBeNull();
    lastRender.unmount();

    // Unanswered guess that is NOT last: a valid next exists, but Next is still
    // absent because the body is locked — forward-nav cannot bypass the unread
    // payload until a pick commits.
    const notLastStore = createDiscoveryStore(13);
    openGuess(notLastStore);
    const notLastRender = render(<RevealPanel store={notLastStore} pois={POIS} />);
    expect(notLastStore.getSnapshot().open?.bodyUnlocked).toBe(false);
    expect(
      nextUndiscovered(POIS, notLastStore.getSnapshot().discoveredIds, "poi-staff-engineer-gate", 4),
    ).not.toBeNull();
    expect(notLastRender.queryByRole("button", { name: /^Next:/ })).toBeNull();
  });
});
