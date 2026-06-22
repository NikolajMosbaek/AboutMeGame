# Run: M2 slice 3 — Interactive RevealPanel (guess-then-reveal + a11y)

## Feature

M2 — Make the Reveal Interactive, Not a Wall of Text (slice 3): turn `RevealPanel`
into an exhaustive consumer of the already-shipped store interaction seam so a
discovery becomes an act (`guess`) or a framed read (`highlight`) rather than a
passive wall of text, while `plain` stays byte-identical. Reference guess/highlight
content is authored so the running build demonstrates the feature. Pure consumption
slice: zero edits to `contentModel.ts` or `discoveryStore.ts` (slices 1-2, shipped).

## Acceptance Criteria

1. A `guess` POI's reveal shows the prompt plus its 2-3 options as focusable buttons FIRST; the full body is not rendered (conditional render, not CSS-hidden) before a pick — asserted via `queryByText(bodyString) === null` until a choice is committed.
2. Selecting any option calls `store.answerGuess(index)` with the option's array position; the body unlocks via the store's derived `snap.open.bodyUnlocked` (panel never derives unlock); the committed option shows `aria-pressed="true"` plus a non-color affordance and re-selecting is idempotent (no flicker, no re-announce).
3. A `highlight` POI shows `interaction.emphasis` distinctly above the body, both immediately (no gate); a `plain` POI renders exactly as today (eyebrow, title, body, close) — a behaviour test confirms no regression.
4. Keyboard/SR accessible: options are native focusable buttons reachable by Tab, Enter/Space activate, the prompt is associated with the option group via `role="group" aria-labelledby="reveal-guess-prompt"`, and committing announces politely once on the `bodyUnlocked` false→true transition via a panel-local `sr-only role="status" aria-live="polite"` region (no new sole-audio/visual-only channel; does not trip the Hud-scoped single-live-region test).
5. Escape, close button, and backdrop-click still close the panel for every interaction type (including an un-answered guess); focus is managed into the dialog on open — close button for plain/highlight, first option for guess — and the focus effect does not re-fire on a guess commit.
6. At least two existing POIs gain a valid `guess` interaction (each 2-3 options, exactly one `correct: true`, non-empty strings) and at least one plain POI gains a `highlight` emphasis; `loadContent()` loads without error and `content.test.ts` is updated to assert those POIs resolve to `guess`/`highlight` (not all-plain) and stays green.
7. The interactive reveal logic is unit-tested headless (Vitest + RTL, no WebGL) driving a real discovery store through `openPoi → answerGuess → body-unlock` for guess, and rendering plain/highlight directly, plus close-affordance and keyboard coverage.
8. `npm test` and `npm run build` are green; `PROVENANCE.md` notes the newly authored interaction content and its source.

## Roundtable Positions

