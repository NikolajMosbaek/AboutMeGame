# The Lost Idol — jungle survival treasure hunt (full product pivot)

**Date:** 2026-07-08 · **Status:** approved (user directive) · **Epic:** see run log
`docs/team/runs/2026-07-08-jungle-pivot.md`

## Directive

The user rejected the current game outright and ordered a from-scratch replacement,
built autonomously, with these hard requirements:

> A game where you are an explorer in the jungle. You find clues which lead you to a
> treasure. There must be water, animals, and game mechanics like the need to eat and
> drink to survive. As realistic as possible. Finished when it is running on the
> website and deemed worthy.

"From scratch" applies to the **game**, not the toolchain: the engine chassis
(Three.js renderer seam, procedural terrain/noise, water system, day cycle, discovery
store, procedural audio, perf budget, CI render/smoke gates, Pages deploy) is exactly
the foundation this game needs and is kept. Everything the player sees, hears, and
does is replaced.

## The game in one paragraph

You wake at a riverside camp on an uncharted jungle island, the last of a vanished
expedition. Somewhere inland lies the Emerald Idol. Five clues — a torn journal page,
carved stones, the remains of the explorers who came before you — form a chain from
the camp to the dig site. Between you and the treasure: hunger, thirst, dense jungle,
and the animals that live in it. Drink from the river, forage fruit, keep your
distance from snakes, follow the clues, and dig up the idol.

## Player experience pillars

1. **Immersion first.** First-person camera at eye height (1.7 m), pointer-lock look,
   head-bob, footsteps, dense layered vegetation, dappled light, fog depth, a living
   soundscape. Realism within a procedural, no-external-assets budget means *coherent
   sensory detail*, not photorealism: lit surfaces + cross-billboard foliage (the
   established art direction — flat sprites fight the day-cycle sun), animated water,
   wildlife that reacts to you.
2. **Survival pressure that teaches, not punishes.** Meters drain slowly enough to
   explore, fast enough that you plan around water and food. Death is a setback
   (respawn at camp, meters reset), never lost quest progress.
3. **The trail is the game.** Each clue is a *readable text* that genuinely locates
   the next site by landmark description ("follow the river to where it forks…"), so
   the player navigates by reading the world, not by chasing map markers. A subtle
   compass exists; no GPS-style quest arrow.

## Core loop

explore → read the world → find clue site → (manage hunger/thirst/health en route:
drink at water, forage fruit, avoid snakes) → clue joins the journal and names the
next site → … ×5 → dig site unlocked → dig → **Emerald Idol** → completion screen
(expedition time, deaths, clues, distance walked) → replay.

## Systems spec

### Movement (`src/player/`)

- First-person: WASD/arrows walk (~4.2 m/s), Shift sprint (~7 m/s, stamina-gated),
  pointer-lock mouse look (touch: left virtual stick to move, drag right half to
  look). No jump (nothing requires it; cut scope).
- Terrain-clamped eye height with smoothed slope handling; steep slopes (>~40°) slow
  then block ascent. Shallow water wades (slowed); deeper than ~1.2 m is blocked by
  the same soft push-back used at the world boundary (no swimming in v1).
- Head-bob amplitude tied to speed, disabled by the existing reduced-motion setting.

### Survival (`src/survival/`)

Store + System, same store/subscribe idiom as `hudStore`. All rates are constants in
one tunables block.

- **Thirst** 100→0 in ~7 min of play; **Hunger** 100→0 in ~11 min.
- **Stamina** 100→0 in ~6 s of sprinting, regenerates in ~10 s when not sprinting;
  sprint disabled under 10.
- **Health** 100. While thirst or hunger is 0, health drains ~2/s (stacking). Snake
  strike −25. Health regenerates ~1/s only while thirst and hunger are both >50.
- **Drink:** interaction prompt within reach of water (river/lagoon edge) → hold ~1 s
  → thirst +40/s of holding. **Eat:** consume held fruit → hunger +25 (berry) / +40
  (banana/mango).
- **Death:** health 0 → fade to black, "The jungle keeps its secrets… this time." →
  respawn at camp; meters reset to 75; journal/clues/dig progress kept; deaths
  counted on the completion screen.

### World (`src/world/`, retuned)

- Same 520-unit island scale; new seed and heightfield shaping: a **river** rising in
  the northern highland, winding south through a valley to a **lagoon** by the spawn
  beach. River is carved into the heightmap (so banks are real geometry) and the
  existing water surface is reshaped to river + lagoon patches. Water is drinkable
  anywhere you can reach it.
- **Vegetation bands by elevation:** beach (palms, sparse), valley floor (dense
  canopy — kapok/fig trees with lit trunks + cross-billboard crowns, ferns,
  broadleaf undergrowth), highland (thinner, rockier). Instanced meshes throughout;
  prop density follows the existing quality tiers.
- **Sites** (replacing the 13 landmarks): base camp (tent, cold fire, wrecked canoe),
  river fork, waterfall pool at the highland spring, deep-jungle grove with the lost
  expedition's remains, overgrown ruin (statue head), cliff overhang, and the ancient
  strangler fig on the eastern hill — the dig site.
- Day cycle kept as-is; night is brighter-than-real (moonlit) so the game stays
  playable, and fireflies spawn at dusk (cheap points + existing FX idiom).

