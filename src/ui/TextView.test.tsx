import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TextView } from "./TextView.tsx";
import { loadContent } from "../content/contentModel.ts";

describe("TextView", () => {
  it("renders every landmark's title and full body in order", () => {
    render(<TextView onBack={() => {}} />);
    const { pois } = loadContent();
    expect(pois).toHaveLength(6);

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

  it("renders each authored teaser as a lede preceding the body", () => {
    render(<TextView onBack={() => {}} />);
    const { pois } = loadContent();
    const articles = screen.getAllByRole("article");
    const ordered = [...pois].sort((a, b) => a.order - b.order);

    // Sanity: the claim below must not pass vacuously.
    expect(ordered.filter((p) => p.teaser !== "").length).toBeGreaterThan(0);

    ordered.forEach((poi, i) => {
      if (poi.teaser === "") return; // the lede is conditional on an authored teaser
      // Scope every query to the article — the page header's .text-view__lede
      // is a collision hazard; never query lede classes globally.
      const article = articles[i];
      const teaser = article.querySelector("p.text-view__lede-teaser");
      expect(teaser).not.toBeNull();
      expect(teaser!.textContent).toBe(poi.teaser);

      // "Between the h2 and the body" is an ORDER claim, not just presence:
      // the teaser must PRECEDE the body paragraph in document order.
      const body = article.querySelector(".text-view__body")!;
      expect(
        teaser!.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });
  });

  it("has a single top-level page heading", () => {
    render(<TextView onBack={() => {}} />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("renders no emphasis marks and no takeaway callouts (the clue chain is plain pages)", () => {
    render(<TextView onBack={() => {}} />);
    for (const article of screen.getAllByRole("article")) {
      expect(article.querySelectorAll("mark.text-view__emphasis")).toHaveLength(0);
      expect(within(article).queryByRole("note")).toBeNull();
    }
  });

  it("renders teaser + body only for a plain clue (site-base-camp)", () => {
    const poi = loadContent().pois.find((p) => p.id === "site-base-camp")!;
    // Fixture-drift guard: the graceful default is only exercised by a plain
    // POI. If arrivals-gate ever gains a highlight or a guess reveal, pick a
    // new plain fixture rather than weakening the negatives below.
    if (poi.interaction.type !== "plain") {
      throw new Error("fixture drift: site-base-camp is no longer a plain POI");
    }

    render(<TextView onBack={() => {}} />);
    const article = screen
      .getAllByRole("article")
      .find((a) => a.getAttribute("aria-labelledby") === `tv-${poi.id}`)!;
    expect(article).toBeDefined();

    // The graceful default falls out structurally: teaser + body render…
    expect(article.querySelector("p.text-view__lede-teaser")!.textContent).toBe(poi.teaser);
    expect(article.querySelector(".text-view__body")!.textContent).toBe(poi.body);

    // …and nothing else does — no emphasis mark, no takeaway note. queryBy
    // negatives, scoped to the article (other articles legitimately carry
    // marks and notes, so a global query would be wrong here).
    expect(article.querySelector("mark")).toBeNull();
    expect(within(article).queryByRole("note")).toBeNull();
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

describe("TextView styling (src/tokens.css)", () => {
  // jsdom cannot compute CSS, so these checks are STATIC: read the shipped
  // stylesheet and pin its structure. Visual verification (mark contrast on
  // the dark theme, lede hierarchy) is explicitly deferred to the UX review
  // gate of the running build.
  const css = readFileSync(resolve(process.cwd(), "src/tokens.css"), "utf8");
  // The .text-view block runs from its section banner to the next section.
  const block = css.slice(
    css.indexOf("/* ----- Text-based / fallback content view"),
    css.indexOf("@keyframes overlay-rise"),
  );
  // Strip comments before collecting selectors — prose mentions of class
  // names (e.g. the scroll-padding note naming .text-view__footer) must not
  // count as rules.
  const stripped = block.replace(/\/\*[\s\S]*?\*\//g, "");

  it("extends the .text-view block with exactly the three new rules — lede-teaser, emphasis, callout", () => {
    expect(block.length).toBeGreaterThan(0);

    const names = new Set(
      [...stripped.matchAll(/\.text-view__([a-z-]+)/g)].map((m) => m[1]),
    );
    // The pre-existing eleven selectors plus EXACTLY the three this slice
    // introduces — an honest rule count: no fourth rule sneaks in, none of
    // the three lands outside the block.
    expect([...names].sort()).toEqual(
      [
        "back",
        "body",
        "callout",
        "emphasis",
        "entry",
        "entry-title",
        "eyebrow",
        "footer",
        "header",
        "lede",
        "lede-teaser",
        "tag",
        "tags",
        "title",
      ].sort(),
    );

    // The callout's <strong> label uses semantic bold defaults — a descendant
    // selector would be a fourth rule by honest count.
    expect(css).not.toMatch(/\.text-view__callout\s+strong/);
  });

  it(".text-view__emphasis overrides BOTH UA <mark> paints from tokens and shifts weight (WCAG 1.4.1)", () => {
    const rule = /\.text-view__emphasis\s*\{([^}]*)\}/.exec(stripped);
    expect(rule).not.toBeNull();
    const body = rule![1];
    // The UA default for <mark> is yellow-on-black — a dark-theme contrast
    // regression unless BOTH paint properties are re-declared from tokens.
    expect(body).toMatch(/background(?:-color)?:\s*var\(--/);
    expect(body).toMatch(/(?:^|[\s;{])color:\s*var\(--/);
    // …and the distinction must not be color-alone.
    expect(body).toMatch(/font-weight:/);
  });

  it(".text-view__lede-teaser reads as a deck, .text-view__callout as a bordered note", () => {
    const teaser = /\.text-view__lede-teaser\s*\{([^}]*)\}/.exec(stripped);
    expect(teaser).not.toBeNull();
    // If the deck treatment dims the teaser, it must hold ≥ 0.85 so --color-fg
    // on --color-bg (16.9:1) stays comfortably past 4.5:1.
    const opacity = /opacity:\s*([\d.]+)/.exec(teaser![1]);
    if (opacity) expect(parseFloat(opacity[1])).toBeGreaterThanOrEqual(0.85);

    const callout = /\.text-view__callout\s*\{([^}]*)\}/.exec(stripped);
    expect(callout).not.toBeNull();
    expect(callout![1]).toMatch(/border/);
  });
});

/** Escape a string for use inside a RegExp (titles contain no specials today,
 *  but this keeps the matcher robust to copy edits). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
