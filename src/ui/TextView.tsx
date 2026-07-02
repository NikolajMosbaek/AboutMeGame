import { useEffect, useMemo, useRef } from "react";
import { loadContent } from "../content/contentModel.ts";
import { buildTextViewModel } from "./textViewModel.ts";
import { VISION } from "../version.ts";

export interface TextViewProps {
  /** Return to the title screen (App dispatches `exitToTitle`). */
  onBack: () => void;
}

/**
 * The no-WebGL fallback / accessibility view (#50). Renders all 13 landmarks as
 * a plain, readable document — the assistive path past the 3D world, and the
 * answer to "I can't or won't play." Each landmark is a semantic `<article>`
 * with its order, title and *full* body (the same content the reveal panel shows
 * in-game), plus its tags. Reuses the design tokens; no canvas, no engine, no
 * input — it just reads. Linked from the title screen, with a clear "Back".
 *
 * Presentational: it owns only the focus-on-mount affordance, so keyboard/AT
 * users land at the top of the new page. All ordering and body segmentation
 * comes from `buildTextViewModel` (src/ui/textViewModel.ts) — the single
 * mapping seam — so this component maps `TextViewRow[]`, never `PoiContent[]`.
 */
export function TextView({ onBack }: TextViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rows = useMemo(() => buildTextViewModel(loadContent()), []);

  // Move focus to the page heading on mount so AT users land at the top.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main className="text-view">
      <header className="text-view__header">
        <h1 ref={headingRef} tabIndex={-1} className="text-view__title">
          How I work with Claude
        </h1>
        <p className="text-view__lede">{VISION}</p>
        <button type="button" className="cta text-view__back" onClick={onBack}>
          ← Back to start
        </button>
      </header>

      {rows.map((row) => (
        <article key={row.id} className="text-view__entry" aria-labelledby={`tv-${row.id}`}>
          <p className="text-view__eyebrow">
            Landmark {row.order} of {rows.length}
          </p>
          <h2 id={`tv-${row.id}`} className="text-view__entry-title">
            {row.title}
          </h2>
          {/* Approach teaser as the article's lede — deliberately NOT part of
              aria-labelledby: the h2 alone stays the accessible name. */}
          {row.teaser !== "" && <p className="text-view__lede-teaser">{row.teaser}</p>}
          {/* ONE paragraph, children from a single JSX expression — no stray
              whitespace text nodes, so the paragraph's textContent stays
              byte-equal to the POI body (the selector's lossless invariant)
              and `white-space: pre-line` keeps working. Index keys are fine:
              the segment list is static per render. */}
          <p className="text-view__body">
            {row.bodySegments.map((segment, i) =>
              segment.emphasized ? (
                <mark key={i} className="text-view__emphasis">
                  {segment.text}
                </mark>
              ) : (
                segment.text
              ),
            )}
          </p>
          {/* The guess takeaway, data-driven: rendered iff the row carries an
              answerReveal. role="note" + the visible <strong> label (wired via
              a per-POI-unique id) announce it as labelled content, never a
              control — nothing focusable, no disclosure pattern. The label
              says "The takeaway", not "Answer": the quiz prompt never renders
              in this view, so an answer-labelled block would be an orphaned
              reference. */}
          {row.answerReveal !== undefined && (
            <p
              className="text-view__callout"
              role="note"
              aria-labelledby={`tv-${row.id}-reveal`}
            >
              <strong id={`tv-${row.id}-reveal`}>The takeaway:</strong> {row.answerReveal}
            </p>
          )}
          {row.tags.length > 0 && (
            <ul className="text-view__tags" aria-label="Tags">
              {row.tags.map((tag) => (
                <li key={tag} className="text-view__tag">
                  {tag}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}

      <footer className="text-view__footer">
        <button type="button" className="cta text-view__back" onClick={onBack}>
          ← Back to start
        </button>
      </footer>
    </main>
  );
}
