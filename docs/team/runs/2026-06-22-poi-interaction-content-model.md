# Run: M2 — Interactive Reveal, Slice 1 (content-model interaction field)

Date: 2026-06-22

## Feature

M2 — Make the Reveal Interactive, Not a Wall of Text (slice 1: extend the content
model with an optional `interaction` field). Schema + loader only — no React, no
rendering, no content rewrite. Smallest dependency-free step that unblocks the rest
of M2 by making "guess then reveal" expressible.

## Acceptance Criteria

1. `PoiContent` gains an OPTIONAL `interaction` field typed as a discriminated union
   on `type` with variants `plain` (current behavior), `guess` (prompt + 2-3 options),
   and `highlight` (an emphasized takeaway); `loadContent()` returns it always-populated.
2. `loadContent()` defaults a missing interaction to `{ type: 'plain' }` and coerces any
   unknown/malformed type (including non-object inputs) to `plain` WITHOUT throwing on
   currently-valid content; a present-but-invalid interaction emits a dev-time
   `console.warn`.
3. A unit test asserts `content/working-with-claude.json` loads unchanged: 13 POIs, same
   ids/order/teasers/bodies/titles, every POI resolving to `interaction.type === 'plain'`
   (no content edits in this slice).
4. Unit tests cover each variant via the exported pure `parseInteraction`: valid guess at
   the inclusive bounds (exactly 2 and exactly 3 options) parses; guess with 0/1/4 options,
   missing/empty prompt, empty option text, or zero/multiple correct flags coerces to plain;
   valid highlight parses; empty/missing emphasis, unknown type (`quiz`), and non-object
   (null/array/string/number) all coerce to plain.
5. All new logic is pure and unit-tested headless (no WebGL, React, or DOM); `npm test` is
   green and `npm run build` typechecks; the default `{ type: 'plain' }` literal is assignable
   without a cast and the union narrows for downstream consumers.
6. No changes to `RevealPanel`, stores, nav, audio/VFX, `src/engine/`, or any rendered output;
   the diff is confined to `src/content/contentModel.ts` and `src/content/content.test.ts`.

## Roundtable Positions

- **Product Owner** — Ship slice 1 exactly as scoped: optional `interaction` union defaulting
  to `plain`, headless-tested, no content rewrite. Cap at flavor-only options (no scoring) and
  pin the "0 or >3 options" rule to a single documented decision. Objected to throwing on a bad
  OPTIONAL field — degrade to plain instead. Confidence: high.
- **Tech Lead** — Approve as a pure schema-only extension. Hold the union exhaustive (`never`
  default), normalize at the loader boundary so `interaction` is non-optional after load, and
  reserve throws for required identity/text fields. Initially argued throw-on-malformed for
  internal consistency. Rejected: zod, free-form `any`, optional-after-load, inline union, JSON
  edits. Confidence: high.
- **Frontend Engineer** — Default-on-read so consumers never branch on `undefined`; export the
  type + a pure `parseInteraction`. Proposed `answerIndex`. Hard objections: no required field /
  no JSON rewrite, no throw on malformed optional, no `interaction?` leaking to consumers, no
  inline union. Confidence: high (one open question: does guess carry a correct answer).
- **Backend Engineer** — Normalize in `loadContent()` to a non-nullable union; pure
  `normalizeInteraction` helper, no parallel parser. Proposed `answerIndex`. Hard objections:
  no truncating over-length options (could drop the correct answer), no optional-after-load, no
  throw on unknown type. Confidence: high.
- **3D Graphics Engineer** — Endorse; zero GPU/draw-call/byte cost, entirely off the engine seam.
  Standing condition only on LATER slices: any in-canvas reveal effect must be sized against the
  perf budget. No hard objection. Confidence: high.
- **Quality Engineer** — Support, but pin the validation contract: `interaction` follows the
  optional/coerce path (never throw), single uniform coerce-to-plain rule documented in a comment.
  HARD: validation must be a separately exported PURE function (the loader reads a static JSON
  import, so per-variant tests are otherwise untestable without editing the forbidden file). HARD:
  coerce-to-plain, never throw. Test boundaries at the inclusive edges (2 and 3 valid; 1 and 4
  invalid). Confidence: high.
