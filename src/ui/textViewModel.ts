// Text-view selector seam (epic #128, slice 1; consumed by #144's TextView
// rendering and, later, RevealPanel).
//
// Pure presentation shaping: plain data in, plain data out. No I/O, no
// globals, no React/DOM types — the caller injects `loadContent()`'s
// `ContentSet`. `splitBodySegments` is exported on its own so every surface
// that emphasizes body text uses ONE segmentation implementation, keeping the
// 3D reveal path and the no-WebGL text view from drifting apart.

import type { ContentSet, PoiContent } from "../content/contentModel.ts";

/** One run of body text; `emphasized` marks the highlight span, if any. */
export interface BodySegment {
  text: string;
  emphasized: boolean;
}

/** One POI as the text view renders it, in narrative order. `answerReveal`
 *  is present iff the source `guess` interaction carries it — the only piece
 *  of the quiz that crosses into the readable document. */
export interface TextViewRow {
  id: string;
  order: number;
  title: string;
  teaser: string;
  tags: string[];
  bodySegments: BodySegment[];
  answerReveal?: string;
}

/** The lossless fallback: the whole body, unemphasized. Body text is never
 *  lost — `segments.map(s => s.text).join("") === body` holds on every path. */
function unemphasized(body: string): BodySegment[] {
  return [{ text: body, emphasized: false }];
}

/**
 * Split `body` around the FIRST byte-for-byte occurrence of `emphasis`,
 * emitting before/emphasis/after with zero-length segments dropped — so
 * emphasis at the body's start or end yields 2 segments, and
 * `emphasis === body` yields 1 fully-emphasized segment. At most one segment
 * is emphasized. No trimming, case folding, or Unicode normalization:
 * verbatim match or fallback, full stop.
 *
 * Fallbacks (body text is never lost):
 * - Non-empty `emphasis` not found verbatim → one unemphasized full-body
 *   segment WITH a dev-time `console.warn`, mirroring `parseInteraction`'s
 *   coerce-and-warn convention — authoring drift stays visible, never fatal.
 * - `undefined` or empty-string `emphasis` → the same fallback, SILENTLY:
 *   a caller-contract edge unreachable from `loadContent`, not authoring
 *   drift ('' would make `indexOf` return 0 and emit a degenerate empty
 *   emphasized segment).
 */
export function splitBodySegments(body: string, emphasis?: string): BodySegment[] {
  if (emphasis === undefined || emphasis === "") return unemphasized(body);

  const start = body.indexOf(emphasis);
  if (start === -1) {
    console.warn(
      "content: highlight emphasis not found verbatim in body; rendering unemphasized",
    );
    return unemphasized(body);
  }

  const segments: BodySegment[] = [];
  const before = body.slice(0, start);
  const after = body.slice(start + emphasis.length);
  if (before.length > 0) segments.push({ text: before, emphasized: false });
  segments.push({ text: emphasis, emphasized: true });
  if (after.length > 0) segments.push({ text: after, emphasized: false });
  return segments;
}

/** The interaction-dependent slice of a row: how the body segments, and
 *  whether the guess takeaway crosses over. One exhaustive switch with the
 *  never-default discipline from `parseInteraction`, so a future fourth
 *  variant fails typecheck here too. `answerReveal` is built conditionally —
 *  the key is genuinely absent unless the guess interaction carries it, never
 *  an explicit `undefined`. The guess prompt/options deliberately do NOT
 *  cross: the text view is a readable document, not a playable quiz. */
function interactionFields(poi: PoiContent): Pick<TextViewRow, "bodySegments" | "answerReveal"> {
  const { interaction } = poi;
  switch (interaction.type) {
    case "plain":
      return { bodySegments: splitBodySegments(poi.body) };

    case "guess":
      return interaction.answerReveal === undefined
        ? { bodySegments: splitBodySegments(poi.body) }
        : {
            bodySegments: splitBodySegments(poi.body),
            answerReveal: interaction.answerReveal,
          };

    case "highlight":
      return { bodySegments: splitBodySegments(poi.body, interaction.emphasis) };

    default: {
      // Compile-time exhaustiveness: adding a variant to `PoiInteraction`
      // without an arm here fails to typecheck. Unreachable at runtime —
      // `loadContent` only produces the variants above.
      const _exhaustive: never = interaction;
      void _exhaustive;
      throw new Error("content: unknown interaction type");
    }
  }
}

/**
 * Shape an injected `ContentSet` into text-view rows, one per POI, sorted
 * ascending by narrative `order` (copy-then-sort — the input is never
 * mutated; equal orders keep their authored relative order via ES2019+ sort
 * stability).
 */
export function buildTextViewModel(content: ContentSet): TextViewRow[] {
  return [...content.pois]
    .sort((a, b) => a.order - b.order)
    .map((poi) => ({
      id: poi.id,
      order: poi.order,
      title: poi.title,
      teaser: poi.teaser,
      tags: poi.tags,
      ...interactionFields(poi),
    }));
}
