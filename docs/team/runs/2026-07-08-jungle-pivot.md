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
| A — pivot docs | #185 | merged |
| B — first-person explorer | #186 | merged (review: mirrored look/strafe caught & fixed pre-merge) |
| C — jungle world + sites + clue chain | #187 | merged (review: stale-save leak, palm mirror, clue bearing, bloom no-op — fixed) |
| D — survival core | #188 | merged (review: sprint-gate duplication, death-key handling — fixed) |
| E — foraging | #189 | merged (review: InstancedMesh GPU leak, biased fbm sampling — fixed) |
| F — wildlife (graphics-3d agent) | #190 | merged (review: fish flee facing, getPhase coverage — fixed) |
| G — treasure quest | #191→#192 | merged (review: one-frame dig race — fixed) + hotfixes #193/#194 (MOB guards) |
| H — jungle audio (sound-engineer agent) | #195 | merged |
| I — identity (frontend agent) | #196 | merged |
| copy fix — reveal/journal pages | #197 | merged |

## Decisions made during the run

- **Pick-and-eat replaces the 1-slot inventory** (slice E): tighter loop, same
  survival pressure — the jungle is the larder, planning is routing.
- **Panels pause ALL decay** (slice D review): reading a clue is thinking
  time, not a starvation exploit; nothing else progresses while paused either.
- **Beacons/tower-lamp retired without replacement pillars** (slice C): the
  clue texts navigate. Their bloom role passed to site accent glints, then
  fireflies (slice F) and the idol (slice G).
- **verify-game --completion-panel retired loudly** (slice G): completion
  became the dig — a journey no smoke run should fake; win-screen behaviour is
  pinned by jsdom tests.
- **Old saves invalidated** (slice C review): discovery persistence key bumped
  to v2 + id filtering in both consumers.

## Process notes (honest ledger)

- Two merges initially went through with red gates because suite exit codes
  were piped through grep/tail (slices G/#192 and hotfix #193). Caught within
  minutes by CI + re-run; fixed forward in #193/#194 and the practice changed
  to unmasked `EXIT=$?` checks for every gate command thereafter.
- Subagent worktrees under `.claude/worktrees/` trip the 9 runlog-path tests
  (they assert no `.claude` in the repo path) — a known environment artifact,
  green on real checkouts and CI.

## Deferred (recorded, not hidden)

- `public/social-preview.png` still shows old-game art (image asset pass).
- On-device mobile verification (charter standing policy): touch controls,
  safe-area and iOS audio are covered by jsdom/Playwright-desktop only — not
  yet proven on a physical phone; flagged per the charter's "never a silent
  pass" rule.
- The reveal footer's optional "next landmark" selector naming survives in
  internal comments only.