- **UI/UX Designer** — Specify the schema from the user-experience end. `guess` must carry a
  post-commit `answerReveal` line (the reward is the explanation, not the verdict) and the answer
  as a per-option `correct: boolean` (survives shuffling, maps to a11y controls, no off-by-one).
  `highlight.emphasis` separate from body so the Epic-6 text fallback reads it. HARD objections:
  no `answerIndex`, no throw on malformed optional, no guess without a reveal line. SOFT: no
  scoring field. Confidence: high.

## Consensus Design

Extend `src/content/contentModel.ts` with an OPTIONAL `interaction` discriminated union
(`plain | guess | highlight`), normalized once in `loadContent()` so every POI resolves to a
concrete, non-nullable variant. Pure, headless schema + validation only.

Decisions:
- Exported discriminated union `PoiInteraction` keyed on literal `type`:
  `{ type: 'plain' }` | `{ type: 'guess'; prompt: string; options: GuessOption[]; answerReveal?: string }`
  | `{ type: 'highlight'; emphasis: string }`, where `GuessOption = { text: string; correct: boolean }`.
- `interaction?` OPTIONAL on raw input; `PoiContent.interaction` REQUIRED and always-populated after
  load. Normalize at the loader boundary; consumers do one exhaustive switch, never guard undefined.
- FAILURE MODE = COERCE-TO-PLAIN, never throw. Missing → `plain` (silent). Present-but-invalid
  (unknown type, non-object, structurally invalid variant) → `plain` with a dev-time `console.warn`.
  Throw path stays reserved for missing required id/title/teaser/body.
- GUESS validation: non-empty prompt; 2-3 options (documented `GUESS_MIN/MAX_OPTIONS` constants) each
  with non-empty `text` and boolean `correct`; EXACTLY ONE `correct: true`. Any violation coerces the
  WHOLE interaction to plain — no partial repair or truncation. `answerReveal` optional.
