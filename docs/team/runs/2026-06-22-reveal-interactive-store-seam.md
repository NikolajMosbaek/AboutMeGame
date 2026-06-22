# Run Log — M2 Reveal Interactive: Store Seam (slice 2)

- Date: 2026-06-22
- Bootstrap: no
- Gates green: yes — merged

## Feature

M2 — Make the Reveal Interactive, Not a Wall of Text (slice 2: carry
interaction into the discovery store + "guess answered" session state).

A headless, store-layer seam: thread the loader-resolved `PoiInteraction` from
`contentModel` through the discovery data chain into `OpenInfo`, and add pure
per-open guess session state (committed pick + a derived body-unlock flag) so
slice 3's RevealPanel can read interaction type, the committed pick, and whether
the body should yet be shown. No UI, no content authoring, no Next-selector.

## Acceptance Criteria

- AC1 `interaction` reaches `OpenInfo`; `DiscoverySystem` line 76 passes
  `nearest.interaction`; POIs without one default to `{ type: 'plain' }`;
  existing discovery/system tests stay green.
- AC2 `answerGuess` records the committed index; `bodyUnlocked` is false before
  a pick for a `guess` interaction, always true for `plain` and `highlight`.
- AC3 Per-open reset on close and on a different- or same-id re-open; idempotent
  same-reference; stable `getSnapshot` reference (no spurious re-renders).
- AC4 `answerGuess` never throws on a non-guess interaction and is a no-op; the
  snapshot reports `bodyUnlocked = true` for those.
- AC5 Headless Vitest covers locked-before-pick, unlocked-after-pick, plain
  unlocked, highlight unlocked, reset-on-close, reset-on-different-POI, no-op on
  plain/highlight, no-op when nothing open, and reference stability via `Object.is`.
- AC6 No `RevealPanel.tsx` edit, no `content/working-with-claude.json` edit, no
  Next-by-order selector.
- AC7 `npm test` and `npm run build` (typecheck) green, with no TS2741 on the
  three fixtures and no edits at the 13 call sites; read path adds no per-frame
  allocation.

## Roundtable Positions

- **Product Owner** (high): Ship the thin store-layer seam, but flagged two
  scope risks — (1) the problem statement asks the *store* to hold guess-answered
  state, which a prior run (#84) had unanimously placed in panel-local React
  state; from the value lens, the store only needs to carry `interaction` plus a
  pure body-unlock predicate. (2) `main` does not match the #84 log (none of that
  work is present), so the slice is genuinely unshipped. Objected to baking
  transient UI selection into the headless snapshot, to any per-option
  correctness/scoring, and to touching content JSON or RevealPanel.
- **Tech Lead** (high): Carry `interaction` end-to-end (two hops). Fold guess
  session state INTO `OpenInfo` so per-open reset is structural. `OpenInfo`
  gains `interaction`, `guessChoice: number | null`, `bodyUnlocked: boolean`
  (derived). `answerGuess(choice)` is a no-op on non-guess / no-open, idempotent
  via early-return before `set()`. Rejected a separate top-level `guess` field,
  deriving `bodyUnlocked` in RevealPanel, and a dead call-site default.
- **Frontend Engineer** (high): Three small test-first moves. Make `interaction`
  OPTIONAL on the `openPoi` argument and normalize inside the store so the ~6+
  bare-`OpenInfo` call sites stay green. Co-locate guess state on `open` so reset
  is automatic. Hard objections to required `interaction`, to a separate
  top-level guess field, to module-level state, and to exposing correctness here.
- **Backend Engineer** (high): Three-link data-flow change. Carry only the whole
  `PoiInteraction` union on `OpenInfo` (not individual fields). Populate
  `DiscoverablePoi.interaction` from `c.interaction`. Derive `bodyUnlocked` in
  `set()`. Flagged that a positional option index can desync if slice 3 shuffles.
- **Graphics (3D)** (high): Endorsed as drawn — pure store plumbing, no WebGL.
  Stressed `bodyUnlocked` must be a precomputed snapshot field (not a getter) and
  the idempotent path must early-return before `set()`/emit.
- **Sound Engineer** (high): Endorsed. Argued to carry the committed
  `GuessOption` (or index), not a bare boolean, so future correct/incorrect SFX
  need not re-derive correctness. Normalize the default at the store boundary, not
  the call site. No audio ships in this slice.
- **Quality Engineer** (high): Optional-input-with-default keeps 7 named existing
  call sites green with zero edits. Opening the `discoverablePois.ts` seam is
  in-scope and necessary or the criterion is vacuously always-plain. Reset must
  key on the open event (re-open of same id re-locks), not on id-change. Hard
  objections to a store-only diff, to no-reset-on-reopen, and to raw (undrifted)
  `bodyUnlocked`.
- **UI/UX Designer** (high): The store shape IS the interaction contract for
  slice 3. Encode three reveal states with one derived `bodyUnlocked` flag and a
  `guessChoice: number | null` (not a boolean) so the picked option and
  correctness survive. Hard objections to a bare answered boolean, to `answerGuess`
  throwing on plain/highlight, to in-place mutation, and to module-level leakage.

