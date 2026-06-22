import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
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

describe("RevealPanel styling hooks (t3)", () => {
  it("marks the committed guess option with the reveal-panel__option--chosen class", () => {
    const store = createDiscoveryStore(13);
    act(() => {
      store.openPoi({
        id: "poi-staff-engineer-gate",
        order: 4,
        title: "The Staff-Engineer Gate",
        body: "No work clears this gate on my word.",
        interaction: GUESS,
      });
    });
    render(<RevealPanel store={store} />);

    const option = screen.getByRole("button", {
      name: "Citing the actual build or test output",
    });
    act(() => {
      option.click();
    });

    const chosen = screen.getByRole("button", {
      name: "Citing the actual build or test output",
    });
    expect(chosen.className).toContain("reveal-panel__option--chosen");
  });

  it("renders a highlight emphasis node carrying the reveal-panel__emphasis class", () => {
    const store = createDiscoveryStore(13);
    act(() => {
      store.openPoi({
        id: "poi-end-state-overlook",
        order: 2,
        title: "The One-Sentence Overlook",
        body: "Before I touch a single file.",
        interaction: HIGHLIGHT,
      });
    });
    render(<RevealPanel store={store} />);

    const emphasis = screen.getByText(HIGHLIGHT.emphasis);
    expect(emphasis.className).toContain("reveal-panel__emphasis");
  });
});
