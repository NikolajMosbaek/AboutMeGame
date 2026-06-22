# Team run — Add a 3D graphics specialist agent

**Date:** 2026-06-22
**Trigger:** `/loop` (autonomous, effort `ultracode`) — "create an agent that is
specialized in 3D graphics. Research the requirement, the relevant skills (also
3rd party) and create the agent. You must make the decisions for me … afterwards
merge it into main."
**Driver:** root orchestrator, autonomous (no human gate). Decisions made on the
user's behalf per the autonomy doctrine; verified and shipped via PR.

## The decision (and why)

AboutMeGame is, post-pivot, a **Three.js 3D world** (`three ^0.169`, a custom
injectable `Engine`/`System` seam, terrain/world/perf layers). 3D-rendering work
was previously absorbed by `senior-eng-frontend`, which mixes two genuinely
different domains: the **React/DOM shell** (state, data flow, HUD) and the
**WebGL/GPU layer** (scene graph, materials, shaders, draw-call/fill-rate
budget). That is a real boundary, not a mode flag — the exact kind of split the
quality bar endorses. So: add a dedicated **`graphics-3d`** specialist.

Every agent in this repo is a first-class member of the `/team` harness; an
orphan agent nothing dispatches would read as dead weight. So `graphics-3d` is
both **directly invocable** (Agent tool, `subagent_type: graphics-3d`) and
**wired into the team** as a new `graphics` owner + roundtable member.

## What changed

- **`.claude/agents/graphics-3d.md`** (new) — Senior 3D Graphics Engineer.
  Grounded in this codebase's reality: the injected `Engine`/`System`/
  `RendererLike` seam (no singletons, headless-testable), the perf budget
  (≥30 fps mobile, ≤150 draw calls, ≤500 k tris, ≤400 KB gz JS, ≤6 MB, ≤4 s
  TTI), the asset pipeline (`assetUrl`, cached loaders), the low-poly/
  flat-shaded/vertex-coloured art direction, and the low/medium/high quality
  tiers. Carries a codebase playbook (thin GPU wiring + pure-logic tests,
  draw-call discipline, dispose hygiene, no per-frame garbage, sparing shaders)
  and a vetted third-party list weighed against the JS budget.
- **`.claude/workflows/team.js`** — added `graphics` to the `PLAN_SCHEMA` owner
  enum, `graphics → graphics-3d` to `OWNER_TO_AGENT`, `graphics-3d` to
  `ROUNDTABLE`, and a routing hint in the Plan-phase prompt.
- **`.claude/agents/tech-lead.md`** — `graphics` added to the In-Plan owner list
  with a routing note (Three.js/WebGL/GLSL/rendering → `graphics`).
- **`.claude/agents/senior-eng-frontend.md`** — lens now states the boundary
  explicitly: it owns the React/DOM shell, **not** the WebGL canvas.

## Skills & third-party research (the "relevant skills, also 3rd party" ask)

- **In-repo skills / tools** the agent leans on: `develop-web-game` (Playwright
  implement→observe loop), `game-development` (principles/routing),
  `scripts/verify-game.mjs` + `render_game_to_text` for visual verification, and
  `Engine.getState()`/`StatsOverlay` for live draw-call/triangle/fps truth.
- **Third-party libraries** the agent may reach for, each justified against the
  ≤400 KB gz JS budget (offline tools preferred — zero runtime cost):
  `three/examples/jsm` addons (GLTFLoader, DRACOLoader/KTX2Loader, OrbitControls,
  EffectComposer, BufferGeometryUtils), `three-mesh-bvh` (fast raycast/collision),
  `troika-three-text` (in-world SDF text), `postprocessing` (pmndrs), and
  `gltf-transform`/`meshoptimizer` (build-time asset optimisation).
- No third-party *Claude Code* 3D-graphics skill/plugin was applicable — the
  installed Axiom skills are iOS/Metal and the pfw skills are Swift; neither fits
  a TypeScript + Three.js + Vite web target.

## Verification

- `npm test` (172 pass), `npm run build` (JS gz ≈ 190 KB, inside budget), and
  `npm run lint` are all green — but note the entire diff lives under `.claude/`
  and `docs/`, which sit **outside** both the vitest include path
  (`vite.config.ts` excludes `**/.claude/**`) and the eslint ignore set
  (`eslint.config.js` ignores `.claude/**`). So the green suite confirms only
  that `src/` was not regressed; the harness wiring itself is validated by
  inspection + the adversarial review below, not by the automated gates.
- **Adversarial review (ultracode):** a 3-lens pass (Three.js factual accuracy ·
  repo-consistency · staff-engineer role-clarity) confirmed the wiring is
  internally consistent, every Three.js API named is correct for r0.169, and the
  third-party libs are real. Its real findings were applied: the agent was
  trimmed toward sibling length (folded the budget numbers into Grounding, cut
  constitution-duplication, condensed the third-party section, fixed
  `@gltf-transform/core`'s package name) and the inline `three` gz figure was
  dropped in favour of citing `docs/perf-budget.md`.
- `/team` was **not** run: it spawns a full team with auto-merge — out of scope
  for "create the agent," and expensive.

## Guardrails honoured

Branch isolation (`feat/graphics-3d-agent` → PR → `main`), green-only merge, no
force-push, this audit trail.

## Operational caveat

Per `docs/team/README.md`, role agents register at **session startup**. A
`/team` run that routes to `graphics-3d` must be a **fresh session** after this
merges, or dispatch fails with `agent type 'graphics-3d' not found`.
