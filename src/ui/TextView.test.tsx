import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TextView } from "./TextView.tsx";
import { loadContent } from "../content/contentModel.ts";

describe("TextView", () => {
  it("renders every landmark's title and full body in order", () => {
    render(<TextView onBack={() => {}} />);
    const { pois } = loadContent();
    expect(pois).toHaveLength(13);

    // Articles, one per POI, in narrative order.
    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(pois.length);

    const ordered = [...pois].sort((a, b) => a.order - b.order);
    ordered.forEach((poi, i) => {
      const article = articles[i];
      // The title is a heading inside the article…
      expect(within(article).getByRole("heading", { name: new RegExp(escapeRe(poi.title)) })).toBeInTheDocument();
      // …and the body paragraph's text is byte-equal to poi.body — exact
      // equality, no normalizer, no substring. This ports the view-model's
      // lossless invariant (segments join back to the body, \n breaks intact)
      // into the DOM. If this ever fails, fix the selector
      // (src/ui/textViewModel.ts), not this assertion.
      expect(article.querySelector(".text-view__body")!.textContent).toBe(poi.body);
    });
  });

  it("has a single top-level page heading", () => {
    render(<TextView onBack={() => {}} />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("renders poi-end-state-overlook's authored emphasis as exactly one <mark> inside a byte-equal body", () => {
    const poi = loadContent().pois.find((p) => p.id === "poi-end-state-overlook")!;
    // Derive the emphasis structurally from the content — never hard-code
    // prose, so copy edits and the content canary fail in the same place.
    if (poi.interaction.type !== "highlight") {
      throw new Error("fixture drift: poi-end-state-overlook is no longer a highlight POI");
    }
    const emphasis = poi.interaction.emphasis;

    render(<TextView onBack={() => {}} />);
    const article = screen
      .getAllByRole("article")
      .find((a) => a.getAttribute("aria-labelledby") === `tv-${poi.id}`)!;
    expect(article).toBeDefined();

    // Query by element/class, NOT getByRole("mark") — ARIA 1.3 role support
    // is version-dependent in the pinned testing stack.
    const marks = within(article).getByText(emphasis, { selector: "mark" });
    const allMarks = article.querySelectorAll("mark.text-view__emphasis");
    expect(allMarks).toHaveLength(1);
    expect(allMarks[0]).toBe(marks);
    expect(allMarks[0].textContent).toBe(emphasis);

    // The mark lives inside the single body paragraph, whose textContent is
    // still byte-equal to poi.body — the selector's lossless invariant.
    const body = article.querySelector(".text-view__body")!;
    expect(allMarks[0].closest(".text-view__body")).toBe(body);
    expect(body.textContent).toBe(poi.body);
  });

  it("wires the Back control(s)", () => {
    const onBack = vi.fn();
    render(<TextView onBack={onBack} />);
    // A long read offers a Back control at the top and bottom; both call onBack.
    const backs = screen.getAllByRole("button", { name: /back/i });
    expect(backs.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(backs[0]);
    expect(onBack).toHaveBeenCalledOnce();
  });
});

/** Escape a string for use inside a RegExp (titles contain no specials today,
 *  but this keeps the matcher robust to copy edits). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
