# Run log — 2026-07-08 — Full product pivot: The Lost Idol

## Intake

Direct user directive (verbatim intent): *"I don't like the game so you must start
over. Create a new game from scratch. It should be a game where you are an explorer
in the jungle. You find clues which will lead you to a treasure. There must be
water, animals, game mechanics like the need to eat and drink to survive. Make it
as realistic as you possibly can. […] You are in charge and must build this game
without my input. I expect to be impressed. You are finished when the game is
running on the website and you deem it worthy."*

This outranks the charter's previous vision and the pre-pivot board ordering.

## Decisions

1. **"From scratch" = the game, not the toolchain.** The Three.js engine seam,
   terrain/noise/water/day-cycle pipeline, discovery-store idiom, procedural audio
   engine, perf budgets and CI gates (lint/type/test/bundle/social/render/smoke +
   Pages deploy) are precisely what the new game needs. Rebuilding them would burn
   the run on undifferentiated chassis work. Every player-facing system is
   replaced.
2. **Integration branch `jungle`.** The live site keeps serving the old game until
   the new one is complete and worthy; slice PRs target `jungle`; the final
   `jungle`→`main` PR flips the site atomically. This honours branch isolation +
   green-only merge while never deploying a half-pivoted hybrid.
3. **First-person on foot.** Maximum immersion per polygon; no character model
   needed; the existing follow-camera/vehicle stack is retired.
4. **Clues are readable text that locate the next site by landmark description** —
   navigation by reading the world, not chasing markers. Only the final dig is
   gated on all five clues.
5. **Survival tuned to teach, not punish** — death respawns at camp with quest
   progress kept.
6. **Design spec:** `docs/design/2026-07-08-the-lost-idol-design.md` (binding).
   Slices A–I defined there; one issue/branch/PR each.

## Verification plan

Every slice: Vitest suite + lint + typecheck + bundle gate locally and in CI on the
PR. World-visible slices: `npm run verify` (build → preview → readiness → Playwright
smoke + screenshot) before merge. Ship gate (final): full-suite green on `jungle`,
code-review + UX review of the running build, live-site check after the `main`
merge.

## Trail

- Design doc + charter rewrite: this slice (A).
- Slice PRs: recorded below as they land.

| Slice | PR | Result |
|---|---|---|
| A — pivot docs | (this PR) | — |
