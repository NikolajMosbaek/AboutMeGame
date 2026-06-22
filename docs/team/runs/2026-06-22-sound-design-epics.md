# Run log — Sound design: research & define epics (2026-06-22)

> **Type:** research + definition only. **No code written.** Outcome = epics +
> sub-issues in GitHub + the Sound track recorded in `docs/team/backlog.md`.
> **Roles:** sound-engineer (technical audit + candidate epics), Product Owner
> (value/scope/priority + final set). Orchestrated from a `/loop` request.

## Brief

> "Research and define epics to improve the sound design in the game. The outcome
> should be relevant epics and subissues in the GitHub project. No code yet."

## Positions

**Sound Engineer (audio-layer owner) — technical audit.** Verified the whole audio
surface: `src/audio/AudioEngine.ts` (procedural Web Audio, injected `ctxFactory`,
no singleton, voices → one master gain → destination; SFX chime/whoosh/boost +
two-pad ambient drone) and `AudioSystem.ts` (event→engine glue). Confirmed the
budget: audio ships **0 asset bytes** (everything synthesised; `npm run build`
~191 KB gz JS, well under the 400 KB cap; `public/assets/audio/` is empty). What's
good and must not regress: DI seam, no-singleton, headless-testable, click-free
mute that also suspends the context, clean teardown, allocation-free `update()`.
Gaps found (G-A…G-J): no volume control (mute-only), no SFX/music bus split, no
limiter (stacked voices can clip), no ducking, **no audio payoff for the shipped M1
completion arc** (13/13 replays the ordinary chime), no continuous speed/engine
sound, no UI/menu cues, no spatial audio, and three mobile-Safari survival gaps
(iOS silent switch mutes Web Audio; `installAudioResume` is one-shot/self-unbinding
so an interrupt isn't recovered; `visibilitychange` resumes the loop not the
context). Proposed 4 active epics + 1 deferred.

**Product Owner — value/scope/priority.** Endorsed the engineer's count and split
(disciplined, value-first) with adjustments on the value/scope axis only: cut per-bus
UI sliders from S1 (ship one master volume; YAGNI); split S2 along its dependency
line (M1-ready completion sting must not be held hostage by queued M2's UI cues);
hard-capped UI cues at 2–3; made S3's "ship silence over an annoying drone" a ship
rule, not advice; filed S5 as a labelled deferred stub rather than losing it to
scratchpad; recorded the sound-on-by-default default as a deliberate decision +
filed the policy call to ux-lead.

## Converged design — the Sound (S\*) track

| Epic | Theme | Priority | Depends on |
|------|-------|----------|------------|
| **S1** #86 | Mix backbone: buses, limiter, volume, ducking | **do first** | none (0-byte, zero-dep) |
| **S2** #87 | Reward & UI feedback: completion sting + cues | second | S1; shipped M1; queued M2 (cues) |
| **S3** #88 | World in motion: speed-reactive wind/engine | third (feel) | S1; `vehicle.state.speed`; reduced-motion |
| **S4** #89 | Mobile-Safari survival: silent-switch + interrupt | parallel | independent |
| **S5** #90 | Spatial landmark wayfinding (DEFERRED stub) | — | graphics-3d `AudioListener` seam |

**Sequencing:** S1 → S2 → S3, S4 in parallel, S5 deferred.

## Decisions

- **G-J / sound-on-by-default:** default stays `muted:false` (sound ON). No WCAG
  1.4.2 issue today (context suspended until a gesture; mute + S1's new volume make
  the >3 s bed controllable). Recorded as a deliberate decision in S1; the actual
  policy call is **ux-lead's**, filed as **#91** (no code unless ux-lead flips it).
- **S5 spatial:** created as a deferred backlog stub (**#90**, no sub-issues), not a
  pullable epic — only feature with genuine audio-thread risk, depends on the
  graphics-3d camera seam, unproven value over nav markers.
- **Hard constraints on every epic:** stay procedural (0 asset bytes; S4's silent
  loop is a data-URI = 0 download bytes); DI / no-singleton / headless-testable;
  click-free ramps; no per-frame allocation; never autoplay before a gesture; audio
  never the sole channel for critical info.

## Outcome — created in GitHub (NikolajMosbaek/AboutMeGame)

- **Epics (`epic` label):** #86 S1, #87 S2, #88 S3, #89 S4, #90 S5 (deferred stub).
- **Stories (`story` label), natively linked as sub-issues:** S1 → #92–#96;
  S2 → #97–#100; S3 → #101–#104; S4 → #105–#107 (16 total).
- **Policy issue (`question`):** #91 (ux-lead, sound-on-by-default).
- All 22 added to the **AboutMeGame** project board (project #2).
- `docs/team/backlog.md` gains a **Sound** track + sequencing footer.

## Verification

- 22 issues created and confirmed (epics #86–#90, policy #91, stories #92–#107).
- 16 sub-issue links created via the GitHub sub-issues API (all reported success).
- 22 items added to project #2.
- No source code changed (deliverable is definition only); the two doc files
  (this log + the backlog Sound section) land via a feature branch + PR, never
  direct to `main`.