- Answer carried as per-option `correct: boolean`, NOT a numeric `answerIndex` (UX objection sustained
  over the engineers' proposal).
- `answerReveal?` on guess and `emphasis` (separate from body) on highlight — the only fields beyond
  the literal AC, locked now to avoid a content migration later.
- Validation in an EXPORTED PURE `parseInteraction(raw: unknown): PoiInteraction`, called from the
  existing per-POI `.map`. No new files, no schema library.
- Union exhaustive via a switch with a `never` default to force the validator updated on future variants.
- Strengthen the existing "loads 13 POIs" test in place to also assert every POI resolves to `plain`.

Rejected alternatives: throw on malformed/unknown interaction; numeric `answerIndex`; poll-only guess
with no correctness; `interaction?` optional after load; truncating over-length options; free-form
`Record`/`any` or a zod dependency; inline union in the loader; editing the JSON or adding scoring,
timers, multi-step, weights, or asset-referencing variants.

## Critique History

No material flaw (`materialFlaw: false`). I attempted to refute the design against the codebase;
assumptions held (PoiContent/loadContent match, the 13-POI dataset carries no `interaction`, the
loader already drops non-modeled JSON fields like `worldZoneHint`). Issues raised:

1. NEEDS VERIFICATION (implementation detail, not a blocker): the `never`-default exhaustiveness guard
   cannot narrow `raw.type` on an `unknown` input — TS won't drive a `never` default off the raw value.
   The implementer must run the `never` check over an already-validated tag, not the raw input, or the
   guard is decorative. Fixable without changing the design's shape.
2. MINOR: the real downstream consumer `DiscoverablePoi` (src/content/discoverablePois.ts) does NOT
   carry `interaction`; the "contract every consumer switches on" framing is overstated — a later slice
   must thread `interaction` through `buildDiscoverablePois`. Does not violate this slice's narrowed AC.
3. NOTE (verified): baseline `content.test.ts` green (5 tests); coerce-to-plain + exactly-one-correct
   cover every enumerated edge case.

No revision required — issues are surmountable within the design's shape.

## Task Plan

- **T1** (backend, deps: none) — Add `PoiInteraction` union + `GuessOption` + `GUESS_MIN/MAX_OPTIONS`
  constants; type raw `interaction?` and the returned `PoiContent.interaction` as required non-nullable.
  First test: type-level assertion that `{ type: 'plain' }` is assignable without a cast and the switch
  narrows each variant.
- **T2** (backend, deps: T1) — Implement exported pure `parseInteraction(raw): PoiInteraction`: coerce-to-
  plain for missing/non-object/unknown-type, validate guess and highlight, `never` default in the switch,
  dev-time `console.warn` on coercion of a present-but-invalid interaction. First test: full variant matrix
  incl. inclusive bounds, every invalid path with warn-count assertions, silent-undefined.
- **T3** (backend, deps: T2) — Wire `parseInteraction` into the per-POI `.map` in `loadContent()`. First
  test: strengthen the "loads 13 POIs" test to assert every POI resolves to `interaction.type === 'plain'`
  and ids/order/teasers/bodies/titles unchanged.
- **T4** (quality, deps: T3) — Verify: `npm test` green, `npm run build` typechecks, `git diff --name-only
  main` confined to the two permitted files, content JSON untouched.

## Implementation Summary

- **T1** (backend) — Added the `PoiInteraction` union, `GuessOption`, and `GUESS_MIN/MAX_OPTIONS` bounds to
  `src/content/contentModel.ts`; raw input `interaction?: unknown`, `PoiContent.interaction` required and
  defaulted to `{ type: 'plain' }`. Type-level + exhaustive-switch test added. 13-POI dataset loads
  unchanged; build typechecks; 209 tests pass. Commit `7461f04`.
- **T2** (backend) — Implemented exported pure `parseInteraction(raw: unknown): PoiInteraction` and wired it
  into `loadContent()`. Single coerce-to-plain rule: `undefined` → plain silently; present-but-invalid →
  plain with `console.warn`, never a throw. Guess requires non-empty prompt, 2-3 options each with non-empty
  `text` + boolean `correct`, exactly one `correct`, preserves optional `answerReveal`; highlight requires
  non-empty `emphasis`. `never` default in the switch. 23 new test cases. Suite green (232); build
  typechecks. Commit `6fb54ef`.
- **T3** (backend) — Already covered by commit `6fb54ef`: `parseInteraction` wired into the per-POI `.map`
  (contentModel.ts:186), throw path reserved for missing id/title/teaser/body (171-174), "loads 13 validated
  POIs" test asserts 13 POIs all resolving to `plain` (content.test.ts:162-174). No code change needed.
- **T4** (quality) — Verification complete; all gates green (see below).

## Verification Result

- `npm test`: PASS — 43 files, 232 tests, 0 failures.
- `npm run build` (tsc --noEmit + vite build): PASS — typechecks clean; `{ type: 'plain' }` assignable
  without a cast, union narrows exhaustively (`never` default compiled).
- `npm run lint` (eslint .): PASS — no errors (CI gate).
- Diff confinement: PASS — `git diff --name-only main` returns exactly `src/content/contentModel.ts` and
  `src/content/content.test.ts`.
- No forbidden changes: PASS — no RevealPanel/stores/nav/audio/vfx/engine/content-file edits;
  `content/working-with-claude.json` untouched (0 lines diff).
- Loader output for the 13 POIs unchanged: PASS.
- AC coverage confirmed in tests: valid guess at 2 and 3 options; guess 0/1/4 options, missing/empty prompt,
  empty option text, zero/multiple correct → plain+warn; valid highlight; empty/missing emphasis, unknown
  `'quiz'`, null/array/string/number → plain+warn; absent → plain silently with no warn.

Gates: testsPass true, reviewPass true, uxPass true, gatesGreen true. No material flaw, no failures.

## Ship

- Branch: `feat/poi-interaction-union`
- PR: https://github.com/NikolajMosbaek/AboutMeGame/pull/83
- Merged: yes
