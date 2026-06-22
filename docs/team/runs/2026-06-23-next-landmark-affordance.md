# Run: M2 slice 4 — In-panel "Next landmark →" affordance

## Feature

M2 — Make the Reveal Interactive (slice 4): close the open M2 acceptance
criterion by adding an in-panel **"Next: &lt;title&gt; →"** affordance that closes
the current reveal and names the next-undiscovered-by-order POI, plus a pure
headless selector behind it. **Zero engine, navStore, NavSystem, GPU, or audio
change** — the slice lives in `src/discovery/` (the pure selector) and `src/ui/`
+ the `GameCanvas` data seam (the button and its one new prop wire).

## Auditable decision — AC2 "steered/highlighted target" (binding)

> **T8: record the auditable AC2 reinterpretation in the run log.**

The decider reinterpreted AC2 to the only thing the codebase can honour without
crossing the forbidden engine seam, and records it here so the ship gate judges
green against the selector return value + button label, **not** a non-existent
steering pipeline.

**Why a reinterpretation is required (verified against source).** `NavSystem`
projects *every* undiscovered POI's marker equally each frame; `navStore` /
`NavMarkers` carry **no** single-target / highlight / focus concept; and the
brief forbids adding one or touching the per-frame projection (AC6: no change to
`NavSystem` per-frame projection, the `navStore` snapshot contract, the
`DiscoverySnapshot` shape, `src/audio/*`, or any renderer/System/shader). A
literal "steer/highlight one target" reading is therefore **unsatisfiable in
this slice** and directly contradicts AC6. This decision resolves the
AC2-vs-AC6 contradiction **in favour of AC6** (no engine change).

**Definition adopted for this slice.** "Steer toward / highlighted target" is
DEFINED as:

1. the pure selector **names** the next-by-order undiscovered POI;
2. the button is **labelled with that POI's title** — `"Next: <title> →"` — so
   activating it is a deliberate, named move toward a specific landmark; and
3. closing returns the player to the world where **that POI's existing nav
   marker is already live** (no new marker, no new cue).

**No new highlight / focus / steering pipeline exists or is created.** "Next" is
not behaviourally identical to "Drive on": *Drive on* is an unnamed dismiss;
*Next* names and is conditioned on a concrete next target (it is absent when
there is no valid next). This is the in-scope reading the brief itself sanctions
("leverages the existing journey order, does not add a per-POI focus pipeline").

**The single observable contract a verifier may assert** (the only assertable
"steer"):

- (i) the selector's return value **equals** the expected next-by-order POI, and
- (ii) the button text **contains** that POI's title.

**No test may assert a new "this one is steered" visual state, because none
exists.** The ship gate judges green against the selector return value + button
label only.

## Pinned algorithm — cyclic successor (one, not two)

The selector `nextUndiscovered(pois, discoveredIds, currentId, currentOrder)`
lives at `src/discovery/nextUndiscovered.ts` — framework-agnostic, no
THREE/WebGL/React import. ONE algorithm:

1. Sort `pois` ascending by `order` (defensively — do not trust JSON array
   order); break ties on `id` for determinism.
2. Exclude `currentId` **and** every id in `discoveredIds`.
3. Return the first remaining POI with `order > currentOrder`; if none, **WRAP**
   to the lowest-order remaining.
4. Return `null` only when no other undiscovered POI exists.

The AC's phrase "wrap from highest to lowest remaining" is the wrap branch of
exactly this function; the "lowest-order undiscovered" reading was ambiguous and
is **rejected**. Pinned vectors: mid-journey (current=3, others undiscovered →
4), just-after-current (next contiguous), wrap (current highest → lowest
remaining), all-discovered → null, and the load-bearing "current id already in
`discoveredIds`" case.

## Reconciled discover-on-open timing

`DiscoverySystem` adds the POI to discovered **and** calls `setDiscovered` in the
same frame as `openPoi`, so while the panel is open the current id is **already**
in `discoveredIds`. The selector therefore takes `currentId`/`currentOrder`
EXPLICITLY and excludes the current id **independently** of `discoveredIds`. It
never infers "undiscovered = complement of `discoveredIds`" for the current POI.
Consequence: "hide Next on the last landmark" reduces to "the selector returned
null" — no off-by-one, no count comparison, no `snap.completed` dependency.

## The one new data wire

The selector needs the full ordered POI set, which the discovery snapshot does
not carry. `GameCanvas` already holds `game.discovery.pois` and already passes it
to `CompletionPanel`. The **same** value is wired into `RevealPanel` as a new
immutable prop `pois: { id: string; order: number; title: string }[]` — a
minimal projection, mapped at the `GameCanvas` seam. `RevealPanel` never imports
content or `navStore`; the prop is injected (testable), not globally imported.

## Visibility & keyboard contract

- "Next" is a native `<button type="button">` in a `.reveal-panel__actions`
  footer, placed **AFTER** "Drive on" in DOM/tab order, reusing existing `.cta`
  tokens (≥44px hit target, visible focus ring). The focus-on-open effect is
  unchanged (guess → first option; plain/highlight → close button).
- Rendered ONLY when the selector returns non-null **AND** `open.bodyUnlocked` is
  true. For an unanswered guess it is **absent (not disabled)** — every rendered
  "Next" is a real, focusable, operable button, satisfying AC4 cleanly (a
  disabled button drops out of tab order and some SRs skip it). "Drive on" is the
  always-present escape during a locked guess, so there is no footer dead end.
- On activate, "Next" calls ONLY `store.closePoi()` — it never mutates the
  discovered set, reveals/commits a guess body, teleports, or pokes
  `NavSystem`/`navStore`/audio. Forward-nav is unreachable until the body is
  unlocked, so it cannot bypass an unanswered guess's payload; even when present
  it only closes, so it shows no payload.
- The existing exact focus-order assertion in `RevealPanel.test.tsx` is updated
  in the same diff to `[optionA, optionB, close, next]` for the unlocked-guess
  case — an in-scope test update, not a regression.

## Scope

`src/discovery/nextUndiscovered.ts` (+ test), `src/ui/RevealPanel.tsx` (+ test),
and the `src/engine/GameCanvas.tsx` prop seam (+ test). No change to NavSystem
per-frame projection, the navStore snapshot contract, the DiscoverySnapshot
shape, `src/audio/*`, or any renderer/System/shader.