### Quest (`src/quest/` reworking `src/discovery/`)

- Content model: 5 clues + 1 dig site, each `{ id, order, site, title, body }`,
  authored in `content/expedition.json` (replaces the about-me payload). The
  discovery store's persistence/journal mechanics are reused: walking into a clue's
  trigger radius opens the clue panel (pauses the world, same session-pause seam);
  read clues live in the Journal.
- Clues are **ordered but not gated** for discovery (stumbling onto clue 4 early
  still collects it) — only the **dig** requires all 5, so thorough explorers are
  rewarded and the intended chain still reads start-to-finish in the journal.
- Dig site: bare earth patch between the fig's roots. With all 5 clues: hold-to-dig
  (~3 s, three shovel strokes of screen shake + audio) → chest rises → idol reveal
  panel → completion screen. Without: the prompt says what's missing ("You're sure
  this is the place — but sure isn't certain. Find the remaining clues.").

### Wildlife (`src/wildlife/`)

All procedural geometry, small state machines, instanced where >1:

- **Birds:** 2 flocks orbiting canopy waypoints, scatter with a call when the player
  is close; perch at night.
- **Butterflies** (day) / **fireflies** (dusk+night): drifting particles near
  flowers/water.
- **Fish:** shadow shapes patrolling the lagoon and river pools, darting from the
  player — sells the water as alive.
- **Snakes:** ~6 placed in undergrowth near valuable spots (fruit stands, clue
  approaches). States: idle → alert (player <6 m: raise head, audio rattle/hiss) →
  strike (player <1.6 m: lunge, −25 health, red vignette) → cooldown. Backing off
  de-escalates. They never chase — the player is always in control of the risk.

### Foraging (`src/survival/` + world props)

- Fruit plants: banana clusters (valley), mango trees (grove edges), berry bushes
  (highland). Interact to pick (fruit visibly disappears from plant), 1-slot hand
  inventory ("carrying: banana"), eat via interaction key. Picked plants regrow in
  ~90 s. Enough density that starvation is a planning failure, not a famine.

### HUD & UI (`src/ui/`, reworked)

- Diegetic-leaning HUD: four slim meters (health, stamina, hunger, thirst) bottom
  left with icons; context interaction prompt center-bottom ("Hold E — drink");
  compass strip top-center (cardinal letters only); journal button + clue count
  top-right. Meters flash at ≤25.
- Panels: Clue panel (parchment styling), Journal (collected clues in order),
  Completion (idol art + stats + replay/share), Death overlay, Pause/settings
  (existing quality/audio/motion settings kept), Onboarding rewritten for the new
  controls, Title screen: "THE LOST IDOL — an expedition in one sitting".
- The old about-me Text View and its content payload are **removed** (the
  no-WebGL fallback becomes a static "this expedition needs WebGL" notice).

### Audio (`src/audio/`, extended)

Procedural synth on the existing AudioEngine: layered jungle bed (insect shimmer,
sparse bird calls by day, cicadas + owl at night) with river noise cross-faded by
distance to water; footstep ticks by surface (soil/sand/shallow water); drink/eat
foley; snake rattle (spatialised, the *warning* is the mechanic); clue chime;
dig thuds; treasure fanfare. All routed through the existing settings mute.

## What is kept / removed

| Kept (chassis) | Removed (old game) |
|---|---|
| Engine seam, renderer, compositor, quality tiers | Vehicle + flight movement |
| Terrain/noise/height-bake pipeline (retuned) | 13 landmarks + archetypes + beacons |
| Water surface/system (reshaped) | About-me content payload + Text View |
| Day cycle + sky + fog | Reveal copy, share copy tied to old game |
| Discovery store/persistence idiom (→ quest) | Nav markers to landmarks (compass instead) |
| AudioEngine/AudioSystem seams (new content) | Old onboarding/title copy |
| HUD store idiom, settings, pause session | Speed vignette (drive-era FX) |
| Perf budget, bundle gate, smoke + render CI gates | |

## Slice plan (each an issue → branch → PR into `jungle`)

A. Pivot docs (this doc, charter, run log, epic) — no product code.
B. First-person explorer controller replacing vehicle/flight.
C. Jungle world: river-valley terrain, vegetation bands, sites, water reshape.
D. Survival core: meters, drink, death/respawn, HUD meters.
E. Foraging: fruit plants, pick/eat, regrowth.
F. Wildlife: birds, butterflies/fireflies, fish, snakes.
G. Quest: clue chain content, clue/journal/dig/completion flow.
H. Audio: jungle bed + SFX set.
I. Identity & polish: title, onboarding, share/social meta, README, purge.

`jungle` merges to `main` (→ live site) only when the whole game passes the gates
and a full-game review deems it worthy. Mid-pivot states never deploy.

## Non-goals (v1)

Multiplayer, saving mid-expedition beyond the existing localStorage idiom, swimming,
weather, crafting, combat, jump, map screen, external art/audio assets, i18n.

## Budgets & gates (unchanged, binding)

400 KB gzip JS / 6 MB initial download; 60 fps target on the high tier — prop
budgets per quality tier as today; CI: lint, typecheck, tests, bundle gate, social
meta gate, render gate, Playwright smoke. Every slice lands green.
