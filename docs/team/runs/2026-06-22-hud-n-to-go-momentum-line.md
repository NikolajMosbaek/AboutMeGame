# Team Run — 2026-06-22

## Feature

M1 — Journey & Completion Arc (slice 4: "N to go" remaining-count momentum line in the HUD).

Add a visually-subordinate "N to go" momentum line to the HUD top-right cluster, beside the existing "Discovered N / 13" badge, so players feel distance-ahead (a finish line) and not just distance-behind. Derived purely from the discovery snapshot; no new store fields, no canvas/WebGL.

## Acceptance Criteria

- The HUD shows a remaining-count line (e.g. "3 to go") alongside the existing "Discovered N / 13" badge, derived from the discovery store's `discoveredCount` and `total` (no new store fields).
- The remaining count equals `total - discoveredCount` and updates live as landmarks are discovered (verified via RTL against `src/ui/Hud.tsx`, mirroring the existing "renders the single discovery-progress badge" test).
- When all landmarks are discovered (0 remaining), the line does not show a misleading "0 to go"; it reads as complete ("All discovered") — covered by a boundary test.
- Singular vs plural is correct at the boundary ("1 to go", not "1 to gos"; "3 to go").
- The new line is non-blocking and accessible: appropriate aria-label / role consistent with the existing badge, and no second redundant live region (DiscoveryAnnouncer remains the single polite announcer).
- All existing `Hud.test.tsx` cases still pass; `npm test` green on a clean checkout; no canvas/WebGL work touched.

## Roundtable Positions

