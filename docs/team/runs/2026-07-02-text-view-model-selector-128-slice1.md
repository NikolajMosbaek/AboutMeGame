# Run log — Text-view selector seam (epic #128, slice 1)

Date: 2026-07-02
Branch: `feat/text-view-model-splitter`
Epic: #128 (text view as a first-class readable surface). Immediate consumer:
**#144** (TextView rendering), next in board order — see "Accepted dead-code
window" below.

Feature: one new pure, React-free module `src/ui/textViewModel.ts` exporting
`splitBodySegments(body, emphasis?)` and `buildTextViewModel(content:
ContentSet)` plus the `BodySegment` / `TextViewRow` types, with its headless
suite `src/ui/textViewModel.test.ts` — and nothing else in the diff
(`git diff main --stat`: exactly those two new files, 500 insertions,
0 deletions; `content/working-with-claude.json`, `src/ui/TextView.tsx`,
`src/ui/RevealPanel.tsx`, `src/content/contentModel.ts`, and `.claude/`
untouched).

## Decisions recorded for this run

### answerReveal rule corrected from the AC's literal wording

The epic's AC exemplified answerReveal with a single POI and said "every other
POI" lacks it. That literal wording is **false against the real dataset**: the
content has **two** guess POIs that carry `answerReveal` —
`poi-staff-engineer-gate` and `poi-force-push-dam` (verified in
`content/working-with-claude.json`). The shipped rule is therefore the general
one, not the exemplar: **a row carries `answerReveal` iff the source `guess`
interaction carries it**, with the key built conditionally so it is genuinely
absent otherwise (never an explicit `answerReveal: undefined`). The test suite
encodes the rule — "carries answerReveal on BOTH real guess POIs and on no
other row" — plus a synthetic-fixture case for a guess POI without one.

### Guess prompt/options deliberately do NOT cross into the text view

The text view is a **readable document, not a playable quiz**. The guess
interaction's prompt and options stay out of `TextViewRow` by design; only the
`answerReveal` takeaway crosses over, because it is the piece of content a
reader would otherwise never see. If product later wants the prompt as flavour
text, adding an optional field is non-breaking — omission now costs nothing.
#144 must not infer interaction type from `answerReveal` presence.

### Silent-surface rule

TextView is and remains a **silent surface**: no audio-cue fields on rows,
ever, and no `AudioContext` in #144's rendering. The module imports only types
from `src/content/contentModel.ts` — nothing from `src/engine/`, `src/world/`,
`src/perf/`, or `src/audio/` — so the rule is structural, not aspirational.

### Accepted dead-code window (epic #128 → #144)

The selector ships with **zero production callers this run, knowingly**: its
tests are its only consumers. This is the deliberate seam-first slicing of
epic #128 — the splitter is exported separately so #144's TextView rendering
and, later, RevealPanel consume ONE segmentation implementation, keeping the
3D reveal path and the no-WebGL text view from drifting on what is emphasized.
The window is defended against the constitution's uncalled-code deletion rule
by linkage, not hope: the PR body links epic #128 and names **#144 as the
immediate consumer**, and #144 stays next in board order so the seam is
consumed in the very next run. #144 must also **delete `TextView.tsx`'s
now-redundant local sort at line 25** (`[...loadContent().pois].sort((a, b) =>
a.order - b.order)`) so narrative order has one source of truth —
`buildTextViewModel`'s copy-then-sort.

### Other pinned semantics (for #144's reference)

- Splitting is byte-for-byte `body.indexOf(emphasis)`, FIRST occurrence only,
  zero-length segments dropped; no trimming, case folding, or Unicode
  normalization — verbatim or fallback, full stop.
- Lossless invariant held by construction and asserted across every test:
  `segments.map(s => s.text).join("") === body`, at most one emphasized
  segment.
- Non-empty emphasis not found verbatim → single unemphasized full-body
  segment WITH a dev-time `console.warn` (mirroring `parseInteraction`'s
  coerce-and-warn convention); `undefined`/empty-string emphasis → same
  fallback, silently (caller-contract edge, not authoring drift).
- A content-drift canary asserts every authored highlight emphasis is a
  verbatim substring of its body, so a future copy edit fails CI instead of
  silently un-emphasizing.
- `buildTextViewModel` never mutates the injected `ContentSet`; equal orders
  keep authored relative order (ES2019+ sort stability, pinned by a tie test);
  the interaction switch is exhaustive with a never-default.

## Verification (T5) — output cited verbatim

Run on the branch head after all implementation commits (the T5 state;
re-executed to capture output).

`npm test` — full suite, green:

```
 Test Files  101 passed (101)
      Tests  964 passed | 1 skipped (965)
   Start at  06:09:55
   Duration  8.84s (transform 1.50s, setup 9.88s, collect 6.68s, tests 8.88s, environment 54.37s, prepare 7.53s)
```

The new suite in isolation (`npx vitest run src/ui/textViewModel.test.ts`):

```
 ✓ src/ui/textViewModel.test.ts (20 tests) 5ms

 Test Files  1 passed (1)
      Tests  20 passed (20)
```

`npm run build` — typecheck + production bundle, green:

```
vite v5.4.21 building for production...
transforming...
✓ 115 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                   2.95 kB │ gzip:   1.17 kB
dist/assets/index-D7XGQATN.css   17.63 kB │ gzip:   3.76 kB
dist/assets/index-DJrGyfQB.js   231.73 kB │ gzip:  76.65 kB
dist/assets/three-COLka6mN.js   500.28 kB │ gzip: 125.83 kB
✓ built in 646ms
```

(The >500 kB chunk advisory on `three-COLka6mN.js` is Vite's standing warning
about the pre-existing Three.js vendor chunk — unchanged by this diff, which
adds no rendering code.)