## Consensus Design

Store-layer seam for M2 guess-then-reveal. Carry `PoiInteraction` into the
discovery snapshot and add pure per-open guess state so slice 3 can read
interaction type, the committed pick, and a derived body-unlock flag.

Decisions:

- D1 Add `interaction` (`PoiInteraction`) to snapshot `OpenInfo`; add OPTIONAL
  `interaction` to `DiscoverablePoi`, set from `c.interaction` in
  `buildDiscoverablePois`. Carry the whole union for one exhaustive switch in slice 3.
- D2 (flaw fix) `DiscoverablePoi.interaction` is OPTIONAL not required, so the
  three literal fixtures stay green with zero edits while the producer always
  populates it.
- D3 (flaw fix) Split `openPoi` input from snapshot. `OpenPoiInput` has
  `id, order, title, body, interaction?`; snapshot `OpenInfo` additionally has
  required `interaction`, `guessChoice: number | null`, `bodyUnlocked: boolean`.
  All 13 call sites compile unchanged; `openPoi` defaults `interaction` to plain.
- D4 Co-locate guess state on the open object. `openPoi` sets `guessChoice` null
  and `bodyUnlocked` false only for guess; a fresh `OpenInfo` per open plus
  `closePoi` nulling it make reset structural — no leakage, no global, DI intact.
- D5 `bodyUnlocked` is derived in `set()` like `completed` — true when `open` is
  null OR type is not guess OR `guessChoice` set; never stored independently.
  `getSnapshot` stays a cached-reference return, zero per-frame allocation.
- D6 `answerGuess(choice)` — no-op if nothing open; no-op and never throws on
  non-guess; idempotent early-return before `set()` when choice unchanged so the
  reference is stable; else set a new open with `choice` and `bodyUnlocked` true.
  Records the index, does not judge correctness.
- D7 Store `guessChoice` as a number-or-null index, not a boolean, so slice 3 can
  render which option was picked and distinguish null from option zero. The store
  does not shuffle or interpret correctness.
- D8 Scope fence — edit only `discoveryStore.ts`, `discoverablePois.ts`,
  `DiscoverySystem.ts` line 76, `discoveryStore.test.ts`. No RevealPanel, no
  content JSON, no Next selector, no React, no WebGL, no audio.

Rejected alternatives:

- Required `DiscoverablePoi.interaction` — breaks typecheck (TS2741) on the three
  fixture literals; optional + always-populated producer is the fix.
- Single shared `OpenInfo` type for input and snapshot — would force
  `guessChoice`/`bodyUnlocked` on all callers; distinct `OpenPoiInput` gives zero edits.
- Separate top-level `guess` field — decouples reset from the open lifecycle and
  reintroduces cross-POI leakage.
- Bare answered boolean — loses the picked index and correctness info.
- `bodyUnlocked` as a `getSnapshot` getter — allocates per read, breaks reference identity.
- Defaulting `interaction` at the `DiscoverySystem` call site — normalize once at
  the store boundary instead.
- Storing correctness or score — scoring is slice 3+, out of scope.
- Widening `OpenInfo` with individual fields — carry the whole union.
- Module-level / singleton guess state — breaks the DI seam, leaks across games.

## Critique history

Quality critic: material flaw = **false**. Issues raised (all non-material):

- Locator imprecision: D2 cited the NavSystem fixture at
  `src/movement/NavSystem.test.ts line 35`; it is actually `src/ui/NavSystem.test.ts`
  line 36. The substance (optional `interaction` keeps it green) holds.
- Internal imprecision: D4 says guess state is "co-located on the open object"
  while D5 says `bodyUnlocked` is "derived in set()". Both are implementable; the
  design should commit to one — if it lives in `OpenInfo`, `set()` must rebuild
  `merged.open` to recompute it.
- Verification note (confirms soundness): `openPoi` is NOT called per-frame in
  production (gated behind the `consumeInteract()` edge + early-return-while-open),
  so the only reference-stability burden falls on `answerGuess`, which D6 handles.

Critic confirmed both load-bearing compatibility claims hold and could not refute
via reference churn, exhaustiveness, leakage on reopen, or snapshot-equality.
No revision required.

## Task Plan

- T1 (backend) — Add OPTIONAL `interaction` to `DiscoverablePoi`, populate from
  `c.interaction` in `buildDiscoverablePois`. deps: none. First test: producer
  test asserts each POI carries its content's `c.interaction`.
- T2 (backend) — Split `openPoi` input from snapshot: `OpenPoiInput` (optional
  `interaction`) vs enriched `OpenInfo` (required `interaction`, `guessChoice`,
  `bodyUnlocked`). deps: none. First test: `openPoi` without `interaction` defaults
  snapshot `open.interaction` to plain.