- **Product Owner** (confidence: high): Ship slice 4 only — the smallest standalone slice of the highest-priority backlog item, delivering felt-momentum value on its own. In scope: derived "N to go" line, correct singular/plural, non-misleading completed boundary (prefer reading store's `completed` flag), no second live region, mirroring tests. Out of scope (YAGNI): M1 slices 3/5, scoring/timers/percentages/progress bars, new store fields/throttling, any canvas/WebGL. Mildly prefers positive "All discovered" over hiding; defers exact copy to UX. Confirmed additive vs CompletionPanel.
- **Tech Lead** (confidence: high): Derive everything from the snapshot; reuse `d.completed` (not `remaining === 0`); render inside `.discovery-progress`; no pluralization needed for the invariant "to go" copy; fold remaining meaning into the existing badge aria-label and aria-hide the visible text; test-first. Rejected: new store field, inline `remaining === 0`, second live region, pluralization helper, mode flag. Owner: frontend. Open seams flagged for ratification: exact wording, and "All discovered" vs hidden (leans to "All discovered").
- **Senior Product/Frontend Engineer** (confidence: high): Pure derived addition; `remaining = d.total - d.discoveredCount`; branch on `d.completed`; plain non-live element; noun only in aria-label. Test-first with five cases. Hard objections to: new store fields, making the line a live region, an `isComplete`/`showRemaining` mode flag, and inventing a noun-pluralized visible string.
- **Senior Systems/Backend Engineer** (confidence: high): Supports as scoped with three correctness constraints — branch on `d.completed` not `remaining === 0` (total>0 guard); no `aria-live`/`role=status`; pluralize at `remaining === 1` only if copy uses an inflecting noun. Notes the snapshot-reference short-circuit on `setDiscovered`, so tests must pass fresh arrays. Hard objections to a second live region and to gating completed/empty on `remaining === 0`.
- **senior-eng-graphics-3d** (confidence: high): No objection — zero GPU/WebGL impact, owned by frontend. Confirms derive-from-store, use `d.completed`, no pluralization helper, static aria-label. Negligible bundle impact (~few hundred bytes vs 400 KB gz cap).
- **Senior Quality Engineer** (confidence: high): Supports; seams exist with zero plumbing. Near-objection: the AC's "All discovered" OR hidden is an untestable either/or — convergence must pick ONE for a deterministic boundary test. Confirm the completed line stays non-live.
- **Lead UI/UX Designer** (confidence: high): Second subordinate momentum line under the badge; three states (in-progress / completed "All discovered" / singular "1 to go"); badge primary, momentum line secondary; not a live region. Hard objections to: aria-live/role=status on the line, showing "0 to go", and scope creep into slices 3/5 or a progress bar.

## Consensus Design

Ship a per-landmark "N to go" momentum line in the HUD top-right cluster (`src/ui/Hud.tsx`), rendered as a visually-subordinate child under the existing "Discovered N / 13" badge, derived purely from the discovery snapshot (`remaining = d.total - d.discoveredCount`). The completed boundary is driven off the store's existing `d.completed` flag (guarded by `total > 0`), never `remaining === 0`, so an empty/unloaded store never reads complete and "0 to go" is never shown — the completed line reads "All discovered". The line is NOT a live region; its meaning folds into the single existing `.discovery-progress` aria-label so DiscoveryAnnouncer remains the sole polite announcer. No new store fields, props, mode flag, or canvas/WebGL. Frontend owns it end-to-end, test-first.

**Decisions:**
- Render a momentum line inside `.hud-top-right`, directly under the `.discovery-progress` badge, as a separate styled child (`<span className="discovery-remaining">`).
- Derive at render time from the existing snapshot; add NO new store fields, props, or plumbing.
- Drive the completed branch off `d.completed` (computed as `discoveredCount === total && total > 0`), not `remaining === 0`.
- Three render states: in-progress shows `${remaining} to go`; completed shows "All discovered"; empty/uninitialized (not completed) shows `${remaining} to go` (e.g. "13 to go").
- DECIDED COMPLETED COPY: positive "All discovered" label (not hidden/collapsed), so the finish reads as arrival and the boundary test is deterministic.
- No pluralization code: the invariant "N to go" copy satisfies the "1 to gos" clause by copy choice.
- Accessibility: visible "to go"/"All discovered" text is `aria-hidden`; meaning folds into the single `.discovery-progress` aria-label (e.g. `Discovered N of total landmarks, M to go`, or `All total landmarks discovered`). No second labelled node, no role=status, no aria-live.
- DiscoveryAnnouncer remains the single `aria-live=polite` announcer, including in the completed state.
- Owner: frontend, end-to-end. Test-first mirroring the existing badge test with `createDiscoveryStore` + `setDiscovered` using fresh arrays.

**Rejected alternatives:**
- New `remaining` DiscoveryStore field — YAGNI and a drift surface.
- Inline `remaining === 0` completion check — diverges from the store's authoritative `completed` guard; falsely reads empty/total-0 store as complete.
- A second aria-live region / role=status on the line — violates the documented single-announcer invariant; double-announce.
- A separate second aria-labelled node — redundant adjacent progress labels for screen readers.
- A conditional pluralization helper — dead complexity for the invariant copy.
- An `isComplete`/`showRemaining` boolean prop or mode flag — the split is a real domain boundary already expressed by `d.completed`.
- Hiding the line at completion — rejected in favour of positive "All discovered".
- Any progress bar, percentage, animation/juice, new overlay, or pulling in M1 slices 3/5 — out of scope.

## Critique history

**Quality critic — no material flaw.** Every load-bearing claim verified against code (store `completed` derivation at `discoveryStore.ts:66`; single `.discovery-progress` aria-label at `Hud.tsx:50`; DiscoveryAnnouncer sole live region; baseline 201/201 green). Issues raised (all minor, non-blocking):
- LAYOUT MISMATCH (minor): `.hud-top-right` is `display:flex; align-items:center` (`tokens.css:507`), so a third flex child renders to the right, not "under" the badge; achieving "under" needs a column wrapper / CSS the design did not specify. AC only requires "alongside", so not blocking — addressed by T5 styling (column flex on the badge).
- DEGENERATE total===0 EDGE (minor, cannot occur in production): the in-progress branch would render "0 to go" for a `total===0` store; harmless because `buildDiscovery.ts:35` sets `total = pois.length` (fixed 13-item content set), so total===0 is never constructed.
- NEEDS-VERIFICATION on boundary text collision: `getByText('All discovered')` + assert "0 to go" absent is deterministic; no collision with "Discovered N / 13" found. Sound as specified.

No design revision required; the chosen "All discovered" copy already resolved the only real untestability concern (the completed-state either/or).

## Task Plan

| ID | Owner | Title | Depends on | First test |
|----|-------|-------|------------|-----------|
| T1 | frontend | Failing RTL tests: mid-journey (3/13 → "10 to go"), live re-render to "8 to go", singular boundary (12/13 → "1 to go"), empty (0/13 → "13 to go") | — | `it('shows remaining "N to go" mid-journey and updates on re-render')` |
| T2 | frontend | Failing RTL test: completed boundary 13/13 → "All discovered", never "0 to go", driven by `d.completed` | — | `it('shows "All discovered" at the completed boundary and never "0 to go"')` |
| T3 | frontend | Failing RTL a11y test: no new live region; line aria-hidden; remaining meaning folded into single `.discovery-progress` aria-label | — | `it('introduces no second live region; remaining meaning is in the single discovery-progress aria-label')` |
| T4 | frontend | Implement the momentum line in `Hud.tsx` to make T1–T3 green; update the single aria-label; no new store fields/props/mode flag/live region | T1, T2, T3 | Reuse T1/T2/T3; full Hud suite stays green |
| T5 | graphics | Style `.discovery-remaining` as a subordinate cue under the badge, pure CSS; confirm zero rendering-pipeline impact | T4 | CSS check: smaller font-size than `.discovery-progress`, sits under the badge; no Three.js/WebGL files touched |
| T6 | ux | Confirm copy contract (visible invariant "N to go", completed "All discovered", natural aria-label nouns); advisory, no logic changes | T4 | Copy contract already pinned by T1/T2/T3 |
| T7 | quality | Final gate: `npm test` + `npm run build` green; diff confines to allowed files; no store/canvas changes | T4, T5 | Run `npm test` and `npm run build`; assert exit zero and diff scope |

## Implementation summary

- **T1 (frontend):** Added 3 failing RTL tests then the subordinate `aria-hidden` `<span className="discovery-remaining">` inside `.discovery-progress`, rendering `${remaining} to go` or "All discovered" when `d.completed`; meaning folded into the single aria-label. No new store fields/props/canvas. Suite green (204). Commit `39eb5c2` on `feat/hud-momentum-line`.
- **T2 (frontend):** Added completed-boundary test (13/13 → "All discovered" present, `/0 to go/` absent), driven by `d.completed`. All 8 Hud tests pass. Commit `788f71e`.
- **T3 (frontend):** Added a11y tests pinning no second live region: `[aria-live],[role=status]` count equals baseline, `.discovery-remaining` is `aria-hidden` with no role/aria-live, in-progress aria-label `Discovered 3 of 13 landmarks, 10 to go`, completed aria-label `All 13 landmarks discovered`. Verified to fail when a second live region is injected. Suite 207/207. Commit `3410c58`.
- **T4 (frontend):** Already satisfied by T1's implementation; no new code. Implementation lives in `Hud.tsx`. Suite green (207). Commit `39eb5c2`.
- **T5 (graphics):** Pure CSS in `src/tokens.css` — made `.hud-top-right .discovery-progress` a right-aligned flex column so children stack; styled `.discovery-remaining` as subordinate (font-size 0.65rem vs 0.85rem, weight 600, opacity 0.7, right-aligned). Test-first CSS check via jsdom CSSOM. Suite green (208); diff confined to the stylesheet + test; zero WebGL files. Commit `60e4e2b` on `feat/discovery-remaining-style`.
- **T6 (ux):** Advisory sign-off PASS — copy contract approved, no changes/commit (no-op would add no value). Strings pinned by committed tests; aria-label nouns read naturally in both states.
- **T7 (quality):** Final gate PASS — `npm test` exit 0 (43 files / 208 tests); `npm run build` exit 0 (typecheck clean); Hud.test.tsx 11 tests pass; diff touches only `src/ui/Hud.tsx`, `src/ui/Hud.test.tsx`, `src/tokens.css` (no `src/discovery/*`, no `*.glsl`, no engine/render files); no DiscoveryStore field changes. No commit performed (already committed on branch).

## Verification result

- Tests pass: yes (`npm test` exit 0, 43 files / 208 tests green; Hud.test.tsx 11/11).
- Code review: pass.
- Build: `npm run build` exit 0, typecheck clean.
- UX review of running build: pass, no gaps.
- All gates green: yes.

## Ship

- **Branch:** `feat/discovery-remaining-style`
- **PR:** https://github.com/NikolajMosbaek/AboutMeGame/pull/81
- **Merged:** yes
