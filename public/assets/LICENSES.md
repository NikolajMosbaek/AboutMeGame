# Third-party asset licenses

Every binary asset under `public/assets/` that did not originate in this repo is
recorded here: source, license, and the date it was pulled in. All are CC0
("no rights reserved" — free for any use, no attribution required), per the
visual-overhaul design doc's non-negotiable ("Free only... assets CC0 — Poly
Haven, ambientCG, Quaternius, Kenney").

## Terrain PBR textures (visual-overhaul slice 3, 2026-07-11)

Source: [ambientCG](https://ambientcg.com/) (CC0 1.0 Universal). Downloaded as
the `1K-JPG` variant (Color + NormalGL maps only — roughness/AO/displacement
maps ship in the source zips but are not used by this project), then resized
to 1024x1024 and re-encoded to WebP by `scripts/process-textures.mjs` (the
reproducible build step — its header comment records the exact download URLs;
re-run it to regenerate these files from the original ambientCG sources).

Processed output: `public/assets/textures/terrain/<name>-{albedo,normal}.webp`.

| Splat channel | ambientCG asset | Source URL | License | Pulled |
|---|---|---|---|---|
| jungle floor (grass) | Grass001 | https://ambientcg.com/a/Grass001 | CC0 | 2026-07-11 |
| leaf litter (forest floor) | Ground037 | https://ambientcg.com/a/Ground037 | CC0 | 2026-07-11 |
| rock (mossy jungle rock) | Rock057 | https://ambientcg.com/a/Rock057 | CC0 | 2026-07-11 |
| sand (river mud / wet sand) | Ground054 | https://ambientcg.com/a/Ground054 | CC0 | 2026-07-11 |

CC0 1.0 Universal statement (ambientCG's stated license for every asset on the
site, https://ambientcg.com/faq): the material is dedicated to the public
domain — free to copy, modify, distribute, and use, even commercially, without
asking permission or crediting the source.
