# Content Provenance — "How I Work With Claude" (issue #35)

This file records **where every claim in the content came from** and **what was deliberately left out**.
Because this content is about a real person, the rule was: each concrete statement must trace to verifiable
evidence (the actual `.claude` config, git metadata, or directly-observed behaviour) — never invented.

## Evidence sources

| # | Source | Confidence of facts drawn from it |
|---|--------|-----------------------------------|
| A | Project `.claude/CLAUDE.md` — Workflow Principles, Code Review Discipline, "Don't" rules | **High** (verbatim, read directly) |
| B | `.claude/rules/commit-and-pr-prefixes.md` — Conventional Commits + PR conventions | **High** |
| C | `.claude/settings.json` — PreToolUse force-push hook, GitHub plugin | **High** |
| D | `.claude/skills/*` — the 9-skill toolkit (create-pr, list-prs, squash-commits, walkthrough, main-digest, worktree, set-title, fix-issues ×2) | **High** |
| E | Global `~/.claude/CLAUDE.md` — never-force-push, Azure DevOps PAT | **High** |
| F | **This session, directly observed** — broke epics into AI-sized stories; reframed granularity around "solving these stories will be AI-driven" | **High** |
| G | Environment — Axiom iOS skills, Point-Free Swift skills, superpowers, GSD; toolkit "ported from mjolner-ios" | **High** (practice signal) |
| H | Meta — AboutMeGame is itself being built AI-first via this pipeline | **High** |
| I | Biography — LinkedIn `/in/nikolaj-mos` (login-walled, HTTP 999); web snippet (unverified); git/email metadata | **Low** |

## Per-POI grounding

Every POI cites at least one **high**-confidence card; medium/low cards only ever appear as supporting
colour, never as a POI's sole basis. Full card text (claim + verbatim quote + source) is preserved in the
workflow output.

| POI | Theme | Key evidence | Lowest confidence used |
|-----|-------|--------------|------------------------|
| 1. The Arrivals Gate | Intro / who | first-name-nikolaj (H), ios-swift-developer (M), email-foss-dk (M) | low (location → hedged to ".dk") |
| 2. The One-Sentence Overlook | Plan before building | state-end-state-before-editing (H), stop-and-replan (H) | high |
| 3. The Session Foundry | **AI-first decomposition (standout)** | ai-first-planning-observed (H), story-sized-to-one-ai-session (H) | high |
| 4. The Staff-Engineer Gate | Verify before done | verify-before-declaring-done (H), cite-build-test-output (H) | medium (self-description) |
| 5. The Root-Cause Quarry | Minimal-impact / root cause | minimal-impact-root-causes (H), shape-from-scratch-inside-touched-files (H) | high |
| 6. The Autonomous Debug Lab | Autonomous debugging | autonomous-bug-fixing (H), no-fake-fixes (H), ask-before-ambiguous (H) | high |
| 7. The Calibrated Review Tower | Review discipline | review-only-verifiable-issues (H), calibrate-severity (H) | high |
| 8. The Force-Push Dam | Harness-enforced guardrails | force-push-hook-enforced (H), force-push-hook-mechanism (H) | high |
| 9. The Walkthrough Station | PR-as-communication | create-pr-walkthrough-not-changelog (H), reading-order-contracts-first (H) | high |
| 10. The History Rail Yard | Clean git history | clean-history-squash (H), never-lose-code-safety (H), commit-why-not-what (H) | high |
| 11. The Seam Gardens | Architecture taste | dont-singletons-global-state (H), prefer-component-over-mode-flag (H) | high |
| 12. The Portable Toolkit Workshop | Reusable skill toolkit | project-skills-verified (H), portable-skill-toolkit (H), worktree-isolation (H) | high |
| 13. The Hall of Mirrors | The meta | game-built-ai-first-meta (H), guardrails-enforced-not-disciplined (H) | high |

## What was deliberately NOT claimed (fabrication guardrails)

The adversarial fact-check phase dropped anything it couldn't ground. Notably:

- **No job title, role, seniority, employer-of-record, or tenure.** LinkedIn was unreachable and no config
  file contains a title. Any "Senior iOS Engineer at FOSS"-style line would be invention.
- **No employment claim about FOSS or Mjølner.** Only an email-domain association (`nsos@foss.dk`) and a
  commit noting the toolkit was *"ported from mjolner-ios"* are known — neither establishes employment.
- **Location is hedged, not asserted.** The only location evidence is a `.dk` email domain plus an unverified
  web snippet, so POI 1 says "odds are I'm somewhere in Denmark" and never names Copenhagen.
- **Surname kept out of player copy.** Git author metadata reads "Nikolaj Søgaard Simonsen" and the GitHub
  handle is "NikolajMosbaek", but these are self-controlled metadata, not independent identity proof, so only
  the first name appears.
- **No shipped-app or "builds iOS apps" claim.** Softened to "works in iOS and Swift" — a practice signal
  from the toolkit, since no iOS app exists in this repo.
- **Over-reaching factual claims trimmed**, e.g. the force-push rule is stated as living in the global config
  and the create-pr skill (true), not "every PR skill" (the `--force/-f` wording only appears in create-pr;
  other skills carry a different "never push to origin" line).

## Reconciliation note for #34

Field names (`teaser`, `body`, `worldZoneHint`, `tags`, `order`) are an interim draft. When the formal
content data model lands in #34, reconcile names/types there and treat `working-with-claude.json` as the
seed dataset.

## Authored interactions (M2 slice 3, #34)

Three POIs gained an interaction beyond the default `plain`. Each prompt,
option, and reveal is drawn **only** from that POI's already-verified `body`
copy (cards A/C in the table above) — no new claim is introduced, and the
correct option restates what the body already asserts.

| POI | Interaction | Grounding in existing body |
|-----|-------------|----------------------------|
| 4. The Staff-Engineer Gate | `guess` (3 options, 1 correct) | Correct: "citing the actual build or test output" = body's "I run it, then cite the actual build or test output: the receipt, not the claim." Distractors are the alternatives the body explicitly rejects ("things I say"; "reading the code isn't enough"). |
| 8. The Force-Push Dam | `guess` (2 options, 1 correct) | Correct: "a PreToolUse hook kills any push with a force flag" = body's "a PreToolUse hook inspects every git push and kills the command the moment it spots a force flag." Distractor "I just remember not to do it" is the approach the body rejects ("I don't trust memory to enforce it"). |
| 2. The One-Sentence Overlook | `highlight` (emphasis) | Emphasis is a verbatim lede lifted from the body: "If the sentence won't come, that's the signal: I don't understand the work yet." |

The `answerReveal` flavor lines paraphrase only the same body sentences. The
UI makes no correctness verdict this slice; `correct` is carried for a future
scoring slice (validated by `parseInteraction`). All other POIs stay `plain`.