- T3 (backend) — `openPoi` sets a fresh `OpenInfo` per open (guess locked, others
  unlocked). deps: T2. First test: guess → `guessChoice` null/`bodyUnlocked` false;
  plain/highlight → unlocked.
- T4 (backend) — Derive `bodyUnlocked` in `set()` like `completed`; `getSnapshot`
  cached-reference, zero per-frame allocation. deps: T3. First test: flag
  recomputed by `set()`, never written by a caller.
- T5 (backend) — Add `answerGuess(choice)`: no-op when nothing open / non-guess /
  never throws; idempotent early-return; else set new open + records index only.
  deps: T4. First test: `answerGuess(2)` sets choice 2 + unlocked; no-op cases
  stable via `Object.is`.
- T6 (backend) — Structural per-open reset (close nulls open; re-open fresh; no
  module-level variable). deps: T5. First test: commit→close→reopen same id locks;
  open different id resets; no leakage between two stores.
- T7 (backend) — Pass `nearest.interaction` at `DiscoverySystem.ts` line 76 only.
  deps: T2. First test: drive system reveal; assert `open.interaction.type === 'guess'`,
  no-interaction POI reveals plain.
- T8 (quality) — Verify the three literal fixtures stay green (no TS2741) and the
  13 `openPoi` call sites are unmodified except line 76. deps: T1, T7. First test:
  `npm test` + `npm run build` green; grep call sites.
- T9 (quality) — Full headless Vitest table + read-path invariants (reference
  stability via `Object.is`, no per-frame allocation). deps: T6, T7. First test:
  two consecutive `getSnapshot()` return identical reference; idempotent
  `answerGuess` stable.

## Implementation summary

- T1 — Added optional `interaction?: PoiInteraction` to `DiscoverablePoi`,
  populated from `c.interaction`. Tests added to `content.test.ts`. Commit `61a76ee`.
- T2 — Added `OpenPoiInput {id,order,title,body,interaction?}`; enriched snapshot
  `OpenInfo` with required `interaction` (defaulting to plain), `guessChoice`,
  derived `bodyUnlocked`. Two direct `OpenInfo` literals in
  `discoveryAnnounce.test.ts` updated. Commit `970b850`.
- T3 — Per-open fresh `OpenInfo` (guess locked, plain/highlight unlocked); three
  cases added to `discoveryStore.test.ts`. Commit `219d35c`.
- T7 — Wired `nearest.interaction` into the `openPoi` call at `DiscoverySystem.ts`
  line 76 (only production line touched); two integration tests in
  `discovery.test.ts`. Commit `c02ffa5`.
- T4 — Moved `bodyUnlocked` into the `set()` derive path alongside `completed`;
  added minimal `answerGuess(choice)`; `getSnapshot` cached-reference. Commit `0d71b97`.
- T8 — Verification only (read-only). Gates green; three literal fixtures green
  with zero edits; only `DiscoverySystem.ts:76` changed among call sites. Flagged
  that the committed diff exceeds the four-file fence (sibling-task test files +
  docs), all additive. No commit.
- T5 — `answerGuess` already present; added named T5 tests (AC2 + AC4 incl.
  `Object.is` stability). Commit `f29384c`.
- T6 — Added structural-reset test block (close/reopen same id, different id, two
  independent stores). No production edit needed. Commit `0d7bd73`.
- T9 — Added read-path-invariant test block (reference stability, idempotent
  `answerGuess`, different-choice new reference, highlight no-op). Suite 253 passed.

Files touched:
`/Users/nsos/Documents/Workspace/AboutMeGame/src/discovery/discoveryStore.ts`,
`/Users/nsos/Documents/Workspace/AboutMeGame/src/content/discoverablePois.ts`,
`/Users/nsos/Documents/Workspace/AboutMeGame/src/discovery/DiscoverySystem.ts`,
`/Users/nsos/Documents/Workspace/AboutMeGame/src/discovery/discoveryStore.test.ts`,
plus sibling-task test files (`content.test.ts`, `discovery.test.ts`,
`discoveryAnnounce.test.ts`).

## Verification result

- Tests: PASS — 253 tests across 43 files green.
- Build: PASS — `tsc --noEmit` + `vite build` green; no TS2741.
- Code review: PASS.
- UX review: PASS — headless slice, no user-facing surface by design;
  `RevealPanel.tsx` intentionally untouched (AC6). The guess-then-reveal UI,
  states, and accessibility (focus management, screen-reader announcement,
  keyboard operability, locked-body affordance) land in slice 3 and must be
  UX-reviewed there.
- Gaps noted: minor scope-fence deviation — the diff edits three test files
  beyond the four named (plus docs); the `discoveryAnnounce.test.ts` edit was
  forced (it constructs a full `OpenInfo` literal needing the three new fields)
  and is a non-behavioral fixture update.

## Ship

- Branch: `test/discovery-guess-reset-structural`
- PR: https://github.com/NikolajMosbaek/AboutMeGame/pull/109
- Merged: yes
