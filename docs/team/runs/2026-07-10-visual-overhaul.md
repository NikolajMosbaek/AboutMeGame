# Run log — 2026-07-10 — Visual overhaul

## Intake

Owner directive (verbatim intent): *"I'm still not happy with the graphics. … research what
it takes for you to do a MAJOR graphics update in every way. The requirements are simply:
1. It must be free. 2. You can do it without any input from me."* Followed by: *"go ahead
and do the full upgrade."*

## Research summary (grounds the design)

Stack inventory (agent sweep, 2026-07-10): game is 100% procedural — every material
`MeshStandardMaterial` flat-shaded/vertex-colored, zero shipped texture/model binaries,
one directional + one hemisphere light, gradient-shader sky dome, two-sine water patch,
bloom-only compositor (three-examples chain), three ^0.169. Budget headroom: 216 KB of
400 KB JS gzip; ~0.25 MB of 6 MB initial download.

Tooling research: pmndrs `postprocessing` (MIT) + `n8ao` (MIT) for the effects stack;
CC0 assets from Poly Haven / ambientCG / Quaternius / Kenney; gltf-transform +
meshopt for model compression; three current release r185 (WebGPU exists but stays out of
scope — no visual payoff, real migration risk).

## Decisions

1. Ship as **7 sequential slice PRs directly to `main`** (not an integration branch): each
   slice is an unambiguous standalone upgrade of one subsystem; hybrid mid-states look
   fine, and production improves continuously. (Contrast with the pivot, where a
   half-pivoted hybrid was unacceptable.)
2. Design doc is binding: `docs/design/2026-07-10-visual-overhaul-design.md`.
3. Free-only policy enforced by an asset license manifest (`public/assets/LICENSES.md`)
   listing source + license for every imported binary.

## Trail

| Slice | PR | Result |
|---|---|---|
| 1 — foundation (three 0.185 + pmndrs post stack) | — | in progress |
| 2 — lighting (sky IBL + N8AO + shadows) | — | |
| 3 — terrain PBR splatting | — | |
| 4 — water | — | |
| 5 — sky/atmosphere | — | |
| 6 — flora & fauna models | — | |
| 7 — polish + live verify | — | |
