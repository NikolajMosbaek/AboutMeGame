# Embodiment & Tactility — Implementation Plan

> Executed inline (standing authority). Spec:
> `docs/superpowers/specs/2026-07-18-embodiment-design.md`.

**PR I — first-person hands.** `src/player/hands.ts`: `handPose(action,
progress01, reduced): {x,y,z,rotX,rotZ,fruitVisible}` pure + tests (idle
parked below view; drink/eat rise + settle; dig pumps; reduced = static
raise); `HandsSystem` (sources: survival snapshot for thirst edge, forage for
eaten edge, quest for digProgress, reducedMotion) building the procedural
arm and placing it from `ctx.camera` world transform; buildGame wiring +
dispose; tier-free (~60 tris, 1 draw call).

**PR II — panting + lens rain + close-out.** `AudioSystem`: stamina<20 &&
speed>0.5 → `breathe()` every 1.6 s (tests: repeats, stops on recovery, no
fire when idle); survival source gains stamina (already in snapshot).
`GameCanvas`: absolutely-positioned droplet overlay div, opacity =
`rain01 × 0.35` via the existing render loop hook or rAF effect; run log;
deploy + board close.

Global: zero asset bytes, test-first, review pass per PR, full gates.
