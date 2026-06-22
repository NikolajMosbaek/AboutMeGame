# How I Work With Claude — Discoverable Content

> The payload for **AboutMeGame** (issue #35). The player drives and flies around a small world; each
> point-of-interest below is a landmark they discover. **Teaser** shows on approach; **body** is revealed
> on interaction. First-person voice (Nikolaj). Machine-readable copy lives in
> [`working-with-claude.json`](./working-with-claude.json); evidence for every claim is in
> [`PROVENANCE.md`](./PROVENANCE.md).

A newcomer meets these in order: who you've met → how I think before building → my standout trait →
my quality bars → my mechanics → a self-referential reveal.

---

## 1. The Arrivals Gate
*Landmark: a welcome plaza at spawn — a signpost reading "Nikolaj", a Danish flag pennant, a stylized iPhone-shaped monolith, and a forking road.*

**Teaser:** Hi, I'm Nikolaj. I work in iOS and Swift — drive on, I'll show you how.

Welcome to the spawn point. I'm Nikolaj, and I work in iOS and Swift. See that .dk on my email? That part's real — it's the one solid clue to where I am, so odds are I'm somewhere in Denmark. These days I don't code alone: I build hand-in-hand with Claude Code, using a toolkit I carry from project to project. The road forks ahead, and most of what's out there is how I actually work. Pick a direction and go meet it.

## 2. The One-Sentence Overlook
*Landmark: a clifftop overlook with a single carved stone tablet; the whole valley of the build laid out below.*

**Teaser:** One sentence before I touch anything. If I can't write it, I don't understand the work.

Before I touch a single file, I make myself say the intended end state in one sentence. It forces me to name what the change is actually for, and it catches scope drift before it starts. If the sentence won't come, that's the signal: I don't understand the work yet. And if the build goes sideways halfway down, I stop right there and re-plan instead of pushing through.

## 3. The Session Foundry
*Landmark: an assembly line cutting a giant "EPIC" ingot into story-bricks stamped with acceptance criteria, linked by dependency chains, rolling onto a "Todo" conveyor.*

**Teaser:** I don't size work for a human afternoon. I size it for one AI session.

Watch the EPIC ingot get cut. Most people slice work for a person; I slice it for an agent. Each billet comes off the line sized to ONE focused AI session, stamped with its own acceptance criteria, chained by "Blocked by #X" links, and tagged with the files it'll likely touch. They land as native GitHub sub-issues, labelled and ready to grab. The point: an agent can pick up any single piece and verify it alone. The medium is the message — this whole world is built that way.

## 4. The Staff-Engineer Gate
*Landmark: a toll gate guarded by a stern "Staff Engineer"; a turnstile that only turns when test output is shown.*

**Teaser:** "Tests pass" is a receipt, not a claim. Show me the run, then we talk.

No work clears this gate on my word. "Wired up," "tests pass" — those aren't things I say, they're things I prove. I run it, then cite the actual build or test output: the receipt, not the claim. Reading the code isn't enough — I check the logs and diff against main before I call anything done. Every change meets one question at the turnstile: would a staff engineer approve this? If not, it doesn't ship.

## 5. The Root-Cause Quarry
*Landmark: a deep quarry where the path follows a crack to its source; one chamber finished immaculately, the surrounding rock untouched.*

**Teaser:** I chase the crack to its source — no surface patches, no widening the dig.

Notice the path? It follows the fault line straight down, past every spot I could've just plastered over. I dig to the actual cause and change only what that demands — no temporary fixes, every edit as simple as it can be. The chamber I'm working in, I finish properly: the code that should exist, not the smallest possible patch. But I don't blast into the rock next door — a fix addresses the stated issue, not adjacent code or some problem I'm only imagining.

## 6. The Autonomous Debug Lab
*Landmark: a detective's workshop wired to live log feeds and red failing-test lights; a "reject" bin for non-issues and a banner: "a comment is not a fix."*

**Teaser:** Point me at logs, errors, a failing test — I'll hunt the bug down solo.

Hand me a bug report and I'll chase it through the logs, errors, and failing tests on my own — no hand-holding. But first I push back: every issue gets sorted into Fix, Skip, or Modify, because a reported bug isn't automatically a real one. If something's ambiguous, I ask before I touch a line. And no cosmetic fake-fixes — a comment isn't a fix. If it needs a guard, it gets a guard. The aim is the root cause, with the smallest blast radius that closes it.

## 7. The Calibrated Review Tower
*Landmark: a lighthouse whose beam lights only what's really there; a dial from "nit" to "critical", a stamp marking unconfirmed sightings "needs verification".*

**Teaser:** The beam lights only what's really there — and the alarm is sized to fit.

When I review your code, I only flag what I can actually verify against the code in front of me. If I can't confirm it, I don't assert it — I stamp it "needs verification" and say so out loud. Severity matters too: I tune the alarm to the real impact, with no five-bell klaxon for a marginal gain. Calibrated beam, honest stamp. That's the whole tower.

## 8. The Force-Push Dam
*Landmark: a dam across the river of git history; normal pushes flow through, force-pushes slam into a steel sluice gate stamped "BLOCKED".*

**Teaser:** Regular pushes flow right through. Force-pushes slam into a wall I built and can't breach.

I never rewrite published history, and I don't trust memory to enforce it. So I wired the rule into the harness: a PreToolUse hook inspects every git push and kills the command the moment it spots a force flag, printing BLOCKED before anything reaches origin. Normal pushes sail straight past. It's belt-and-suspenders too — the same rule lives in my global config and is restated in my create-pr skill. The one rule I literally can't break.

## 9. The Walkthrough Station
*Landmark: a guided-tour platform with a route map showing the reading order (contracts → implementation → tests) and hazard markers on risk hot spots.*

**Teaser:** My pull requests arrive with a guided tour, not a changelog.

Step onto the platform and I'll hand you the route map. Every PR I open ships a walkthrough written from the actual diff, not the commit subjects: a change map, then a reading order — contracts first, implementation next, tests last — so you understand the change without cold-reading it. The hazard markers flag the real risk: wire and storage boundaries, concurrency, behavior hiding in small diffs, migrations. And if the diff contradicts its own description? That mismatch is the most important thing I'll flag.

## 10. The History Rail Yard
*Landmark: a rail yard recoupling messy boxcars into clean logical trains; a "why" placard on each, a safety inspector checking nothing fell off, AI co-author badges riveted on.*

**Teaser:** Messy boxcars roll in, clean logical trains roll out — nothing left behind.

Before a PR goes up, I recouple the mess into logical trains: bug fix, feature, refactor each on their own track, never mixed. Every message carries a "why" placard, not a manifest of every file changed. I stage exactly what changed (no git add -A), keep the Co-Authored-By trailers riveted on, then run the safety check, diffing old HEAD against new. If anything fell off, it didn't ship. And I never force-push over published history.

## 11. The Seam Gardens
*Landmark: formal gardens where paths fork only at real boundaries; plants grafted onto swappable DI rootstock; a gardener uprooting any dead branch grep finds has no caller.*

**Teaser:** Every plant grafts onto swappable roots — and once a branch has no caller, it's uprooted.

Nothing here is fused to the ground. I graft onto dependency-injection rootstock, never a singleton, so tests and previews can swap the soil out under any plant. My paths only fork at real boundaries — state, layout, controls — never some arbitrary fake-versus-real lever. And the dead wood? Once grep proves a branch has no caller, I uproot it. Even my beds come in two: one I tend by hand and pause for your eyes, one I let run on its own. A real fork, never a flag.

## 12. The Portable Toolkit Workshop
*Landmark: a workshop wall of labelled reusable jigs (each SKILL.md a hanging tool), a crate stamped "ported from mjolner-ios", isolated .worktrees workbenches, GitHub and Azure DevOps badges by the door.*

**Teaser:** I don't re-improvise my workflow every time. I codify it, then carry the kit.

Look at the wall: nine labelled SKILL.md jigs I wrote and reuse, not one-off prompts — create-pr, list-prs, squash-commits, walkthrough, main-digest, worktree, set-title, and a two-speed fix-issues pair, one that pauses for review and one that auto-commits. The crate's stamped "ported from mjolner-ios," because durable tooling travels. Each job runs in its own isolated worktree under .worktrees/, never touching the main one, so they can't contaminate each other. And both badges by the door light up: this kit reaches GitHub and Azure DevOps alike.

## 13. The Hall of Mirrors
*Landmark: a mirror hall at the map's edge reflecting the whole world back; behind the glass, the story-bricks and PR walkthroughs that built it. The exit loops back to the Session Foundry.*

**Teaser:** One last thing — this world is being built the way I just showed you.

Look behind the glass. This world is built exactly the way I just described it. Work decomposed into AI-sized stories, each scoped so an agent can pick up any slice and verify it alone — then fixed, reviewed, and merged with Claude Code, the same epics-to-stories pipeline you just toured. And the guardrails? Not willpower — wired in. A hook physically blocks a force-push; the agent can't rewrite published history even if it tried. The medium is the message. Exit loops back to the Foundry.
