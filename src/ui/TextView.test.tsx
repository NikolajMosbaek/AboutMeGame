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