- **Product Owner (high):** Ship the payoff slice — RevealPanel consumes the store seam, author the demonstrating content, hold the line on scope. IN: branch on `interaction.type`, options call `answerGuess`, read `bodyUnlocked`, a11y via existing live-region pattern, headless RTL tests. OUT: slice-4 "Next landmark" nav, free-text, scoring/correctness verdict, persistence, new audio/VFX, and any edit to `contentModel.ts`/`discoveryStore.ts`. Objects to any store/model edit, any pulled-forward nav, any correctness display.
- **Tech Lead (high):** One dialog, one exhaustive `switch` with a `never` default mirroring `parseInteraction`. Panel adds zero state; reads `interaction`, `guessChoice`, `bodyUnlocked`. Add a panel-local polite region (DiscoveryAnnouncer is keyed on `discoveredIds` and won't fire on a guess pick). Gate the focus effect on open-id transition so a commit doesn't yank focus. Rejects panel-local unlock state, a separate component tree, reusing DiscoveryAnnouncer, and UI correctness judgement.
- **Senior Frontend (high):** Extract a pure `RevealBody(open, store)` switching on type; keep close/Escape/backdrop/focus in `RevealPanel`. Flags the BLOCKER that `content.test.ts` asserts every POI is `{type:'plain'}` — must be updated in-slice. Hard objections to panel-local unlock state, a second competing announcer, splitting the shell / isPreview boolean, color-only chosen indication, and CSS-hiding the body.
- **Senior Backend (high):** Verified the data flow end-to-end (`parseInteraction → loadContent → DiscoverySystem.openPoi:76 → store → snapshot → panel`). Highest-impact risk: silent coerce-to-plain (malformed guess degrades with only a `console.warn`), so the content test must assert parsed `interaction.type` per POI. Body must be conditionally rendered, not CSS-hidden. Objects to any store/model edit, UI correctness recording, option shuffling, and per-id guess memory.
- **Graphics-3D (high):** Out of lane and that is the correct split — no WebGL surface; sits entirely in `src/ui/` + `content/`. Confirmed the seam is clean and ready. Flags the single-live-region invariant (Hud.test.tsx) and recommends reusing the DiscoveryAnnouncer pattern. Objects only if work drifts across the engine seam or re-derives unlock.
- **Sound (high):** Outside synthesis ownership; endorses no new audio. The reveal chime stays owned by AudioSystem on the `discoveredCount` rising edge at `openPoi`, unchanged. Hard objections to a panel-owned competing aria-live region, any guess-commit sound (inaudible when muted), and panel-derived unlock.
- **Quality (high):** One exhaustive switch, body gated solely on `bodyUnlocked`. HARD OBJECTION: the slice cannot satisfy both "author content" and "content test stays green" while line 172 asserts all-plain — the test must be updated (in-scope, it tests content this slice changes), not faked green. The body-absent test must query the actual body string. Flags `answerReveal` (wire or consciously omit), `answerGuess(index)` = array position, prevRef announce guard, and focus ambiguity.
- **Lead UI/UX (high):** Three reveal states in one dialog; eyebrow/title constant, only the middle region varies. Highlight = emphasis as a lede callout above the body. Guess = prompt + native-button group, body absent until pick, chosen state via `aria-pressed` + non-color affordance. Initial focus on first option for guess, close for plain/highlight. Hard objections to panel-derived unlock, CSS-hiding the body, a correctness/score reveal, div/span options, and color-only chosen indication.

## Consensus Design

One dialog, one exhaustive `switch (snap.open.interaction.type)` with a `never`
default. The dialog chrome (backdrop, `role=dialog`, `aria-modal`, eyebrow, title,
close button, Escape, backdrop-click, focus-on-open) stays in `RevealPanel` and is
identical across all three types; only the middle body region varies via a pure
inner render-by-type. The panel is pure presentation: it reads `snap.open.bodyUnlocked`
and `snap.open.guessChoice` and calls `store.answerGuess(arrayIndex)` — it NEVER
derives unlock and NEVER reads `GuessOption.correct`.

Key decisions:
- **PLAIN:** today's markup byte-identical (regression baseline).
- **HIGHLIGHT:** `interaction.emphasis` in `reveal-panel__emphasis` (accent bar + heavier weight) as a lede above the body; both immediate, no gate.
- **GUESS before a pick:** prompt as `<p id="reveal-guess-prompt">`, options as native `<button type="button">` in `<div role="group" aria-labelledby="reveal-guess-prompt">`; the body node is CONDITIONALLY NOT RENDERED while `!bodyUnlocked`. After a pick: body renders solely off `bodyUnlocked` flipping true; optional `answerReveal` renders in `reveal-panel__emphasis` (omitted gracefully when absent); committed option gets `aria-pressed="true"` + `reveal-panel__option--chosen` (non-color affordance). Re-click is a store no-op.
- **Polite announce:** panel-local `sr-only role="status" aria-live="polite" aria-atomic="true"` firing once on the `bodyUnlocked` false→true transition via a `prevRef` guard (not on every render, not on initial mount). RevealPanel is a sibling of Hud, so the Hud-scoped single-live-region test is unaffected.
- **Focus:** the focus-into-dialog effect is gated on `open.id` change only (so `answerGuess` minting a new `open` object doesn't yank focus); first option for guess, close button for plain/highlight.
- **Close:** Escape, close button, and backdrop-click close every type including an un-answered guess.
- **Content:** guess on `poi-staff-engineer-gate` and `poi-force-push-dam`, highlight on `poi-end-state-overlook`, grounded in existing body copy; `content.test.ts` all-plain assertion updated to assert the authored types; PROVENANCE noted.
- **Styling:** new classes in `src/tokens.css` only, BEM-ish, respecting reduced-motion/responsive; no inline style logic, no new motion/audio.
- **Scope:** `src/ui/` + `content/` only (plus the coupled `content.test.ts` assertion). No edits to `src/engine/`, `src/perf/`, `discoveryStore.ts`, `contentModel.ts`, or `.claude/`.

Rejected alternatives: panel-local unlock `useState`; reusing DiscoveryAnnouncer for
the commit announce; a new app-level live node or commit sound; a separate
GuessPanel/HighlightPanel tree or isPreview boolean; CSS-hiding the body; color/icon-only
chosen indication; div/span options; shuffling options this slice; pulling slice-4 nav
in; any right/wrong verdict from `correct`; a focus effect keyed on the whole `open`
reference; leaving the content test asserting all-plain.

## Critique History

**Quality critic — material flaw: NO.** The critic attempted to refute the design by
verifying every load-bearing claim against source. All checked out: store seam complete
(`bodyUnlocked` derived in `set()` at `discoveryStore.ts:98-101`, `answerGuess` idempotent
at `:150-152`), `DiscoverySystem.ts:76` feeds interaction into `openPoi`, RevealPanel and
DiscoveryAnnouncer are siblings under GameCanvas (Hud invariant unaffected), candidate POIs
exist with groundable copy, the `content.test.ts` all-plain assertion (line 172) and count
(line 164) are exactly as cited, `parseInteraction` enforces 2-3 options / exactly-one-correct
/ non-empty with coerce-to-plain, and `tokens.css` has the reveal-panel classes to extend.
Four implementation-discipline notes surfaced (all already addressed by the design, no revision
required): (a) the Escape listener must stay in an effect whose dep includes the open→null
transition while the focus dep narrows to `open.id`; (b) the announce needs a `useRef`-of-previous
guard since `useSyncExternalStore` exposes only the current snapshot, and the test must assert
"announced exactly once" and "not on plain/highlight open"; (c) `content.test.ts` keeps count 13
(authoring existing POIs) so only the per-POI assertion changes, and must positively assert
`guess`/`highlight` resolution; (d) sharing `reveal-panel__emphasis` for the highlight lede and
the guess `answerReveal` is fine provided the callout is omitted when `answerReveal` is absent.

## Task Plan

| ID | Owner | Depends | Title | First test |
|----|-------|---------|-------|-----------|
| t1 | ux | — | Author guess + highlight interactions in `working-with-claude.json` grounded in existing body copy | `content.test.ts`: assert the three authored POIs resolve to `guess`/`highlight` (2-3 options, exactly one correct, non-empty emphasis); every other POI stays `plain` |
| t2 | ux | t1 | Update `PROVENANCE.md` to note the authored interaction content + source | Reviewer reads the PROVENANCE diff naming the three POIs |
| t3 | frontend | — | Add reveal-panel interactive styling to `src/tokens.css` only | `RevealPanel.test.tsx`: chosen option has `reveal-panel__option--chosen`, emphasis node has `reveal-panel__emphasis` |
| t4 | frontend | t3 | Make RevealPanel an exhaustive consumer of `interaction.type` (chrome stays, body region varies, `never` default) | Drive a real store through `openPoi(guess)`; assert prompt + buttons in `role=group` w/ `aria-labelledby`, distinctive body string absent via `queryByText(...)===null` |
| t5 | frontend | t4 | Wire body-unlock-on-commit + committed-option affordance | After click: `guessChoice` = array index, body present, button `aria-pressed=true`, re-click idempotent |
| t6 | frontend | t5 | Panel-local polite announce on `bodyUnlocked` false→true via prevRef guard | No spurious announce on plain/highlight mount; one announce on commit; no re-announce on re-click |
| t7 | frontend | t6 | Manage focus + close affordances per type (focus effect gated on `open.id`) | Guess focuses first option; plain/highlight focus close; commit does not move focus; Escape/backdrop/close close every type |
| t8 | quality | t7 | Add keyboard-activation coverage for guess options | Native button contract; Enter/Space commit; Tab reaches options then close |
| t9 | quality | t1-t8 | Final gate: `npm test` + `npm run build` green; verify no leak into forbidden paths | Both exit zero; `git diff --name-only main` matches the allowed file set |

## Implementation Summary

- **t1 (ux, e2f12e6):** Authored `poi-staff-engineer-gate` (guess, 3 options, 1 correct), `poi-force-push-dam` (guess, 2 options, 1 correct), `poi-end-state-overlook` (highlight, emphasis verbatim from body) in `content/working-with-claude.json`, grounded in existing body copy; distractors are the body's explicitly-rejected alternatives. Replaced the all-plain loop in `content.test.ts` with positive type assertions (confirmed failing before authoring, passing after).
- **t2 (ux, in e2f12e6):** PROVENANCE "Authored interactions (M2 slice 3, #34)" section already committed alongside the JSON, mapping each interaction to its source body sentence; no further change needed.
- **t3 (frontend, 27777f1):** Added `reveal-panel__prompt/options/option/option--chosen/emphasis` to `src/tokens.css` only — non-color affordance (accent border + amber fill + leading `✓` glyph), emphasis accent left-bar + heavier weight; registered `.reveal-panel__option` in reduced-motion lists. Wired RevealPanel.tsx to the seam.
- **t4 (frontend, 82d3a9a):** Added the headless RTL suite; the production RevealPanel needed zero edits (already implemented on-branch). Lead test verified to genuinely guard the body gate (fails when conditional render removed). Body substring "clears this gate on my word" absent via `queryByText(...)===null` pre-pick.
- **t5 (frontend, 74ef277):** Confirmed body-unlock-on-commit + chosen affordance already wired (click → `answerGuess(i)`, body off `bodyUnlocked`, `aria-pressed` + `--chosen`, `answerReveal` only when present, idempotent re-click); added the missing idempotent-re-click body-present assertion.
- **t6 (frontend, dfb0e22):** Panel-local polite region (`sr-only role=status aria-live=polite aria-atomic`, "Answer revealed.", `prevUnlockedRef` guard) already implemented; added the explicit "polite announce (t6)" suite (no spurious mount announce, single commit announce, no re-announce). Hud invariant stays green (sibling, not child).
- **t7 (frontend, dcaa6a9):** Focus effect already gated on `openId` (firstOptionRef for guess, closeRef for plain/highlight); added "focus management (t7)" + "close affordances per type (t7)" suites. Verified the load-bearing guard fails when keyed on the whole `open` object.
- **t8 (quality, f64a152):** Added "keyboard activation (t8)" suite. Faithfulness decision: jsdom does not synthesize a click from Enter/Space keyDown on a native button (verified empirically), so the suite asserts the native-button element contract (no tabindex/disabled hack) + drives the platform click, the honest headless way to prove native Enter/Space activation. Test-only.
- **t9 (quality):** Final gate, verification-only; nothing new to commit.

## Verification Result

- `npm test`: exit 0 — 287 tests passed across 44 files (includes `content.test.ts` 32, `RevealPanel.test.tsx` 33, `Hud.test.tsx`).
- `npm run build`: exit 0 — typecheck + production bundle clean.
- Code review: PASS. UX review of running build: PASS (no functional gaps; two non-blocking, out-of-scope, store-side notes recorded).
- Scope: `git diff --name-only main` matches the allowed set — `src/ui/RevealPanel.tsx`, `src/ui/RevealPanel.test.tsx`, `src/tokens.css`, `content/working-with-claude.json`, `content/PROVENANCE.md`, `src/content/content.test.ts`. NO leak into `src/engine/`, `src/perf/`, `src/discovery/`, `src/content/contentModel.ts`, or `.claude/`.
- `content.test.ts` is a genuine positive assertion (requires `guess`/`highlight` resolution with option count + exactly-one-correct), not diluted — a coerce-to-plain regression would fail it.

## Ship

- **Branch:** `test/reveal-panel-keyboard-activation-t8`
- **PR:** https://github.com/NikolajMosbaek/AboutMeGame/pull/110
- **Merged:** yes (all gates green: tests, code review, UX review)
