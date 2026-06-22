# Run: M2 Guess-then-Reveal

**Date:** 2026-06-22
**Type:** Feature slice (not bootstrap)
**PR:** [#84](https://github.com/NikolajMosbaek/AboutMeGame/pull/84) — merged

## Feature

M2 — Make the Reveal Interactive, Not a Wall of Text (top unfinished mechanics
item). Slice 1 (the content-model `interaction` field) already shipped, so this
run delivers the first **player-visible** increment: the smallest end-to-end
"guess then reveal" interaction. It threads the loader-resolved `PoiInteraction`
along the full data chain, branches `RevealPanel` on `interaction.type` so a
`guess` POI shows prompt + options first and reveals the body only after a pick
(plain POIs unchanged), and authors two real guess POIs with provenance.

Out of scope (deferred): scoring, free-text answers, the `highlight` UI variant,
in-panel "Next →" wayfinding (M2 slice 4), and cross-session per-guess persistence.

## Acceptance Criteria

1. `OpenInfo` (discoveryStore.ts) carries a non-nullable `interaction: PoiInteraction`;
   `DiscoverablePoi` (discoverablePois.ts) carries it too, populated from `c.interaction`
   in `buildDiscoverablePois`; `DiscoverySystem.ts:76` passes `nearest.interaction`;
   the 9 OpenInfo literals + the `DiscoveryBurstSystem` `openInfo` helper are updated to
   `interaction: { type: "plain" }`; existing tests stay green.
2. A unit test asserts interaction survives the `buildDiscoverablePois` join AND a headless
   `DiscoverySystem` test asserts interacting near an authored POI populates
   `snapshot.open.interaction` with type `guess`.
3. For a guess POI the panel first shows prompt + 2-3 options and does NOT show body;
   selecting any option reveals body + optional `answerReveal`; chosen option marked
   selected, correct option marked correct, with neutral copy (no score, no red WRONG).
4. For a plain POI (default for every un-authored POI) the panel behaves exactly as today —
   body shown immediately, no options — verified by an unchanged-render test; no content
   rewrite forced.
5. Stale-state coverage: open guess A, answer, close, open a DIFFERENT guess B → B shows
   the prompt (not body); a re-render carrying the SAME `snap.open.id` keeps
   `revealed === true`. No test asserts an impossible per-frame reset.
6. Guess UI is keyboard- and SR-accessible: options are focusable native `<button>`s in a
   group labelled by the prompt; initial focus on the first option in the guess phase, moving
   to "Drive on" on reveal; the reveal is announced once via the panel's OWN polite
   `aria-live` region; Escape and backdrop-click still close from either phase.
7. At least two existing POIs in `content/working-with-claude.json`
   (`poi-force-push-dam`, `poi-staff-engineer-gate`) authored with a real guess interaction
   (2-3 options, exactly one correct, optional `answerReveal`) + matching PROVENANCE rows
   tracing to high-confidence sources; the other 11 stay plain; `loadContent()` loads clean.
8. A content test positively asserts the two authored POIs resolve to `interaction.type === 'guess'`
   with exactly one correct option (guarding parseInteraction's silent coerce-to-plain).
9. The reveal-decision logic is a pure helper unit-tested headless; the full `npm test` suite
   is green and `npm run build` typechecks.
10. A short manual/build verification confirms a guess POI shows prompt-then-reveal and a plain
    POI is unchanged in the running build. (Logged: a guess POI is marked discovered on OPEN,
    before any pick — consistent with today's proximity/interact discovery — and re-opening
    shows the unanswered prompt with no memory; acceptable, not a bug; M1's "discovered" must
    not be read as "read".)

## Roundtable Positions

- **Product Owner** — Ship the smallest end-to-end "guess then reveal" so one varied
  interaction is real and visible. Bundle M2 slices 2 (carry interaction into `OpenInfo`),
  3 (accessible guess UI), and 5-partial (author 2 guess POIs) into one increment, because
  none delivers value alone. IN: data chain, guess gate, plain unchanged, a11y, 2 authored
  POIs, headless tests. OUT: "Next →" wayfinding, highlight authoring, free-text/scoring/
  persistence. Confidence: high.
- **Tech Lead** — Thread the already-typed `PoiInteraction` end-to-end; add a small guess-gate
  before today's body render. Reveal-gate state is panel `useState`, NOT the store. One
  `RevealPanel` branching on `interaction.type`. Rejected: guess state in the store; re-parsing
  in the panel; a separate `GuessPanel`/boolean fork; per-option scoring. Confidence: high.
- **Senior Frontend** — Wire interaction through the seam; render guess flow as local panel
  state keyed to `snap.open.id`. Real focusable buttons. Author `poi-force-push-dam`,
  `poi-staff-engineer-gate`. Objects to store state, mode-boolean forks, content-before-tests,
  faux-button divs. Confidence: high.
- **Senior Backend** — Five edges: data into snapshot, session state in React (not store),
  render branch, a11y via existing polite pattern, content. HARD: no transient state in the
  snapshot; content test must positively assert `type === 'guess'`; verify `DiscoverablePoi`
  actually carries interaction from the loader (the load-bearing integration point).
  Confidence: high.
- **Senior 3D** — Off the WebGL surface; zero draw calls / triangles / bytes. Owns only the
  thin `DiscoverablePoi` + `DiscoverySystem` thread-through. HARD line: no transient state
  through the store/singletons; panel must not reach back to re-parse content. Confidence: high.
- **Senior Quality** — The AC under-specifies the data chain (three hops, not one) and the
  guess-session edge cases. Flags: stale state across reopen is the top bug; threading only
  `OpenInfo` is a false green; reusing `DiscoveryAnnouncer` won't announce a guess; making
  `OpenInfo.interaction` required breaks 9 literals; a JSON typo silently coerces to plain.
  Confidence: high.
- **Lead UI/UX** — Two-phase state inside the existing dialog: guess phase (body hidden,
  prompt + options as native buttons), reveal phase (chosen marked, correct marked neutrally,
  then body + takeaway + "Drive on"), plain phase byte-for-byte today. First focus on first
  option; own polite live region; `role=group`/fieldset labelled by the prompt. HARD: never
  show body while guessing; no focus on close pre-reveal; no scoring/free-text/persistence;
  no mode-flag mega-component. Confidence: high.

## Consensus Design

Make the dormant per-POI `interaction` real and player-visible via the smallest
end-to-end guess-then-reveal slice.

**Decisions:**

1. **Data chain — three hops, not one.** Add non-nullable `interaction: PoiInteraction` to
   `DiscoverablePoi` (populated from `c.interaction` in `buildDiscoverablePois`) AND to
   `OpenInfo`; pass `nearest.interaction` at `DiscoverySystem.ts:76`. Threading only `OpenInfo`
   is a false green (the build always renders plain). The store stays a dumb carrier;
   `loadContent`/`parseInteraction` remains the single normalization seam.
2. **`OpenInfo.interaction` is REQUIRED**, matching contentModel's non-nullable / exhaustive-switch
   design. The same diff updates all 9 OpenInfo literals + the `openInfo()` helper to
   `interaction: { type: "plain" }`; verify the inventory with grep.
3. **Guess-answered state is panel-local React state, NEVER the store** (HARD, unanimous).
   Putting transient per-open selection state in the snapshot would couple the sim to UI clicks
   and threaten the reference-equality contract that prevents `useSyncExternalStore` loops.
4. **Reset invariant keyed on `snap.open.id`**, justified by the REAL engine model: `openPoi`
   fires once per E-press (interact is an edge-drained queue; the panel early-returns while open;
   the `open` object reference is preserved across the same-frame `setDiscovered`). A new open
   with a different id resets; same-id re-renders keep `revealed === true`.
5. **One `RevealPanel`, branch on `interaction.type`** — no mode-flag fork. Plain arm
   byte-for-byte today; guess pre-reveal shows prompt + options, no body; guess post-reveal
   marks chosen + correct neutrally, then body + answerReveal + "Drive on". One-way. `highlight`
   is out of UI scope but the exhaustive switch degrades it to body.
6. **Accessibility — the panel gets its OWN polite live region.** `announcementFor` only fires on
   rising `discoveredCount`, so reusing `DiscoveryAnnouncer` would silently fail the SR-announce
   AC. First focus on the first option in the guess phase; on commit, focus moves to "Drive on".
   Escape + backdrop close from either phase.
7. **Pure helper** for the reveal decision (`given options + chosen index → selected/correct/
   revealText`), unit-tested with no DOM.
8. **Content** — author exactly TWO guess POIs (`poi-force-push-dam`, `poi-staff-engineer-gate`),
   the rest stay plain; matching PROVENANCE rows (C/A sources), honest options.
9. **Content-integrity guard** — the content test MUST positively assert both POIs resolve to
   `interaction.type === 'guess'` with exactly one correct option (parseInteraction coerces a
   malformed guess to plain silently).

**Rejected alternatives:** guess state in the snapshot/a store method; threading only `OpenInfo`;
re-parsing in `RevealPanel`; a separate `GuessPanel`/`isGuess` boolean fork; reusing
`DiscoveryAnnouncer` for the reveal; optional `OpenInfo.interaction`; authoring `highlight` or
rewriting plain POIs; shuffling options this slice; a per-frame-reset test (impossible scenario);
scoring / pass-fail / free-text / "Next →" / per-guess persistence.

## Critique History

**Quality critic — MATERIAL FLAW (one round, resolved):** The design declared its OpenInfo-literal
call-site inventory complete for typecheck-green, but that inventory covered only the `OpenInfo`
hop. The NEW required field on `DiscoverablePoi` has its own literal constructors in tests that the
inventory omitted; under strict mode each yields `TS2741 'Property interaction is missing'`. Three
missed sites: `src/discovery/discovery.test.ts:37-39` (two `DiscoverablePoi` literals),
`src/ui/NavSystem.test.ts:35` (the `poi()` factory), `src/ui/discoveryComplete.reload.test.ts:23`
(the `Array.from(...)` POI builder). All other load-bearing claims (engine model, parseInteraction
coercion, announcer-reuse failure, panel-local state, both chosen POIs exist with matching bodies)
verified accurate.

**Resolution:** T1 widened the inventory to cover both the OpenInfo hop and the `DiscoverablePoi`
literal constructors; the implementation updated NavSystem, discoveryComplete.reload, and
discovery.test among the touched sites. Final typecheck green.

## Task Plan

| ID | Owner | Depends | Title |
|----|-------|---------|-------|
| T1 | backend  | — | Thread interaction through the data chain (DiscoverablePoi, OpenInfo, DiscoverySystem:76) |
| T2 | quality  | T1 | Fix the type-fanout: update 9 OpenInfo literals + the openInfo helper to `interaction:{type:'plain'}` |
| T3 | quality  | T1 | Headless DiscoverySystem test: interacting near a guess POI populates `snapshot.open.interaction` type `guess` |
| T4 | frontend | — | Pure reveal-decision helper (`options + chosenIndex → {selectedIndex, correctIndex, revealText}`) |
| T5 | junior   | — | Author two real guess POIs + PROVENANCE rows; content test asserts `type==='guess'` |
| T6 | frontend | T1, T4 | Branch RevealPanel on `interaction.type` (plain / guess pre-reveal / guess post-reveal) |
| T7 | quality  | T6 | Reset-invariant coverage (open-A/answer/close/open-B; same-id re-render keeps revealed) |
| T8 | ux       | T6 | Accessibility for the guess arm (own polite live region, focus management, dual-phase close) |
| T9 | quality  | T2,T3,T5,T6,T7,T8 | Build verification + run-log entry |

## Implementation Summary

- **T1 (backend)** — Threaded the loader-resolved `PoiInteraction` through the full chain on
  `feat/thread-poi-interaction` (`f481caf`): non-nullable `interaction` on `DiscoverablePoi`
  (from `c.interaction` in `buildDiscoverablePois`) and `OpenInfo`; `nearest.interaction` passed at
  `DiscoverySystem.ts:76`. Test-first in `discoverablePois.test.ts` (interaction survives the build
  join via `toStrictEqual`) and `discoveryStore.test.ts`. Updated the full inventory of OpenInfo/
  DiscoverablePoi literals across 9 sites + the `DiscoveryBurstSystem` `openInfo` helper. 235 passed,
  build typechecks.
- **T4 (frontend)** — `src/ui/revealDecision.ts` + test (`feat/reveal-decision-helper`, `771d048`):
  `revealDecision(options, chosenIndex)` returns `{selectedIndex, correctIndex, revealText}` with
  neutral copy ("The answer was X."). 3 tests pass, tsc clean.
- **T5 (junior)** — Authored `poi-force-push-dam` and `poi-staff-engineer-gate` as real guess
  interactions in `content/working-with-claude.json` (`feat/guess-pois-content`, `af6cd61`); 3 honest
  options each, exactly one correct, an answerReveal; other 11 stay plain. Two matching PROVENANCE
  rows (C/A/E sources). Content test asserts both ids resolve to `type === 'guess'` with one correct
  option and that the rest stay plain. 242 passed, build typechecks.
- **T2 (quality)** — Verified already satisfied across the prior commits; all OpenInfo literals carry
  `interaction: { type: "plain" }`, production caller passes `nearest.interaction`. No new changes;
  `npm run build` green, 242 tests pass.
- **T3 (quality)** — Added the headless guess-populates-snapshot test to `src/discovery/discovery.test.ts`
  (`test/discovery-guess-interaction-t3`, `a160033`): vehicle inside `INTERACT_RADIUS` of a guess
  fixture, one `consumeInteract`, asserts `open.interaction.type === "guess"` + prompt + one correct
  option. 243 passed, build clean.
- **T6 (frontend)** — Branched `RevealPanel.tsx` on `snap.open.interaction.type`
  (`feat/reveal-panel-guess-arm`, `8d21eec`): plain arm byte-for-byte today; guess pre-reveal renders
  the prompt in a `role=group` labelled by the prompt with native button options and no body; on any
  pick reveals body + answerReveal, chosen `aria-pressed`, correct `data-correct`, options disabled.
  Answered flag is panel `useState` reset in a `useEffect` keyed on `snap.open?.id`; own polite
  `role=status` live region; first-option focus pre-reveal, "Drive on" on commit. Reuses the T4 helper.
  7 tests, styles in `tokens.css`. 250 passed, build + ESLint clean.
- **T7 (quality)** — `RevealPanel.reset.test.tsx` (`81482f4`): open-A/answer/close/open-B shows
  prompt-not-body; same-id `setDiscovered` re-render keeps the revealed body. No per-frame-reset test.
  Removed the duplicate reset block from `RevealPanel.test.tsx`. 250 passed.
- **T8 (ux)** — `RevealPanel.a11y.test.tsx` (`test/revealpanel-guess-a11y-t8`, `435e684`): 8 tests for
  first-option focus, own polite region announcing the reveal on commit, focus to "Drive on",
  `aria-pressed`/`aria-disabled` post-commit, Escape from both phases, backdrop close from the guess
  phase, plain phase focus-the-close-button. Implementation already satisfied the reqs. 258 passed.
- **T9 (quality)** — Build verification + this run-log (`d81297c`). `npm test` 258 pass, `npm run build`
  typechecks + bundles, running-build smoke check (`scripts/verify-game.mjs` vs `vite preview`) VERIFY
  OK (~41 fps, 13 POIs, no WebGL/console errors).

## Verification Result

- **Tests:** PASS — 48 files, 258 tests, 0 failures.
- **Build:** PASS — `tsc --noEmit` clean, `vite build` succeeds.
- **Code review:** PASS.
- **Running-build smoke:** VERIFY OK — engine ~41 fps, 13 POIs, zero WebGL/console errors.
- **UX review:** PASS, with two non-blocking notes:
  - The correct/selected option post-reveal is distinguished primarily by accent border color
    (tokens.css:465-466); mitigated because the always-present `revealText` carries the meaning
    textually, so no colorblind user depends on the color cue. Consider redundant icon/text encoding
    in a future slice.
  - No in-browser teleport/debug hook exists, so the running-build guess flow could not be exercised
    end-to-end via the Playwright verifier (only that the bundle boots clean with 13 POIs and zero
    console errors). The DOM-level prompt-then-reveal flow is fully covered by RTL tests mounting the
    real `RevealPanel` against a real store; production wiring confirmed at `GameCanvas.tsx:229`.

**Honest verification note:** `render_game_to_text` exposes the open POI id but not its interaction
payload, and the smoke harness has no teleport-to-named-POI hook. The prompt-then-reveal vs
unchanged-plain distinction is therefore verified against the real `RevealPanel` under RTL, while the
Playwright check confirms the full bundle boots error-free — the strongest check the current automation
seams support.

**Conscious decision logged:** a guess POI is marked discovered on OPEN (before any pick), and
re-opening shows the unanswered prompt with no memory — consistent with M1's proximity/interact
discovery (`DiscoverySystem.ts:77-80`). Answered-state / scoring / re-guess memory are out of scope.
Not a bug; M1's "discovered" must not be read as "read".

## Ship

- **Branch:** `feat/sound-engineer-role`
- **PR:** [#84](https://github.com/NikolajMosbaek/AboutMeGame/pull/84)
- **Merged:** yes (all gates green: tests, code review, UX review)
