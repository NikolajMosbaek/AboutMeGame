# The Lost Idol — Full Issue Audit

_Autonomous multi-agent audit, 2026-07-19. 10 dimension auditors + a completeness-critic round, every finding adversarially verified against the source and the running build before inclusion._

**119 verified issues** — 28 major, 72 minor, 19 polish. 81 are code/behavior-confirmed; 38 are grounded design-judgment calls. A further 12 candidate issues were checked and dismissed (listed at the end).

> **Coverage note.** The two most-severe things an audit can find — a crash or a hard blocker — did **not** appear: no `critical` issues. The build is stable; what follows is everything below that line. The critic's second pass reached 2 of 8 follow-up angles (persistence, share flow) before a session limit; six deeper cross-system angles (reload desync detail, cold-start loading feedback, predators×dig×finale, touch single-button arbitration, clue-prose vs real geometry, weather×navigation×survival) are only partially covered and are worth a dedicated re-run.

Each issue below carries a severity, what's wrong and why it matters, the evidence (file:line or observed behavior), and a fix direction. Confidence is marked where it's a judgment call.

## Executive summary — the 28 major issues

1. **[Gameplay & Core Loop]** GPS-style nav markers defeat the entire "read the clues to navigate" core loop
2. **[World & Level Design]** GPS-style nav markers to every undiscovered site are still live — the design said to remove them
3. **[World & Level Design]** No prop collision anywhere — the player walks through trees, rocks, ruin walls, tents and the fig trunk
4. **[World & Level Design]** The 'wrecked canoe' site sits 11 m up a dry jungle hillside, nowhere near water — contradicting its own clue
5. **[Graphics & Rendering]** Water ripple-normal tiles at a 5-unit repeat with no distance fade; all open water reads as a woven grid
6. **[Graphics & Rendering]** Shoreline and river foam edge is a hard geometric zigzag sawtooth
7. **[Graphics & Rendering]** Terrain planar-XZ UV stretches ground textures into vertical smears on riverbanks, the waterfall gorge and steep slopes
8. **[Game Feel & Juice]** Taking damage has no visual feedback at all
9. **[Sound Design]** Dry-land footstep ticks play while swimming
10. **[Sound Design]** Threat warning sounds are non-positional despite being the mechanic
11. **[Story & Theming]** GPS-style nav arrows contradict the "read the world, no map markers" pillar the design explicitly cut
12. **[Story & Theming]** "Five pages" in onboarding/README/notice vs "6" in every in-game counter
13. **[UX & Onboarding]** GPS-style nav arrows + distance readouts to all sites still ship, gutting the 'read the clues to navigate' pillar
14. **[UX & Onboarding]** No pointer-lock state affordance: look silently dies after resume/tab-out and there is no 'click to look' prompt
15. **[UX & Onboarding]** 'Reset progress' is a destructive one-click action with no confirmation and no feedback
16. **[Accessibility & Comfort]** Wildlife danger warnings are audio-only — no HUD/visual alternative
17. **[Accessibility & Comfort]** OS prefers-reduced-motion is ignored by all in-world motion (head-bob, FX)
18. **[Accessibility & Comfort]** Modal dialogs do not trap focus — Tab escapes to background HUD
19. **[Performance & Loading]** The mid-range phone the budget targets runs the MEDIUM tier — which has never been fps-measured on mobile-class hardware
20. **[Performance & Loading]** Live perf guard (StatsOverlay/getState) is blind on the compositor tiers — always reports 1 draw / 1 triangle
21. **[Performance & Loading]** High tier sits at 97% triangles and spikes to 148/150 draw calls — effectively zero headroom, above the doc's own worst case
22. **[Performance & Loading]** No automated whole-scene budget guard — a total-scene regression over 500k tris / 150 draws ships silently
23. **[Correctness & Bugs]** Enter used on a modal button leaks an interact edge — auto-opens and discovers the base-camp clue on onboarding-dismiss and on respawn
24. **[Persistence & The Returning Player]** Win-screen stats reset on any reload — completion numbers are a lie
25. **[Persistence & The Returning Player]** 'Continue' respawns at camp with full meters — it does not resume the run
26. **[Persistence & The Returning Player]** Reload after a win re-buries the idol — 'Continue' drops you into a solved world with the treasure gone
27. **[Share Flow]** Share sends the bare homepage URL, wasting the one natural completion-brag moment
28. **[Share Flow]** Fixed-seed world makes expedition time a real cross-player challenge, and share throws it away

---

## Gameplay & Core Loop  
_10 issues — 1 major, 4 minor, 5 polish_

### 1. [MAJOR] GPS-style nav markers defeat the entire "read the clues to navigate" core loop

The design's central pillar is "the trail is the game": you navigate by reading each clue's landmark description, with only a subtle compass and explicitly "no GPS-style quest arrow" (design lines 46-49), and the pivot table lists "Nav markers to landmarks" as REMOVED (line 171). But the pre-pivot NavSystem/NavMarkers are still wired and rendering: every UNDISCOVERED site gets an on-screen dot or a rim arrow rotated toward it, each with a live distance label. A player can ignore the authored clue text entirely and just walk toward the nearest distance readout, which makes the hand-written five-page chain — the product's whole reason to exist — purely decorative.

**Evidence.** NavSystem.ts:34,52,54-55 (undiscovered POIs always projected; label `${Math.round(dist)} m`); NavMarkers.tsx:31-56 (dots + rotated ➤ arrows with distance labels); buildGame.ts:219-228 wires it; GameCanvas.tsx:498 renders it; observed in the running build (scratchpad/spawn.png) — 0 discovered yet four distance readouts (68/154/222/133 m) and a direction arrow show at spawn; design 2026-07-08 lines 48-49 and 171.

**Fix.** Remove NavSystem/NavMarkers (or gate all distance/direction to sites off by default), leaving only the cardinal-letter compass so navigation depends on reading the clues as designed.

### 2. [minor] After winning, the title offers only "Continue" back into a fully-solved world

Discovered pages persist to localStorage, so a returning winner who did not press the win-screen Replay sees the title as "Continue — 6 of 6 pages found" and re-enters a world where every clue is already collected and the dig can be redone immediately. The only way back to a fresh trail is the buried Settings "Reset progress" or the win-screen Replay; the title has no "start anew," so the natural returning-player path lands in a stale, already-completed state.

**Evidence.** persistence.ts (v2 key, load on construct); TitleScreen.tsx:41-47,64,79-87 (Continue whenever discovered>0); DiscoverySystem.ts:47-51 loads persisted ids; reset only via GameCanvas.tsx:419 settings hook or TreasurePanel Replay.

**Fix.** Add a "Begin anew" option on the title when a completed save exists (or auto-clear on completion), so returning players aren't dropped into a solved world.

### 3. [minor] At the fig climax the UI shows a disabled "pages missing" lock over the page you're standing on

Accurate that a disabled "pages still missing" hint and a "Press E to read" teaser show together, both center-bottom, at the fig climax. Two clarifications: (1) the exact desktop copy is "You're sure this is the place — but sure isn't certain. 1 page still missing" (ActionHint.tsx:84-86); the quoted "The place is right — 1 page still missing" is the touch-button label in actionPriority.ts:54. (2) The "missing page" is not a nonexistent page elsewhere — it is the fig's own page, readable on the spot via the co-shown "Press E to read" prompt, which mitigates (but does not eliminate) the confusion.

**Evidence.** actionPriority.ts:49-58 (missingPages>0 "dig-locked", disabled:true, returned BEFORE the "read" case); RevealPanel.tsx:71-80 (teaser "Press E to read" shows whenever !digOwnsKey); buildTreasure.ts:6 DIG_LOCAL (2.9,0,2.9) vs DiscoverySystem INTERACT_RADIUS 16.

**Fix.** Suppress the dig-locked hint while a site's own read prompt is in range (rank read above dig-locked), so arriving at the fig reads as "read this, then dig."

### 4. [minor] Dead about-me quiz machinery (guess/highlight) still ships behind the clue panel

The guess/highlight INTERACTION system (GuessOption, GUESS_MIN/MAX_OPTIONS, GuessBody, answerReveal, emphasis) is genuinely vestigial — no content triggers it. However, the claim wrongly lumps the cyclic "Next: <title> →" selector in as unreachable: for plain clues discoveryStore.ts:99-100 derives bodyUnlocked=true, so RevealActions renders "Next" whenever a next-undiscovered target exists. The Next selector is LIVE in the shipped game; only the quiz/highlight machinery is dead.

**Evidence.** contentModel.ts:29-134 (guess/highlight parsing, GuessOption, GUESS_MIN/MAX_OPTIONS); RevealPanel.tsx:59,192-281 (GuessBody, answerReveal, emphasis); `grep -c interaction content/expedition.json` = 0 (all six pages default to plain).

**Fix.** Delete the guess/highlight interaction variants and their RevealPanel branches, leaving the plain readable-page path the expedition actually uses.

### 5. [minor] Meters are trivially satisfied — survival tension is thin on a normal run · _judgment call_

Thirst (~7min) and hunger (~11min) barely dent over the ~614u chain (~-35/-22 pts at walk pace, with decay paused during clue/menu panels), and drinking is a one-tap +30 gulp, so death-by-meter on a normal run is near-nil and the loop reads closer to 'easy chore' than 'planning challenge'. Correction: it is NOT true that 'most sites sit on the river' — only the canoe is on the river and camp is on the lagoon; overhang/remains/ruin/fig are 31-94u from the river centerline. The thinness comes from slow decay + central water + panel-paused decay, not from every site being waterside.

**Evidence.** SurvivalSystem.ts:25,29 (thirst 7 min, hunger 11 min), :51 drinkPerGulp 30, :178-192 drink on any reachable water; RIVER course through the island center (worldConfig.ts:72-88); most POI_ANCHORS near the river/lagoon.

**Fix.** Increase drain or space water/food further from the trail so managing meters becomes a real routing decision, not an incidental tap.

### 6. [polish] "Five clues" narrative vs the in-game "6 pages" counter

Player-facing narrative consistently says 'five' pages/clues while every counter shows 6. The claim's strongest evidence is Onboarding.tsx:68 ('Five pages lead... dig once you've found them all'), shown to every WebGL player on the way in - not TextView.tsx (which is the no-WebGL fallback a HUD user never sees). The counters (Hud.tsx:59, TreasurePanel.tsx:100-103, TitleScreen.tsx:81, journal) all read 6 because total/cluesTotal = POI_ANCHORS.length = 6: the five clues plus the fig site's own 'Dig.' page. Persistent but cosmetic copy/number inconsistency.

**Evidence.** TextView.tsx:32-33 ("follow five pages"); Hud.tsx:59 ("Pages {count} / {total}", total 6); QuestSystem cluesTotal from POI_ANCHORS.length=6 (buildGame.ts:136, worldConfig.ts:116-123); TreasurePanel.tsx:100-103 "Pages found N/6."

**Fix.** Reconcile the framing — either count only the five clue pages toward the badge/stat, or update all copy to say six pages.

### 7. [polish] Drinking is press-per-gulp, deviating from the spec'd hold-to-drink

The binding design spec calls for hold-to-drink (~1 s hold -> +40/s) and a 'Hold E - drink' prompt; the implementation grants a flat +30 per discrete E press (SurvivalSystem.ts:51, :188-192) with no hold gesture, and the hint reads 'Press E to drink' (ActionHint.tsx:107). Internally consistent (copy matches the tap behaviour) and fully functional, but a deviation from the binding spec that was never reconciled.

**Evidence.** SurvivalSystem.ts:51 (drinkPerGulp 30), :188-192 (one gulp per consumed interact press, no hold accumulation); design 2026-07-08 line ~82 ("hold ~1 s → thirst +40/s").

**Fix.** Implement hold-to-drink accumulation as specified, or update the design to record the gulp-per-press decision deliberately.

### 8. [polish] Mobile (low) tier ships only ~22 fruit plants island-wide, elevation-gated · _judgment call_

The LOW tier ships ~22 ripe plants island-wide (density 0.26 x [26/34/24]), elevation-banded with 90s regrow — verified. Correction: the stated mobile target (iPhone SE / mid Adreno-6xx Android) actually detects as MEDIUM (touch caps at medium; low is forced only by software-GL, <=2 cores, or <=2GB), so it ships ~46 plants (density 0.55); the 22-plant floor is what software-GL/CI and genuinely weak (<=2GB/<=2-core) phones get. Combined with forgiving hunger decay, the 'famine on the target device' risk is overstated, though the sparse elevation-gated food on the low floor is a real edge case worth noting.

**Evidence.** buildForage.ts:17 BUDGET, :100 `Math.round(BUDGET*density)`, :62-81 elevation bands; perf-budget.md propDensity low 0.26; observed forage.plants=22 in the running low-tier smoke (scratchpad/spawn.png STATE).

**Fix.** Floor the fruit count independent of propDensity (like the low-tier tree floor) so the mobile tier keeps a survivable food supply.

### 9. [polish] Respawn refills meters, so death near camp is nearly free and starvation has a safety valve · _judgment call_

Respawn resets health/hunger/thirst to 75 and stamina/breath to full with quest progress kept — precisely the design spec's stated behavior. The emergent 'intentional death as a soft heal-to-75' only pays off when the teleport-to-camp cost is near zero (i.e. already near camp), where drinking at the adjacent lagoon is easier anyway; a marginal balance observation on intended design, not a defect.

**Evidence.** SurvivalSystem.ts:124-136 (respawn sets health/hunger/thirst = respawnLevel 75, stamina/breath = FULL, position reset, quest kept); TUNE.respawnLevel = 75 (:57); DeathOverlay.tsx copy "weaker and wiser."

**Fix.** Make respawn cost more than position (e.g. wake with lower meters, or drop a quest-neutral penalty) so death is a real setback rather than a refill-and-teleport.

### 10. [polish] Stamina is a bare sprint throttle that makes the long treks stop-start · _judgment call_

Stamina on land is only ever a sprint gate (never touches health; nothing else consumes it), exactly as the design spec mandates (100->0 in ~6s, regen 10/s, sprint disabled under 10). Because the re-engage and disengage thresholds are both 10 there is no recovery hysteresis, so the real effect over the ~614u chain is 'top speed can't be sustained' (effective cross-country pace between walk 4.2 and sprint 7), not forced stop-start. A defensible balance/feel opinion on intended mechanics, not a bug.

**Evidence.** SurvivalSystem.ts:30-33 (staminaDrainPerSec FULL/6, staminaRegenPerSec FULL/10) and :43,100 (sprint gate >10); explorer TUNE walk 4.2 / sprint 7 (explorer.ts:41-42); POI_ANCHORS inter-site distances (canoe→overhang 173 u, etc.).

**Fix.** Either lengthen the sprint window / soften the regen gate so sustained travel feels less choppy, or give stamina a second stake (e.g. slow drain into exhaustion) so it earns its meter.

---

## World & Level Design  
_5 issues — 3 major, 2 minor_

### 1. [MAJOR] GPS-style nav markers to every undiscovered site are still live — the design said to remove them

The pivot spec's third pillar is 'navigate by reading the world, not by chasing map markers... A subtle compass exists; no GPS-style quest arrow,' and its kept/removed table explicitly lists 'Nav markers to landmarks (compass instead)' as REMOVED. But the NavSystem is still wired in and every frame projects EVERY undiscovered site to screen space as either a coloured on-screen dot or an edge arrow with a live distance-in-metres label. This guts the entire clue-reading core loop: at 0/6 clues the player can simply walk toward the nearest arrow, so the carefully authored directional clue texts are reduced to flavour and no clue-site can ever be 'hard to find'.

**Evidence.** src/buildGame.ts:218-228 constructs `new NavSystem(...discovery.pois...)`; src/ui/NavSystem.ts:51-88 iterates all pois, skips only discovered ones, and builds `label = "${Math.round(dist)} m"` for on-screen dots and off-screen arrows; src/ui/NavMarkers.tsx:21-56 renders them. Settings only expose `showDiscoveredMarkers` (src/settings/settingsStore.ts:17) — undiscovered markers are unconditional, with no off switch. Design: docs/design/2026-07-08-the-lost-idol-design.md:47-49 and removed-table row. Observed in-game at 0/6 pages: on-screen labels '68 m / 154 m / 222 m / 41 m' with coloured pips/arrows in wld-01-spawn / wld-inland-after-walk.

**Fix.** Delete the NavSystem/NavMarkers wiring for undiscovered sites (or gate the whole thing behind an off-by-default assist toggle) so navigation is driven by the clue texts + compass as the spec requires.

### 2. [MAJOR] No prop collision anywhere — the player walks through trees, rocks, ruin walls, tents and the fig trunk

The explorer controller only ever samples the terrain height field and still-water depth; nothing in the movement path consults prop, landmark or treasure geometry, so the player passes straight through every solid object in the world. In dense jungle this destroys the sense of a physical space (you glide through trunks and boulders), lets you clip through ruin walls and the fig's buttress roots to the dig patch, and makes the 'dense jungle' that is supposed to slow and obstruct you into no obstacle at all.

**Evidence.** src/player/explorer.ts:259-318 (`updateWalk`) computes steps purely from `this.terrain.heightAt(...)` and `this.waterDepthAt(...)`; there is no collider lookup, and buildPlayer.ts:36-47 registers only ExplorerSystem/camera/input (no collision module exists in the tree). Observed: driving 'S' from spawn moved the player x=-34 → -68 straight through a stand of canopy trunks at a constant 4.2 m/s with zero deceleration (wld-collide log; wld-inland-after-walk.png shows the trees we passed through).

**Fix.** Add a cheap cylinder/AABB collision pass against the instanced trunks, rocks and site meshes (or at least the large trunks/walls) in the explorer's step resolution.

### 3. [MAJOR] The 'wrecked canoe' site sits 11 m up a dry jungle hillside, nowhere near water — contradicting its own clue

Clue 1 sends the player to a canoe 'half out of the water on the WEST BANK of the river, where it opens toward this lagoon... keep the water on your right and you will walk straight into it,' and the canoe archetype is modelled as a hull beached at the waterline. But its anchor (-29, 57) landed on a natural hilltop at elevation ~11.4 m — 16 units from the river channel and 85 units north of the lagoon — so the hull rests on grass with no water in sight, and because the ground drops ~5 m across the site footprint the flat-placed hull clips/floats on the slope. The set-piece reads as incoherent and the clue's water imagery is simply wrong for where it is.

**Evidence.** src/world/worldConfig.ts:118 anchors canoe at x=-29,z=57; reproduced terrain.heightAt there = 11.37 m, distToRiver = 16.3 (> RIVER.bankHalfWidth 14, so uncarved), footprint height range 5.1 m over a 6-unit radius (scratch terrain.mjs). Clue: content/expedition.json:12,19. Observed: wld-cam-canoe-top.png and wld-canoe-clean.png show the two hull cylinders on a vegetated slope with the river/water well away.

**Fix.** Move the canoe anchor onto the actual river/lagoon shoreline (a point where terrain.heightAt ≈ seaLevel and distToRiver ≤ bankHalfWidth), or add a per-site ground-conform so it beaches at the waterline.

### 4. [minor] The northern highland is a large bare dirt plateau, not the 'rockier jungle' biome the spec promises

Accurate as written. The single most fixable root cause is the banding gap: the valley canopy pass ends at y=12 while the highland top-up begins at y=14, leaving a full elevation band with zero canopy trees, which — combined with the bare-rock colour above y=20 and the sparse 0.6x highland trees — makes the northern highland read as a tan dirt cap rather than the spec's 'thinner, rockier jungle'.

**Evidence.** Biome coverage inside the boundary (scratch wld-biome2.mjs): treeline-gap y12-14 = 17.2%, deep-jungle y14-20 = 13.6%, bare-highland y≥20 = 10.5%; of the NORTH dry land 66.6% is above the canopy treeline and 22.3% is bare rock. Bands: src/world/props.ts:287 (valley y1.2-12), :314 (highland y>14); src/world/terrain.ts:356-358 (rock colour at y≥20). Observed: wld-highland.png (bare dirt, sparse thin trees) and the tan north cap in wld-aerial-top.png.

**Fix.** Extend the canopy/understory placement bands up through the treeline gap (or lower the highland-top-up threshold and add rock/shrub cover) so the highland reads as thinning jungle rather than barren dirt.

### 5. [minor] The world boundary turns the player back on a dry sloping beach, short of the water

Correct in substance. One factual fix: the single direction where water is reached before the boundary is the SOUTH lagoon/river mouth (ang90 => x=0,z=+178, since +z is south here), not 'due east' as the claim states. The inconsistency (one wet direction, the rest dry sloping land) and the 'invisible wall on dry ground' consequence are both confirmed.

**Evidence.** src/world/worldConfig.ts:44-49 (coastRadius 165, islandRadius 200, boundaryRadius 178); src/world/boundaries.ts:222-231 clamps to r=178. Reproduced heights at r=178 (scratch terrain.mjs): ang0 depth -5.6 (i.e. +5.6 m dry land), ang180 -2.6, ang135 -3.9, but ang90 already +2.2 m of water at r=176.

**Fix.** Push the boundary out to the actual waterline (or make it depth-based rather than a fixed radius) so the turn-back reads as 'you're at the sea's edge' everywhere.

---

## Graphics & Rendering  
_8 issues — 3 major, 4 minor, 1 polish_

### 1. [MAJOR] Shoreline and river foam edge is a hard geometric zigzag sawtooth

Foam is a depth-thresholded band (1 - smoothstep(0,1.5,depth)) evaluated against the carved terrain, so the foam line follows the water/terrain triangulation and reads as a regular triangular sawtooth rather than an organic surf edge. The 0.4 breakup scalar is not enough to disguise it. It is glaringly visible lining both banks of the river from above and along every shoreline.

**Evidence.** src/world/waterSurface.ts:239-240 (shorelineFoam = 1 - smoothstep(FOAM_DEPTH_START 0.0, FOAM_DEPTH_END 1.5)) and :482 (FOAM_BREAKUP_STRENGTH 0.4). Observed as zigzag teeth lining the river in noon-aerial.png / aerial-noon.png, and as blocky pale foam patches in noon-riverMid.png and golden-riverBank.png.

**Fix.** Drive foam from a smoother distance-to-shore field with noise-warped edges (or a scrolling foam texture masked by depth) instead of a raw depth smoothstep on the triangulated mesh, and finer water tessellation near shores.

### 2. [MAJOR] Terrain planar-XZ UV stretches ground textures into vertical smears on riverbanks, the waterfall gorge and steep slopes

The terrain splat uses a pure world-XZ planar UV (uv = worldPos.xz / 6). On near-vertical faces the XZ coordinate barely changes with height, so the albedo/normal textures stretch into long vertical streaks. Exactly the places that should read as rock (the carved river banks, the box-canyon walls behind the waterfall) instead look like smeared green mossy curtains, and steep slopes show strong texture stretching and aliasing.

**Evidence.** src/world/terrainMaterialPatch.ts:46 (TERRAIN_TILE_SIZE = 6), :68 (vWorldXZ = (modelMatrix * position).xz), :109 (uvSplat = vWorldXZ / TERRAIN_TILE_SIZE). Observed on the gorge walls in noon-waterfall2.png / noon-waterfall3.png, the river cliff in golden-riverBank.png, and the stretched slope in noon-sun-up.png.

**Fix.** Use tri-planar projection (blend XZ / XY / YZ by the surface normal) for the splat sampling so vertical faces get correct, unstretched texel density.

### 3. [MAJOR] Water ripple-normal tiles at a 5-unit repeat with no distance fade; all open water reads as a woven grid

On medium/high the water detail patch samples one ripple-normal map at a 5-world-unit repeat (plus a 2.7x-finer copy). Over a lagoon/sea spanning hundreds of units this produces a hard cross-hatch/basketweave pattern across the whole surface, and because the detail normal is never attenuated with distance it compresses into heavy moire/shimmer toward the horizon. It is the most 'fake'-reading element in the game and dominates every water vista.

**Evidence.** src/world/waterSurface.ts:322-326 (RIPPLE_TILE_1 = 5, RIPPLE_TILE_2 = RIPPLE_TILE_1/2.7). Observed at high tier in noon-lagoon.png, evening-lagoon.png, and especially noon-sea-horizon.png and its cropped strip noon-sea-horizon-clip.png where the open sea is a uniform tiled weave receding to a shimmering horizon.

**Fix.** Raise the base ripple tile (e.g. 15-25u), add a large-scale second octave to break the repeat, and fade the detail-normal contribution to zero with view distance so the horizon stops aliasing.

### 4. [minor] High-tier water sun-glint is an intense concentrated white sparkle blob · _judgment call_

The detail tier drops water roughness to 0.12; combined with the un-faded ripple normal this produces a very tight, high-contrast specular response that reads as a dense clump of blown-out white dots on the sun side rather than smooth, spread glitter, and it bloom-blooms into a bright patch.

**Evidence.** src/world/boundaries.ts:55 (WATER_ROUGHNESS_BASE 0.25), :61/:162 (WATER_ROUGHNESS_DETAIL 0.12 applied on the detail tier). Observed as a concentrated sparkle blob in noon-riverMid.png, noon-water-grazing.png, and the glint path in dawn-sun-sea.png.

**Fix.** Raise detail roughness slightly (toward ~0.18) and/or soften the ripple-normal amplitude so the sun glint spreads into a believable streak instead of a hot cluster.

### 5. [minor] Low-tier procedural foliage reads as flat intersecting green cardboard cards · _judgment call_

Accurate for the low tier's canopy and understory (two crossed alpha-cutout quads each). Two nits: palms are NOT cross-planes but radial flat fronds (buildPalmFrondCrown), and the per-instance tint only shifts lightness (offsetHSL h=0,s=0), so there are no 'orange' cards. The leaf CanvasTexture is an alpha cutout of leaf blobs, so silhouettes are ragged leaf clusters rather than hard rectangles, though the crossed-plane structure still reads flat from oblique angles. This is the intended low-tier tradeoff (medium/high swap in low-poly GLB models via floraUpgrade).

**Evidence.** src/world/props.ts cross-plane foliage (built on every tier; the medium/high GLB upgrade is gated by floraDetail 'full'). Observed as flat green/orange cards in low-camp.png, low-water-grazing.png, low-jungle.png and low-aerial.png.

**Fix.** Give the low-tier cross-plane crowns a soft alpha texture or a small 3-4 face volumetric crown so silhouettes read as foliage rather than flat cards.

### 6. [minor] Open sea, lagoon and river all render the same bright turquoise; deep water never darkens · _judgment call_

From the player's coastal vantage the open sea reads as a flat, tiled, light-turquoise sheet with little sense of deep water, similar in tone to the lagoon/river. Root cause is grazing-angle specular sky reflection + fog washing out the (working) depth-absorption diffuse darkening, plus the prominent repeating water-plane tiling — not a broken depth ramp. The depth ramp does darken deep diffuse color (visible in the lagoon from above).

**Evidence.** src/world/boundaries.ts:143-144 (PlaneGeometry(WORLD.size*3) covers open sea) and the depth-absorption term in src/world/waterSurface.ts. Observed in noon-sea-horizon.png (open sea identical turquoise to the lagoon in noon-lagoon.png).

**Fix.** Strengthen the depth-based colour absorption so water past the shore drop resolves to a distinctly darker deep-ocean blue.

### 7. [minor] Waterfall curtain is a flat hard-edged scrolling plane in a very dark gorge · _judgment call_

The 'strip of paper in a dark gorge' read is fair, but the claim underplays the supporting elements: there is a bright crest lip bar (line 139), a dark rock cap bridging to the wall (line 151), two boiling foam splash discs at the pool (lines 159-183) and bobbing mist puffs. 'So dark it swallows the effect' is overstated — the dark canyon actually raises the white curtain's contrast so it reads clearly; the real weakness is the narrow flat curtain and the abrupt base, not the effect being lost.

**Evidence.** src/world/waterfall.ts:30 (FALL_TOP 16), :113-125 (single curtain PlaneGeometry + scroll), splash discs at :171-179. Observed front-on in noon-waterfall2.png and the gorge in noon-waterfall3.png.

**Fix.** Break the curtain silhouette (tapered/irregular side edges, a couple of overlapping strands), widen the base splash, and lift ambient in the gorge so the falls is legible.

### 8. [polish] Low-tier river/shore water mask edge is blocky and stair-stepped from above

The river/lagoon waterline reads as a blocky, stair-stepped line from elevated views on ALL tiers (not just low). Cause: the terrain heightfield is a fixed 260-segment / ~2u-per-vertex mesh where it intersects the flat water plane, plus the 128^2 NearestFilter ground-height texture that drives the shoreline foam and depth-absorption bands (~3u blocks). Low is not special here (it also has the foam band since hasFoam is always true), and the water-mesh segs=1 is not the cause. Rarely prominent in normal first-person play (no free-fly/map), hence polish.

**Evidence.** src/world/worldConfig.ts (WORLD.segments 260 over size 520 ~= 2u/vertex) with low-tier flat water (boundaries.ts segs=1). Observed as a stair-stepped blue river edge in low-aerial.png.

**Fix.** Smooth the low-tier water/land boundary (a thin blended shore band or a slightly higher-res mask near water) so the edge does not read as blocky from above.

---

## Game Feel & Juice  
_12 issues — 1 major, 6 minor, 5 polish_

### 1. [MAJOR] Taking damage has no visual feedback at all

A jaguar pounce removes 45 of 100 health and a snake strike 25, yet the only feedback is an audio thud and the health bar dropping bottom-left. There is no red flash, no screen shake, no vignette pulse, and no directional damage indicator, so a near-fatal hit produces no on-screen impact — the survival loop's central danger reads as nothing happening. In first person, where you cannot see your own body flinch, this leaves combat and drowning feeling weightless.

**Evidence.** src/survival/SurvivalSystem.ts:111-120 (hurt() only mutates health + pauses on death); src/audio/AudioSystem.ts:323 (hurtThud is the sole reaction to a health drop); src/wildlife/jaguar.ts:58 STRIKE_DAMAGE=45; grep for vignette/flash/shake/damage finds no health-driven visual, and createCompositor.ts:123 shows the vignette is driven only by the treasure finale, never by health.

**Fix.** Add a brief screen-space damage response driven off hurt() — a red edge-vignette flash (scaled by amount) plus a small camera kick, gated by reduced motion.

### 2. [minor] Death arrives with no transition

When health hits zero the DeathOverlay card renders immediately with no visual transition (DeathOverlay.tsx:27-42; .death-overlay has no entry animation, tokens.css:474-501) and there is no damage flash. The design spec (line 83-84) explicitly specifies death → 'fade to black' before the message, so the missing fade is a real deviation from the agreed design (a deathSting audio cue does fire, so the moment is not silent). Desaturation and slow-motion mentioned in the claim are unspec'd extras.

**Evidence.** src/ui/DeathOverlay.tsx:27-42 conditional render on !s.alive with no transition; tokens.css:474-501 .death-overlay/.death-overlay__card carry no entry animation (unlike .menu's overlay-rise).

**Fix.** Add a short fade/desaturate of the frame into the death card (a brief opacity/grayscale ramp) with a reduced-motion instant fallback.

### 3. [minor] Head-bob cadence is far faster than a stride and decoupled from footstep audio

The head-bob is a distance-driven abs(sin) that bottoms out about every 0.625 m — ~6.7 dips/s while walking and ~11/s while sprinting — which reads as a fast shimmer rather than footfalls, and it only ever pushes the eye upward from the base height instead of dipping on each step. Meanwhile footstep sounds fire on a completely separate timer at ~2.2/s (walk), so the step you hear never lines up with the head moving; the stride never feels like one unified motion.

**Evidence.** src/player/fpCamera.ts:11-13 BOB_FREQ=1.6 with bobY=Math.abs(Math.sin(phase))*amp added to eye y (lines 50-55); src/audio/AudioSystem.ts:125-126 FOOTSTEP_WALK_INTERVAL=0.46 / SPRINT 0.3 on an independent footstepTimer (lines 290-294). 4.2 m/s x 1.6 dips/m = 6.7 dips/s vs 1/0.46 = 2.17 steps/s.

**Fix.** Lower the bob frequency to ~1 cycle per stride and derive the footstep trigger from the same bob phase so the audible step lands at the bob's low point.

### 4. [minor] No critical-health screen state — the only low cue is a bar flash · _judgment call_

At health <=25 (SurvivalMeters.tsx:16) the meter fill turns red (#e05656) at <=25% width and pulses via the CSS meter-flash animation, which is removed under both reduced-motion gates (tokens.css:452-455), leaving only the static red short bar. There is no peripheral vignette, desaturation, or heartbeat — confirmed no health-driven post-fx (createCompositor.ts vignette is finale-only). The claim's 'essentially normal screen' overstates it (a flashing red near-empty bar is present), but the substantive points hold: the only cue is a bottom-left bar easily missed by a center-focused first-person player, and reduced-motion users lose even the pulse. Note this overlaps the transient-hit gap in claim 1 (event feedback) but concerns the sustained low-health state.

**Evidence.** src/ui/SurvivalMeters.tsx:16 LOW_METER=25; src/tokens.css:446-455 meter-flash animation removed under both reduced-motion gates; createCompositor.ts:123 confirms the frame vignette responds only to the treasure finale, not health.

**Fix.** Add a subtle sustained red edge-vignette (and optional slow pulse) that ramps in as health falls below a danger threshold, with a static-but-visible reduced-motion fallback.

### 5. [minor] Sprint has no sense of speed (no FOV kick or motion cue) · _judgment call_

The camera FOV is fixed at 60 and never retuned (GameCanvas.tsx:196, Engine.ts:92 — no reassignment anywhere), so there is no FOV kick, no motion streaks, and no speed vignette on sprint. However the claim understates the existing sprint cues: movement jumps 4.2->7.0 m/s (a 67% increase, itself a strong first-person motion cue), footstep cadence speeds up 0.46->0.3s (AudioSystem.ts:125-126), the head-bob both amplifies (1.4x, fpCamera.ts:53) and quickens (distance-driven phase), plus a breath one-shot and exhaustion panting. So 'almost identical to walking' is an exaggeration. A FOV kick would add polish but was never in the design, and the speed vignette was deliberately retired as a drive-era FX (design line 173; buildGame.ts:233). A legitimate but minor/subjective juice gap, not a defect.

**Evidence.** grep for 'fov' across src returns zero matches; GameCanvas.tsx:196 constructs PerspectiveCamera(60,...) once and it is never retuned; src/player/fpCamera.ts:53-54 only scales bob amplitude by speed; explorer.ts:41-42 sprintSpeed 7.0 vs walkSpeed 4.2.

**Fix.** Ease camera FOV up a few degrees while sprinting (and back down on release), respecting reduced motion, to give sprint a felt acceleration.

### 6. [minor] Swimming has no body or stroke presence

The first-person hands cover only drink, eat, and dig; swimming through the lagoon or fighting the river current shows no arms, no strokes, and no water disturbance — you glide as a bodiless camera. Swim traversal is a core mechanic (buoyancy, diving, being gripped by the current) yet it is the least embodied action in the game.

**Evidence.** src/player/hands.ts:14 HandAction = 'idle'|'drink'|'eat'|'dig' (no swim); src/player/explorer.ts:138 'No visible body … nothing is added to the scene'; observed in swim run — systems.hands.action stayed 'idle' across mode changes.

**Fix.** Add a looping breaststroke hand pose to the HandsSystem while mode==='swim' so water traversal has the same forearm presence the other verbs do.

### 7. [minor] Water contact produces no splash, ripple, or entry sound

Wading and the walk-to-swim transition generate no splash particles, no ripples at the feet, and no dedicated water-entry sound; the footstep just switches to a duller tone while wading. Stepping into the lagoon or being swept into the river is visually and sonically indistinguishable from walking, which undercuts one of the game's signature environments.

**Evidence.** src/audio/AudioEngine.ts:258-280 footstep(wading) only changes tone; src/player/explorer.ts:326-330 enterSwim() triggers no fx; the only splash sound, AudioSystem.ts:363 splashScatter, is for fleeing fish; no ripple/particle system exists for the player.

**Fix.** Emit a small splash particle burst plus a splash sound on the wade/enter-swim edge, and repeat lighter splashes on wading footsteps.

### 8. [polish] Footsteps do not couple to terrain type

The footstep synth distinguishes only wading versus dry land, so walking on the sand beach, jungle grass, and stone ruins all sound identical. The island deliberately varies its ground (beach, forest floor, carved stone sites) yet the single dry-land click flattens that variety and weakens the sense of where you are stepping.

**Evidence.** src/audio/AudioEngine.ts:258-280 footstep(wading:boolean) branches on one boolean only; src/audio/AudioSystem.ts:293 calls engine.footstep(state.wading) with no terrain/material argument.

**Fix.** Pass a coarse surface type (sand/grass/stone/water) from the terrain into footstep() and vary the filter/tone per surface.

### 9. [polish] No haptic feedback on touch/mobile actions

The game is a share-a-link, mobile-first experience, but nothing in the codebase calls navigator.vibrate. The on-screen touch action button and every impactful moment (drink, eat, dig thud, taking a hit, finding a page) give phone players no tactile confirmation, missing an easy and expected layer of mobile juice.

**Evidence.** grep for 'vibrate'/'haptic' across src returns zero matches; src/ui/TouchActionButton.tsx:73-77 onPointerDown only calls onPress() with no vibration.

**Fix.** Add short navigator.vibrate() pulses (guarded by feature-detection and the reduced-motion/sound preference) on the touch action press and on key edges like hurt, dig thud, and discovery.

### 10. [polish] No landing or step-down impact; verticality has no physical feel · _judgment call_

Walk keeps the eye clamped exactly to the terrain height each frame (explorer.ts:240) with head-bob as the only camera motion (fpCamera.ts), so descents/ledges/rises get no landing dip or settle. This is the spec's intended terrain-clamped model and jump was deliberately cut (design spec lines 64-65); the only real gap is an optional landing/settle micro-motion for immersion — polish, not a defect.

**Evidence.** src/player/explorer.ts:240 pos.y = terrain.heightAt(...) each frame with no vertical velocity/impact; src/player/input.ts:28 'on land the explorer ignores it, there is no jump'; fpCamera.ts applies only bob, never a landing offset.

**Fix.** Track vertical delta between frames and add a short damped camera dip when descending faster than a threshold (a landing 'settle').

### 11. [polish] Rain-on-lens overlay is completely static

The 'rain on the lens' effect is eight fixed radial-gradient droplets tiled across the screen whose only animated property is overall opacity. The drops never streak, run down, appear, or refresh, so during a shower it reads as a fixed smudge pattern fading in and out rather than water hitting a lens.

**Evidence.** src/tokens.css:1469-1487 (.lens-rain, comment 'Static (no animation)'); src/engine/GameCanvas.tsx:375 only assigns el.style.opacity from rain01. Observed in the rain-peak screenshot as a faint fixed speckle.

**Fix.** Animate a couple of the droplet layers (slow downward drift plus occasional fade/replace of individual drops) while keeping it a reduced-motion-safe zero-draw-call overlay.

### 12. [polish] Underwater wash hard-cuts on submerge and surface

The underwater teal film is toggled by returning null versus a div on the submerged flag, so crossing the waterline pops the whole-screen wash on and off instantly. Breaking the surface — a moment that should feel like a gasp and a clearing view — is an abrupt visual snap.

**Evidence.** src/ui/UnderwaterOverlay.tsx:20 'if (!s.submerged) return null' (binary mount/unmount); src/tokens.css:405-412 .underwater-overlay has a static background and no opacity transition.

**Fix.** Keep the node mounted and CSS-transition its opacity on the submerged flag so the wash fades over the surface crossing.

---

## Sound Design  
_15 issues — 2 major, 13 minor_

### 1. [MAJOR] Dry-land footstep ticks play while swimming

In deep water the explorer runs at swimSpeed 2.6 m/s (well over the 0.5 m/s footstep floor) with wading=false, and AudioSystem's footstep logic gates only on speed and passes state.wading — it never checks mode==="swim". So while free-swimming the river or lagoon the player hears the rhythmic dry-land tick (triangle@180) on the walk/sprint cadence, the classic 'footsteps in water' bug that instantly breaks immersion.

**Evidence.** src/audio/AudioSystem.ts:290-295 (footstep fired on speed>0.5, passes state.wading only); src/player/explorer.ts:328,390 set wading=false in swim mode; explorer.ts:360-362 swim speed 2.6 m/s (TUNE.swimSpeed line ~62). Runtime probe recorded triangle@180 dry ticks.

**Fix.** Suppress footsteps (or swap to a swim-stroke cue) when explorer.state.mode==="swim".

### 2. [MAJOR] Threat warning sounds are non-positional despite being the mechanic

The snake rattle and jaguar growl are the intended warnings ('the warning is the mechanic'), but anyAlert()/isStalking() are booleans and the whole engine is a dead-center mono mix with no panner or distance attenuation. The rattle sounds identical whether the snake is directly ahead at point-blank or at the 6 m alert edge, and gives no direction — the player cannot tell where to flee, undermining the escape mechanic the design specified as spatialised.

**Evidence.** design doc line 160 'snake rattle (spatialised, the *warning* is the mechanic)'; src/wildlife/snakes.ts:311-315 boolean anyAlert; src/audio/AudioSystem.ts:351-357; no PannerNode/StereoPanner anywhere (grep) and AudioContextLike exposes none (AudioEngine.ts:36-40).

**Fix.** Pass the nearest-threat bearing/distance to the engine and pan + attenuate the rattle/growl (at minimum a StereoPanner + distance gain, ideally PositionalAudio).

### 3. [minor] Ambient bird/owl accents keep firing over the death overlay and menus

AudioSystem's critter-accent timer, day/night crossfade, and river proximity run every frame with no check on session.paused, while death and menu open pause the session. So cheerful bird chirps and owl hoots continue playing on top of the 'you died' overlay and the pause menu, which is tonally jarring against a failure/interruption state.

**Evidence.** src/audio/AudioSystem.ts:277-284 critter accents fired unconditionally in update(); death pauses the session (src/survival/SurvivalSystem.ts:216); footsteps are the only cue indirectly silenced (via zeroed speed).

**Fix.** Gate the sparse critter accents (and optionally soften the bed) on session.paused / the death state.

### 4. [minor] Bird chirp is a single pure sine 'ping' · _judgment call_

birdChirp() is one plain sine blip at 2200-2800 Hz. A single steady sine tone with no glide or warble reads as a video-game 'ping', not a bird — real chirps have rapid pitch sweeps and multiple notes. As the primary daytime ambient accent, repeated every 4-11 s, it cheapens the soundscape.

**Evidence.** src/audio/AudioEngine.ts:488-492 (single sine blip); fired from AudioSystem.ts:281. Runtime probe recorded sine@2526.

**Fix.** Give the chirp a short pitch glide and 2-3 quick notes with per-call variation so it reads as a bird call.

### 5. [minor] Entire mix is mono / dead-center — no stereo width

There is no StereoPannerNode anywhere; every SFX, accent, and bed plays hard-center. A jungle soundscape with birds, insects, wildlife, and water all stacked in the middle of the stereo field sounds flat and small, especially on headphones, and gives no left/right sense of the world around the first-person camera.

**Evidence.** No StereoPanner/createStereoPanner/PannerNode in src (grep); AudioContextLike has no pan node (AudioEngine.ts:36-40).

**Fix.** Add StereoPanner nodes so at least ambient accents and wildlife one-shots spread across the stereo field.

### 6. [minor] Footsteps are a single identical tonal tick — no surface or per-step variation

footstep() synthesises one fixed oscillator tick — dry land is always triangle@180 Hz through a 700 Hz bandpass at gain 0.06 for 0.08 s, with zero randomisation of pitch, timing, or level. The most frequent sound in the game is therefore a mechanical repeating blip, and there are only two variants (dry vs wading) where the design called for soil/sand/shallow-water surfaces. It reads as a metronome, not feet on jungle floor.

**Evidence.** src/audio/AudioEngine.ts:260-280 (fixed freq/filter/gain/dur, no jitter); design doc line 159 'footstep ticks by surface (soil/sand/shallow water)'; runtime probe: 7 consecutive footsteps all triangle@180.

**Fix.** Add per-step pitch/level jitter plus a short filtered-noise crunch component, and branch tone on terrain surface (soil/sand/leaf-litter/shallow-water).

### 7. [minor] No audio feedback on UI interactions (journal, guess, respawn, menu) · _judgment call_

Every engine sound call lives in AudioSystem and is tied to a diegetic world event; opening the journal, committing a guess in the reveal panel, clicking the respawn button, and toggling the pause menu produce no sound. Core UI actions feel dead, and there is no confirmation cue when the player commits a clue guess.

**Evidence.** grep for engine sound triggers returns only src/audio/AudioSystem.ts; UI buttons (src/ui/Hud.tsx:69,78, DeathOverlay.tsx:37, JournalPanel/RevealPanel) call handlers with no audio.

**Fix.** Add subtle synthesised UI ticks/confirmation blips on journal open, guess commit, and menu toggles (gated by the same mute).

### 8. [minor] No audio warning for critical or draining survival meters

Health lost to empty thirst/hunger/breath drains gradually (starveDrainPerSec applied as drain*dt, a fraction per frame), so it never exceeds the 5-point single-update threshold that triggers hurtThud. A player starving, dehydrating, or drowning to death hears nothing at all until the death sting — the entire survival tension has no audio support (no heartbeat, no gasping, no low-meter alarm).

**Evidence.** src/audio/AudioSystem.ts:130 HURT_DROP_THRESHOLD=5, applied at 323; src/survival/SurvivalSystem.ts:196-208 slow per-frame health drain; death sting only fires at alive→false (AudioSystem.ts:324).

**Fix.** Add a rising low-meter cue (e.g. a heartbeat/labored-breath loop that intensifies as health, thirst, or breath approaches zero).

### 9. [minor] No master limiter — concurrent voices can clip · _judgment call_

Every voice and bed connects straight to the master gain with no DynamicsCompressor/limiter; the AudioContextLike interface doesn't even expose one. When several loud events coincide (e.g. a jaguar growl 0.22 + thunder 0.42 + rain/waterfall/river beds ~0.45 + a chime 0.35), the summed signal exceeds 1.0 after the 0.7 master and hard-clips into distortion.

**Evidence.** All voices connect to this.master then destination (AudioEngine.ts:846, 183); no createDynamicsCompressor in the interface (AudioEngine.ts:36-40) or codebase (grep).

**Fix.** Insert a DynamicsCompressor (soft-knee limiter) between master and destination and extend AudioContextLike accordingly.

### 10. [minor] No splash, swim-stroke, or underwater muffling for water play

Diving into deep water, surfacing, and swimming have no dedicated audio: there is no entry splash, no stroke sound, and the mix is not low-pass filtered while submerged even though the game tracks a submerged flag and shows an underwater visual overlay. The whole soundscape sounds identical above and below the waterline, so a mechanic the design added (swim/breath, #184) is sensory-empty underwater.

**Evidence.** AudioEngine has no submerged/splash/swim method; submerged is in explorer.state (explorer.ts:207) and survival, but audio ignores it; UnderwaterFxSystem is visual only (buildWorld.ts:317).

**Fix.** Add a water-entry splash and a low-pass 'muffled' filter on the master while submerged, plus a soft swim-stroke tied to swim speed.

### 11. [minor] No volume control — settings expose only a binary mute

The settings store holds only muted (plus quality/reducedMotion/markers); there is no master, music, or SFX volume. Combined with a wide un-compressed dynamic range (ambient bed ~0.1 vs thunder ~0.42, hurt 0.3), a player who finds the mix too loud or the ambience too quiet has only all-or-nothing mute, with no way to balance it.

**Evidence.** src/settings/settingsStore.ts Settings interface = {muted, quality, reducedMotion, showDiscoveredMarkers}; AudioEngine only offers setMuted (AudioEngine.ts:213).

**Fix.** Add a persisted 0-1 volume setting the engine applies to master gain, ideally split into music vs SFX.

### 12. [minor] Phantom gulp on respawn after a thirst death

AudioSystem plays a phantom drinking gulp on respawn. respawn() raises thirst to respawnLevel (75) without re-syncing AudioSystem's lastThirst baseline, so the thirst-rise edge (AudioSystem.ts:322) fires gulp() on the frame after waking — a wrong cue at the sensitive respawn moment. Triggers on any death where thirst-at-death was below 75, not only thirst deaths.

**Evidence.** src/survival/SurvivalSystem.ts:129 respawn sets thirst=respawnLevel; src/audio/AudioSystem.ts:322 gulp on thirst rise; baselines not re-synced on respawn.

**Fix.** Re-baseline lastThirst on the death→respawn transition (or suppress the gulp edge for one frame after respawn).

### 13. [minor] River water is a tonal oscillator drone, not water noise

The river 'water texture' is a single sawtooth oscillator at 180 Hz through a bandpass at 500 Hz — a steady pitched hum — whereas rain and the waterfall (added later) correctly use filtered white-noise buffers. Near the river, a central and frequently-visited feature, the player hears a synth drone rather than moving water, and it is audibly inconsistent with the noise-based rain/waterfall beds.

**Evidence.** src/audio/AudioEngine.ts:551-556 river = sawtooth osc→bandpass; contrast rain noise buffer 654-679 and waterfall noise buffer 727-752.

**Fix.** Rebuild the river layer on a looping filtered-noise buffer (bandpassed, with a slow LFO on cutoff) like the rain/waterfall beds.

### 14. [minor] Snake rattle reads as a harsh alarm-clock beep · _judgment call_

snakeAlert() is five square-wave blips alternating 1500/1700 Hz. High-frequency square waves are buzzy and read as a digital alarm/UI beep rather than the broadband dry-scale hiss of a real rattle, so the game's key danger cue sounds toy-like and harsh on a phone speaker.

**Evidence.** src/audio/AudioEngine.ts:336-343 (five square blips at 1500/1700 Hz).

**Fix.** Synthesise the rattle from bandpassed noise bursts (amplitude-modulated ~30-60 Hz) rather than square-wave tones.

### 15. [minor] The two biggest payoffs can be masked — duck only touches the insect bed

completion() ducks only the insect bed (musicGain) and fanfare() ducks nothing; the river, rain (0.14) and waterfall (0.2) beds route straight to master and stay at full level. The two biggest payoff cues (completion sting, dig-reveal fanfare) therefore play over un-ducked beds during rain or near the falls — not fully masked (their peaks exceed the beds) but the intended 'stand alone' duck is incomplete and applied inconsistently.

**Evidence.** src/audio/AudioEngine.ts:457-464 completion ducks only this.musicGain; 431-438 fanfare has no duck; rain/waterfall beds route straight to master (674-679, 746-752).

**Fix.** Route all beds through a shared 'ambient bus' gain and duck that bus for both completion() and fanfare().

---

## Story & Theming  
_12 issues — 2 major, 8 minor, 2 polish_

### 1. [MAJOR] "Five pages" in onboarding/README/notice vs "6" in every in-game counter

All marketing/onboarding copy says the trail is five pages, but every in-game counter says six, and the player sees both at once. The onboarding overlay's "Five pages lead from your camp" is displayed simultaneously with the top-right "Pages 0 / 6" badge; the first clue then opens as "PAGE 1 OF 6." The mismatch stems from the quest counting all six POI anchors (base camp + fig included) as "pages" while the copy kept the design's "5 clues" framing.

**Evidence.** Onboarding.tsx:68-70 "Five pages lead from your camp to the Emerald Idol"; README.md:3 "follow five pages"; TextView.tsx:31-34 "follow five pages". Counters: buildGame.ts:136 passes all 6 `POI_ANCHORS` as clueIds so `cluesTotal=6`; RevealPanel.tsx:98 "Page {order} of {total}"; Hud.tsx:59 "Pages {discoveredCount} / {total}". Observed: onboarding screenshot 02 shows "Five pages" text and a "Pages 0 / 6 · 6 to go" badge on screen together; reveal screenshot 05 shows "PAGE 1 OF 6".

**Fix.** Pick one number and make all copy and every counter agree (e.g. call it six pages everywhere, or exclude the auto-read camp page from the counters).

### 2. [MAJOR] GPS-style nav arrows contradict the "read the world, no map markers" pillar the design explicitly cut

The shipped HUD renders a distance-labeled homing dot for every on-screen undiscovered site (NavSystem.ts:61-71) and an edge arrow for the nearest few off-screen ones (capped at MAX_EDGE_ARROWS=3, NavSystem.ts:84-86), each with a live '<n> m' label — verified live at spawn (2 dots + 3 arrows). The settings 'Show discovered markers' toggle only governs already-discovered POIs; undiscovered homing markers are always on with no way to disable them. This neutralizes the clue-reading craft and contradicts the design's explicit 'no map markers / no GPS-style quest arrow' pillar and expedition.json's own design note. (The one accuracy nit in the original claim: off-screen arrows are capped at 3, not literally 'every' off-screen site.)

**Evidence.** NavSystem.ts:37-52 projects every UNDISCOVERED poi to a dot/arrow with `label = "<n> m"`; mounted at GameCanvas.tsx:498 (`<NavMarkers>`); design doc lines 48-49 ("navigates by reading the world, not by chasing map markers ... no GPS-style quest arrow") and line 171 (Removed: "Nav markers to landmarks (compass instead)"). Observed at spawn: STATE `nav.markers:5, onScreen:2`; screenshot 03 shows a cluster of "6 m / 68 m / 154 m / 153 m / 222 m" markers pointing at all five undiscovered sites. SettingsMenu.tsx:104-114 only toggles ALREADY-discovered markers, so there is no way to disable the undiscovered homing arrows.

**Fix.** Replace the per-landmark dots/arrows with the subtle cardinal compass the design specifies (drop distance labels and homing arrows) so the clues, not the HUD, do the wayfinding.

### 3. [minor] Deploy and share URL still carries the retired "AboutMeGame" product slug

The game titled "The Lost Idol" is served from, and its Share button copies, a URL containing the pivoted-away product's name. Every player sees "/AboutMeGame/" in the address bar, and every shared/unfurled link and the og:url show "github.io/AboutMeGame/" — an off-brand artifact of the abandoned "about me" product visible to every recipient.

**Evidence.** vite.config.ts:12 `const BASE = process.env.VITE_BASE ?? "/AboutMeGame/"`; shareCapabilities.ts:58 `realShareUrl = socialUrlHref(import.meta.env.BASE_URL)`; index.html og:url/og:image/twitter:image all use `https://nikolajmosbaek.github.io%BASE_URL%`. Observed: game runs at http://localhost:5173/AboutMeGame/.

**Fix.** Rename the GitHub Pages repo/base (or attach a custom domain) so the shared link and address bar reflect "The Lost Idol."

### 4. [minor] Ending leaves the R./M./K. character threads unresolved · _judgment call_

The story-rich clue chain (R.'s betrayal and map theft, K.'s fever, M.'s shaking hand and vindication, R.'s dropped shovel) resolves only in a single flavor sentence plus a stats card on the TreasurePanel; the Journal adds no closing beat. M.'s death and a hint of vindication are stated, but R.'s fate and K. are left unaddressed. This is a narrative-polish opportunity, not a defect — the design spec scopes the completion screen to stats + idol art + replay/share and does not promise thread resolution.

**Evidence.** content/expedition.json bodies for site-fallen-idol-ruin (R.'s last entry, "I go at dawn, alone") and site-ancient-fig ("someone started digging here, recently, and stopped as suddenly. A shovel lies where it was dropped"); TreasurePanel.tsx:88-93 win copy is one line ("M. and the others never made it home. You did") plus a stats `<dl>`.

**Fix.** Add a final found-object/journal beat at the dig (or on the win screen) that closes R.'s and M.'s arcs.

### 5. [minor] Favicon is a pre-pivot "sky-beacon" mark labeled "AboutMeGame"

The browser-tab brand mark depicts a glowing amber beacon/lamp column — a motif from the removed pre-pivot game (its landmarks had "beacons"), not the Emerald Idol or jungle expedition — and its accessible label is the retired product name "AboutMeGame," which screen-reader users hear for the tab. The one persistent piece of branding a player carries in their tab bar is off-brand for The Lost Idol.

**Evidence.** public/favicon.svg:1 `aria-label="AboutMeGame"`, lines 9-14 draw a "Beacon glow column" + "Beacon core + lamp"; index.html comment calls it "the amber sky-beacon mark"; design doc line 168 lists "beacons" among Removed pre-pivot features.

**Fix.** Redraw the mark around the idol/jungle motif and set its aria-label/title to "The Lost Idol."

### 6. [minor] HUD speedometer ("0 m/s") is an off-theme leftover from the vehicle/flight game

The top-center HUD pill shows a compass letter next to a live speed readout in m/s. A speedometer belongs to the pre-pivot drive/fly game, not an on-foot jungle survival explorer — it reads as racing telemetry and breaks immersion (a stationary player stares at "0 m/s"). The design asked only for a "compass strip (cardinal letters only)," and the component's own docstring still describes "DRIVE/FLY" modes and "altitude (fly only)," confirming the origin.

**Evidence.** Hud.tsx:36-40 renders `{h.speed}` + "m/s"; Hud.tsx:16 docstring "top-left telemetry — mode (DRIVE/FLY), speed, and altitude (fly only)"; HudSystem.ts:23 feeds `speed`; design doc line 146 "compass strip top-center (cardinal letters only)." Observed: screenshots 03/05 show an "E   0 m/s" pill.

**Fix.** Drop the m/s speed readout and keep only the diegetic cardinal compass.

### 7. [minor] Onboarding controls table crams a chatty run-on aside into the swim row

Every control row is a terse label ("Walk", "Sprint", "Menu") except the Space row, which is a three-line narrative aside — "Swim up — in the lagoon you swim where you look; the river's current is not your friend." It clashes tonally and visually with the rest of the table, and it surfaces a whole swim/lagoon/current mechanic that the onboarding lede (which lists drinking, foraging, snakes) never mentions, so the mechanic first appears as prose inside a keybinding.

**Evidence.** controlScheme.ts:45-48 `{ label: "Space", action: "Swim up — in the lagoon you swim where you look; the river's current is not your friend" }`; Onboarding.tsx:67-71 lede omits swimming. Observed screenshot 02: the Space row wraps to three lines beside the single-line "Walk/Sprint/Menu" rows.

**Fix.** Shorten the Space action to a control-length label (e.g. "Swim up") and, if the lagoon matters, introduce swimming/current in the lede prose.

### 8. [minor] Screen-reader page announcement uses find-count while the visible eyebrow uses narrative order

When a page is discovered, the live-region announcement says "page N" using how many you have found so far, but the visible reveal eyebrow says "Page N" using the page's fixed narrative order. Because sites can be found out of order (design allows it), a sighted player can read "PAGE 5 OF 6" while a screen-reader user hears "page 2 of 6" for the very same page — two different meanings of "page N."

**Evidence.** discoveryAnnounce.ts:26 returns `Found ${title} — page ${next.discoveredCount} of ${next.total}` (discoveredCount = running find count); RevealPanel.tsx:98 shows `Page {open.order} of {snap.total}` (fixed order). Design doc line 112 confirms clues are "ordered but not gated," so out-of-order discovery is expected.

**Fix.** Announce the page's `order` (or reword to "Nth page found of M") so the spoken and visible labels agree.

### 9. [minor] The clue panel is a generic dark UI dialog, not the parchment styling the design called for

The panel that carries all the narrative — the found field-notes pages — is styled as a plain dark-slate modal with white body text and yellow buttons, identical to the pause menu and journal chrome. The design specified "Clue panel (parchment styling)" precisely because aged-paper treatment is what makes "the field notes of a vanished expedition" land; as shipped, the core story artifact reads like a system dialog.

**Evidence.** RevealPanel.tsx:91-100 uses `className="reveal-panel"` with no parchment/paper treatment; design doc line 148 "Panels: Clue panel (parchment styling)". Observed screenshot 05: the "Torn Journal Page" reveal is a dark rounded card with white text, visually indistinguishable from SettingsMenu/JournalPanel chrome.

**Fix.** Give the reveal panel an aged-paper/parchment visual (torn edges, warm stock, handwritten-feeling type) distinct from the system menus.

### 10. [minor] The jaguar (a lethal ~45-damage pounce predator) is absent from all narrative and onboarding

The jaguar deals 45 damage (STRIKE_DAMAGE, jaguar.ts:58; live 'prowl' at spawn) and is never named in any player-facing text (onboarding, README, index.html, expedition.json, design doc all return zero 'jaguar' matches; onboarding warns only of snakes). It is NOT a no-warning ambush — it telegraphs behaviorally (prowl→stalk with a growl at 15-25 m, glowing night eyes) and the player always has outs (water, camp, distance). The real gap is the absence of any narrative or onboarding framing for the island's deadliest animal, a missed-opportunity/teaching gap rather than an unfair mechanic.

**Evidence.** src/wildlife/jaguar.ts:5-6 ("lunge ... strike (hurt(45))") and :563 `this.hurt(STRIKE_DAMAGE)`; jaguar.test.ts:350 asserts `hurt(45)`. STATE shows `wildlife-jaguar:{jaguar:"prowl"}` live at spawn. `grep -ni jaguar` over src/ui, src/content, README.md, index.html, and the design doc returns ZERO matches; Onboarding.tsx:68-70 warns only "keep clear of snakes."

**Fix.** Name the jaguar in the onboarding warning and seed it into a clue/journal beat so the predator is both fair and part of the expedition's dread.

### 11. [polish] Social share image is a hazy, title-less terrain screenshot · _judgment call_

The shared-link unfurl card (public/social-preview.png, wired at index.html:37,46) is a deliberate in-game marketing screenshot with the HUD/title hidden — NOT washed-out old-game art, and the title-less framing is intentional (scripts/render-social-preview.mjs). The residual, defensible polish gap: even after a measured recompose to fight sun-bloom haze, the shipped 1200x630 card is still a cool-toned, low-contrast, hazy lagoon vista with a tiny tent and no strong 'treasure-hunt adventure' read — a modest first impression for a link-shared product. Any fix is a design-direction call (accept the current vista, retune for a warmer/higher-contrast frame, or add key art), not a defect.

**Evidence.** index.html og:image/twitter:image → `social-preview.png`; public/social-preview.png observed as a murky grey river-valley screenshot with no text or key art (1200x630).

**Fix.** Replace it with composed key art: the wordmark "The Lost Idol" over a strong jungle/idol frame.

### 12. [polish] Stale pivot leftovers in shipped code docstrings (13-landmark count, "Drive on", DRIVE/FLY)

Several component docstrings still describe the retired about-me / vehicle games and cite dead numbers, which will mislead the next maintainer editing this copy. The discovery announcer claims it speaks "N of 13" (the old 13-landmark dataset; the game has 6), the reveal footer docstring calls its button "Drive on" (actual text is "Press on"), and the HUD docstring documents DRIVE/FLY modes and fly-only altitude that no longer exist.

**Evidence.** DiscoveryAnnouncer.tsx:14 docstring `speaks "Discovered <title> — N of 13"`; RevealPanel.tsx:129-132 docstring `"Drive on" is the always-present ... dismiss` while RevealPanel.tsx:159 renders "Press on"; Hud.tsx:16 docstring "mode (DRIVE/FLY), speed, and altitude (fly only)."

**Fix.** Refresh these docstrings to the shipped copy and the current 6-page count.

---

## UX & Onboarding  
_13 issues — 3 major, 7 minor, 3 polish_

### 1. [MAJOR] 'Reset progress' is a destructive one-click action with no confirmation and no feedback

In the pause menu, 'Reset progress' immediately wipes all found clues/journal pages with no confirmation dialog, sitting directly under the primary Resume button (SettingsMenu.tsx:117-120), and does not close the menu or surface any in-menu acknowledgement. It is also a partial reset — resetProgress (GameCanvas.tsx:419) only calls discovery.reset(), leaving position/survival/world state intact, in contrast to the full-reload replayExpedition path (GameCanvas.tsx:424-427). The badge behind the menu does drop to Pages 0/6, but with the menu still open and no toast, a misclick from Resume can silently cost the expedition with no undo.

**Evidence.** src/ui/SettingsMenu.tsx:120 (onClick={onResetProgress}, no confirm, no onClose), src/engine/GameCanvas.tsx:419 (resetProgress → game.discovery.reset()); contrast replayExpedition GameCanvas.tsx:424-427 which reloads.

**Fix.** Gate 'Reset progress' behind an inline confirm ('Erase all found pages?') and give a brief confirmation, or move it out of the fast-click zone.

### 2. [MAJOR] GPS-style nav arrows + distance readouts to all sites still ship, gutting the 'read the clues to navigate' pillar

The binding design spec explicitly REMOVED nav markers ('Nav markers to landmarks (compass instead)') and pillar 3 forbids a 'GPS-style quest arrow' — the trail is supposed to be read from clue text. Yet NavSystem projects EVERY undiscovered site each frame as an on-screen dot with a distance label plus up to 3 rim arrows rotated toward the sites, and it is mounted live. A first-time player will just chase the arrows and never read a page, dissolving the entire core loop, and there is no setting to hide them (the 'Show discovered markers' toggle only affects already-found sites).

**Evidence.** src/ui/NavSystem.ts:37-88 (iterates all undiscovered pois; distance label line 55; edge arrows), src/ui/NavMarkers.tsx:40-55 (rotated ➤ glyph + label), src/engine/GameCanvas.tsx:498 (mounted), src/buildGame.ts:218-226 (wired); design doc 2026-07-08 line 171 (removed) and lines 48-49 (no GPS arrow). Observed in scratchpad/ux/03-hud-spawn.png: floating '168 m/154 m/222 m/133 m' + arrows at spawn.

**Fix.** Remove NavSystem/NavMarkers (or gate them off by default) so navigation is driven by the compass + clue text as the spec mandates.

### 3. [MAJOR] No pointer-lock state affordance: look silently dies after resume/tab-out and there is no 'click to look' prompt

Mouse-look only engages on a click in the world (requestPointerLock on pointerup); there is no pointerlockchange/pointerlockerror handling anywhere, no crosshair, and no on-screen 'click to look' cue. After the pause menu's Resume, after Esc, or after tabbing away and back, the lock is gone and NOT re-acquired, so moving the mouse does nothing while a desktop arrow cursor floats over the first-person view. The only instruction ('Mouse — click to grab') appears once in the one-time onboarding; the persistent HUD strip just says 'Mouse look'.

**Evidence.** grep: no pointerlockchange/pointerlockerror listeners; src/player/input.ts:144-161 (lock requested only on overlay pointerup), src/player/buildPlayer.ts:66 (releases lock while paused, never re-grabs), src/ui/Hud.tsx:85 ('Mouse look'). Observed in ux.mjs run: 'pointerLock after Resume (no click): unlocked'.

**Fix.** Add a pointerlockchange listener that shows a 'Click to look' overlay whenever lock is absent during play, and re-request lock on the first world click after resume/tab-return.

### 4. [minor] 'Show discovered markers' setting is opaque and exposes a design-removed feature

The pause-menu toggle 'Show discovered markers' is meaningless to a new player (markers of what?), and it only governs whether the nav markers — a system the design spec removed — persist for found sites. It surfaces an internal, spec-contradicting mechanic as a first-class user setting with no explanation.

**Evidence.** src/ui/SettingsMenu.tsx:103-114; wired to NavSystem via src/buildGame.ts:226 (`() => settings.getSnapshot().showDiscoveredMarkers`); design doc line 171 lists nav markers as removed.

**Fix.** Remove this toggle along with the nav-marker system, or rename/explain it if markers are intentionally kept.

### 5. [minor] Compass heading disappears while sprinting, exactly when traversing the island

The top-center HUD pill shows the cardinal heading, but while sprinting it is replaced entirely by the word 'SPRINT', so the player loses their compass reading during the very movement (crossing the island) where heading matters most. Since navigation is meant to lean on a subtle compass, dropping it under sprint is a coherence gap.

**Evidence.** src/ui/Hud.tsx:33 (`{h.sprinting ? "SPRINT" : h.compass}`); observed telemetry read only 'SPRINT' while holding Shift+W in the ux.mjs run.

**Fix.** Keep the compass heading visible while sprinting (show the sprint state as a separate icon/color rather than by hiding the heading).

### 6. [minor] No crosshair or center reticle in the first-person view

The game renders no crosshair/reticle at any point, so there is no center-of-view reference for aiming look or for judging what you are facing when interacting (drink uses the forward vector). Combined with the sometimes-visible desktop cursor, the first-person framing reads as unfinished and gives no feedback that look control is active.

**Evidence.** grep for crosshair/reticle in src/: none; scratchpad/ux/03-hud-spawn.png shows an empty screen center with no reticle.

**Fix.** Add a small, subtle center dot/reticle (respecting reduced-motion) that is present whenever the world is interactive.

### 7. [minor] No look-sensitivity or invert-Y control for a pointer-lock first-person game

Mouse sensitivity is a hardcoded constant with no in-game adjustment, and there is no invert-Y option. Sensitivity is highly monitor- and preference-dependent, and the absence of any adjustment is both a baseline FP-game expectation gap and a motor-accessibility concern. The settings menu covers only sound, quality, reduced motion, and a marker toggle.

**Evidence.** src/player/input.ts:73 (const MOUSE_SENS = 0.0022, no override path), src/settings/settingsStore.ts:~11-18 (Settings has only muted/quality/reducedMotion/showDiscoveredMarkers), src/ui/SettingsMenu.tsx (no sensitivity/invert controls).

**Fix.** Add a look-sensitivity slider (and an invert-Y toggle) to settings, plumbed into input.ts's look scaling.

### 8. [minor] Onboarding backdrop click neither dismisses the modal nor is guarded from grabbing pointer lock

Unlike the pause menu and reveal panel (which close on backdrop click), the onboarding backdrop has no click handler, so clicking outside the card does nothing — an inconsistent modal contract. Worse, because onboarding does not pause the sim and the backdrop is not excluded from the pointer-lock click target, a click on the backdrop can request pointer lock (hiding the cursor) while the dialog is still open, leaving the 'Got it' button hard to reach until Esc.

**Evidence.** src/ui/Onboarding.tsx:62 (`.onboarding-backdrop` has no onClick), vs src/ui/SettingsMenu.tsx:46-49 and src/ui/RevealPanel.tsx:87-89 (backdrop-click close); src/player/input.ts:147,151 (shouldLock true because onboarding doesn't pause; guard excludes [role='dialog'] but not the backdrop).

**Fix.** Pause the sim (or block pointer-lock) while onboarding is up, and make backdrop behavior consistent with the other modals.

### 9. [minor] Onboarding controls list omits the Journal (J) key

The first-run controls list teaches WASD, Mouse, Shift, Space, E, Esc but never mentions J for the journal, even though the journal is central (it holds every clue). J only surfaces in the aria-hidden bottom HUD strip and the book-icon tooltip, so a keyboard player is never formally taught it.

**Evidence.** src/ui/controlScheme.ts:41-51 (KEYBOARD_ENTRIES has no J entry); rendered by src/ui/Onboarding.tsx:73-84; J appears only in src/ui/Hud.tsx:85 (aria-hidden strip) and the tooltip Hud.tsx:68.

**Fix.** Add a 'J — Journal' entry to KEYBOARD_ENTRIES so onboarding teaches it.

### 10. [minor] Onboarding is one-time-only with no way to review controls afterward · _judgment call_

The controls overlay shows once and is suppressed forever via a persisted 'seen' flag; the pause menu has no 'Controls' / 'How to play' entry, so a returning player (or anyone who skimmed it) can only rely on the tiny bottom HUD strip. For a game meant to be picked up again from a shared link days later, there is no full controls reference on demand.

**Evidence.** src/ui/Onboarding.tsx:41,56-58 (open = !seen(); markSeen persists), src/ui/onboardingPersistence.ts; src/ui/SettingsMenu.tsx (no controls/help entry).

**Fix.** Add a 'Controls' / 'How to play' item in the pause menu that re-opens the onboarding content.

### 11. [polish] No fullscreen affordance for a pointer-lock browser game

There is no fullscreen toggle anywhere, so a pointer-lock first-person experience plays inside the windowed tab with browser chrome around it. For a 'no install, just a link' immersive game, a one-click fullscreen (ideally alongside grabbing pointer lock) would materially improve the first-time feel.

**Evidence.** grep for requestFullscreen/fullscreen in src/: only createCompositor.ts shader jargon, no UI control.

**Fix.** Add a fullscreen button (title CTA and/or pause menu) using element.requestFullscreen.

### 12. [polish] The 'Space — swim' onboarding row is a long run-on inconsistent with the terse control list

Every control row is one or two words (Walk, Sprint, Look) except Space, whose action is a two-clause sentence: 'Swim up — in the lagoon you swim where you look; the river's current is not your friend.' It overflows to three lines in the dialog, breaks the scannable key/action rhythm, and buries a mechanic tip inside a controls reference.

**Evidence.** src/ui/controlScheme.ts:45-48 (Space entry action string); rendered in scratchpad/ux/02-onboarding.png as a 3-line row among one-word rows.

**Fix.** Shorten the Space action to 'Swim up' and move the current/lagoon guidance into the lede or a separate tip line.

### 13. [polish] Vehicle-era speed readout (m/s) persists on the walking survival HUD

The top-center pill shows raw speed in metres-per-second next to the compass letter — a leftover from the pre-pivot drive/fly rig (the Hud component doc still references DRIVE/FLY mode). For a walking survival explorer this telemetry is non-diegetic noise; the design asked for 'compass strip top-center (cardinal letters only)'.

**Evidence.** src/ui/Hud.tsx:36-40 (speed + 'm/s'), Hud.tsx:15-24 (stale doc mentioning DRIVE/FLY, speed, altitude); design doc line 146; scratchpad/ux/03-hud-spawn.png shows 'E 0 m/s'.

**Fix.** Drop the m/s speed readout (and stale telemetry doc) so the top-center HUD is just the compass.

---

## Accessibility & Comfort  
_13 issues — 3 major, 9 minor, 1 polish_

### 1. [MAJOR] Modal dialogs do not trap focus — Tab escapes to background HUD

The pause menu, death overlay, reveal panel and onboarding are aria-modal but implement no focus trap and leave the background non-inert, so Tab escapes onto the HUD's 'Open journal'/'Open menu' buttons (and the dev StatsOverlay) behind them — a WCAG 2.4.3/2.1.2 issue that even lets a keyboard user open the journal over the menu. The journal (JournalPanel) is the exception: it already implements a Tab/Shift+Tab focus trap and does not leak focus, so it should be excluded from this finding.

**Evidence.** Observed: with the pause menu open, pressing Tab repeatedly moved focus OUTSIDE the .menu dialog to the dev stats text and the '[OUTSIDE] Open journal' / '[OUTSIDE] Open menu' HUD buttons (Playwright tab-trail run against http://localhost:5173/AboutMeGame/). Code: src/ui/SettingsMenu.tsx:35-42 only sets initial focus + Escape, no trap; same pattern in DeathOverlay.tsx, RevealPanel.tsx, Onboarding.tsx; the HUD buttons stay focusable behind modals (src/ui/Hud.tsx:64-81).

**Fix.** Add a focus trap (or set aria-hidden/inert on the background shell) so Tab cycles within the open dialog and returns focus to the opener on close.

### 2. [MAJOR] OS prefers-reduced-motion is ignored by all in-world motion (head-bob, FX)

The in-world head-bob, ambient motes, rain layer, leaf/treasure bursts and beacon pulse all read the settings-store reducedMotion flag, which defaults to false and is seeded from nothing. The OS-level 'prefers-reduced-motion' preference is honoured only by CSS UI transitions (via the media query), not by any WebGL/world motion. A motion-sensitive player who set their OS preference still gets full nauseating head-bob and scene motion until they manually discover the in-game toggle.

**Evidence.** src/settings/settingsStore.ts:30 DEFAULTS.reducedMotion=false; grep for prefers-reduced-motion in src/ finds only tokens.css + a comment in src/settings/reducedMotion.ts:14-19 ('lets the OS media query remain the sole signal' — i.e. CSS only); src/player/fpCamera.ts:47 reads this.motion.getSnapshot().reducedMotion (the store), not matchMedia; src/buildGame.ts:110-111 creates the store with no matchMedia seed.

**Fix.** Initialise the settings store's reducedMotion default from window.matchMedia('(prefers-reduced-motion: reduce)') so the OS preference gates world motion, not just CSS.

### 3. [MAJOR] Wildlife danger warnings are audio-only — no HUD/visual alternative

Wildlife danger is signalled only by audio (snake rattle / jaguar growl fired on rising edges in AudioSystem.ts:351-357). No HUD indicator, directional cue, or live-region announcement mirrors the threat state; the sole visual is the health meter dropping after the strike lands. Deaf/HoH players and anyone using the ship's full mute toggle get no warning of an out-of-view stalker. An in-world pose animation exists for a predator in view, but there is no accessible on-screen alternative to the audio warning.

**Evidence.** src/audio/AudioSystem.ts:350-358 fire snakeAlert()/growl() on rising edges only; grep of src/ui for jaguar/snake/anyAlert/isStalking/threat returns nothing (no UI consumer); JaguarStalkSource doc (AudioSystem.ts:88-91) states the growl IS the warning; no threat overlay in the GameCanvas render tree (src/engine/GameCanvas.tsx:456-529).

**Fix.** Add an on-screen threat indicator (edge vignette or directional danger arrow) plus an optional AT live-region announcement driven by the same anyAlert()/isStalking() edges.

### 4. [minor] HUD telemetry is a polite live region — screen-reader chatter while moving · _judgment call_

The top telemetry cluster is a role=status live region whose text is the compass point plus whole-number speed. Because it re-renders on every rounded speed or compass-sector change, a screen-reader user starting/stopping or turning will hear repeated 'explorer status …' announcements — constant, low-value chatter during normal play.

**Evidence.** src/ui/Hud.tsx:32 `<div className="hud-telemetry" role="status" aria-label="explorer status">` containing compass/speed; hudStore emits on any rounded speed/heading/sprint change (src/ui/hudStore.ts:59-70).

**Fix.** Drop role=status from the telemetry (make it a plain non-live label), or only announce meaningful transitions.

### 5. [minor] Nav markers are aria-hidden and carry no landmark identity

The compass/nav hints are entirely aria-hidden, so screen-reader users get no directional wayfinding at all. For sighted players the on-screen markers show only a distance ('68 m') with no landmark name — the sole per-target differentiator between simultaneous markers is a coloured dot/arrow, and those hues (blue/orange/yellow, observed on screen) are neither explained to the player nor colourblind-distinct.

**Evidence.** src/ui/NavMarkers.tsx:25 wrapper is aria-hidden="true"; NavSystem sets label to distance only (src/ui/NavSystem.ts:55 `const label = ${Math.round(dist)} m`); markers differ only by --nav-color (NavMarkers.tsx:33,48); HUD screenshot shows blue/orange/yellow arrows labelled only with metres.

**Fix.** Give markers a textual/shape identity (or icon) beyond colour, and expose an AT-readable 'nearest clue: <name>, <distance>, <direction>' cue.

### 6. [minor] No FOV control for a first-person game (fixed 60°) · _judgment call_

The vertical FOV is hard-coded to 60° (≈91° horizontal at 16:9 — a comfortable default, not a narrow/nausea-inducing one) with no user-adjustable FOV setting anywhere in Settings/SettingsMenu. The genuine gap is the lack of an FOV slider as an optional comfort feature, not a too-narrow default.

**Evidence.** src/engine/GameCanvas.tsx:196 `new THREE.PerspectiveCamera(60, 1, 0.1, 2000)`; src/settings/settingsStore.ts Settings interface has only muted/quality/reducedMotion/showDiscoveredMarkers — no fov field; SettingsMenu (src/ui/SettingsMenu.tsx) exposes no FOV control.

**Fix.** Add a persisted FOV setting (e.g. 60–100°) applied to the PerspectiveCamera, surfaced in the pause menu.

### 7. [minor] No input remapping and no left-handed layout · _judgment call_

Controls are not remappable and the touch joystick side is fixed to the left with no left-handed swap (settingsStore has no keybinding/handedness fields; input.ts hard-codes JOYSTICK_ZONE_FRACTION=0.45). This is a real accessibility enhancement gap. Note: there is no 'accessibility brief' in the repo mandating remapping, and partial alternatives already exist (arrow keys mirror WASD per input.ts:129-132, plus gamepad support), so it is a missing-feature request rather than a blocking bug.

**Evidence.** src/ui/controlScheme.ts:41-51 static KEYBOARD_ENTRIES; src/player/input.ts:307-309 JOYSTICK_ZONE_FRACTION=0.45 'joystick spawns only in the left share', look on the right (input.ts:372-390); settingsStore has no keybinding/handedness fields.

**Fix.** Add at least a left-handed toggle that mirrors the touch zones, and ideally a remappable interact/move key set.

### 8. [minor] No text-size / UI-scale option; several sub-11px HUD labels

No in-game text-size/UI-scale setting exists (settingsStore.ts has no scale field), and the persistent .discovery-remaining 'N to go' line renders at 0.65rem ≈ 10.4px (tokens.css:870) — below a comfortable minimum for low-vision players, with no way to enlarge it. The speed unit (0.7rem, ~11.2px) and nav labels (0.7rem) are also small but marginally over 11px.

**Evidence.** src/tokens.css:870 .discovery-remaining font-size 0.65rem; tokens.css:836 .hud-stat__unit 0.7rem; nav labels tiny (HUD screenshot); settingsStore has no textScale field.

**Fix.** Raise the smallest HUD label sizes and/or add a UI-scale setting.

### 9. [minor] Onboarding/tutorial does not pause the sim — slow readers take damage while learning

The first-run controls overlay does not pause the sim (Onboarding.tsx:24-29; no 'onboarding' pause reason in GameCanvas), unlike menu/journal/reveal which all pause. While it is up, hunger and thirst continue draining (SurvivalSystem.ts:138-152), so slow/AT readers lose survival headroom while learning. This is a real inconsistency worth fixing, but low-impact: over a realistic read the loss is a small slice of hunger/thirst with no health damage (health only drains after a meter hits zero, ~7 min), stamina regenerates while idle (so it is NOT lost), and the player spawns at camp.

**Evidence.** src/ui/Onboarding.tsx:26-29 'It does NOT pause the sim — the world keeps running behind it'; GameCanvas mounts Onboarding without any session.setPaused (src/engine/GameCanvas.tsx:511), and only menu/journal/reveal set pause reasons (GameCanvas.tsx:329-339).

**Fix.** Pause the session under an 'onboarding' reason while the first-run overlay is open (mirroring the menu/journal pause).

### 10. [minor] Sound is a single mute toggle — no volume or per-channel control · _judgment call_

The only audio control is On/Muted. There is no master volume, and no separate control for the ambient bed vs. survival/warning SFX. Players who need to lower the loud jungle/rain ambience but keep the wildlife warning cues audible (or vice versa), or who simply need a quieter overall mix, cannot — it is all-or-nothing.

**Evidence.** src/ui/SettingsMenu.tsx:56-67 renders a single Sound switch ('On'/'Muted'); src/settings/settingsStore.ts:12-18 Settings has only a boolean `muted`; AudioSystem only calls engine.setMuted (AudioSystem.ts:220,254).

**Fix.** Add a master volume slider and, ideally, separate ambient/SFX levels backed by the audio engine's gain nodes.

### 11. [minor] Survival meters lose their only critical-low cue under reduced motion, and have no numeric readout · _judgment call_

Under reduced motion the low-meter flash (tokens.css:452-455) is removed with no motion-free substitute of equal salience, and there is no on-screen numeric readout (value lives only in the aria-label, SurvivalMeters.tsx:47) on a 7px bar whose fill colour never shifts with value. The bar width still shrinks with the value, so it is not a total loss of cue — but the low-state warning becomes much less salient for reduced-motion / low-vision non-AT users. A value-driven colour shift or an on-screen number would close the gap.

**Evidence.** src/tokens.css:446-455 meter--low is animation-only, suppressed under both reduced-motion gates; fill colours are constant per meter (tokens.css:396-400); values exposed only via aria-label, not on screen (src/ui/SurvivalMeters.tsx:47); .meter__track height 7px (tokens.css:379-387); HUD screenshot shows four thin unlabelled bars.

**Fix.** Give the low state a non-motion cue (colour shift/outline/icon change) that survives reduced motion, and offer an optional numeric value on the meters.

### 12. [minor] Taking damage has no on-screen feedback

When the player is bitten, mauled, or drained to a health hit, the only feedback is an audio 'hurt thud' plus a silent decrement of the thin bottom-left health bar. There is no screen-edge red flash, no vignette, and no directional damage indicator. Deaf/muted players, or anyone not watching the corner meters, can be losing health without any salient signal.

**Evidence.** src/audio/AudioSystem.ts:323 plays hurtThud on a health drop; grep of src/ui and src/tokens.css for hurt/damage/vignette/red-flash returns no damage-linked visual; the health meter updates silently (src/ui/SurvivalMeters.tsx).

**Fix.** Add a brief screen-edge damage flash/vignette (respecting the reduced-motion/photosensitivity gate) tied to the same health-drop edge the audio uses.

### 13. [polish] Onboarding never teaches the journal key (J)

The first-run keyboard control list omits J (open journal) entirely, listing only WASD, Mouse, Shift, Space, E and Esc. The only always-visible mention of J is the bottom HUD reminder strip, which is aria-hidden — so a keyboard/screen-reader user is never told how to open the journal that tracks their clues.

**Evidence.** src/ui/controlScheme.ts:41-51 KEYBOARD_ENTRIES lists no J; the J handler exists in src/engine/GameCanvas.tsx:404-411; the HUD strip that names 'J journal' is aria-hidden (src/ui/Hud.tsx:84).

**Fix.** Add a 'J — Journal' entry to the keyboard control scheme taught in onboarding.

---

## Performance & Loading  
_9 issues — 4 major, 3 minor, 2 polish_

### 1. [MAJOR] High tier sits at 97% triangles and spikes to 148/150 draw calls — effectively zero headroom, above the doc's own worst case

On high tier the spawn camp-vista sits at ~97% of the triangle budget (measured avg ~123 draws / ~486k tris) with per-frame maxima of ~145 draws / ~488k tris — the ~2s PMREM env rebake landing on an already-97%-full frame. The max draw count exceeds the perf-budget doc's own ~135-140 'theoretical worst' estimate. Nothing breaches today (all under 150/500k), but planning headroom is effectively nil: any spawn-visible feature adding a few thousand triangles or a couple of draws crosses the budget.

**Evidence.** Measured with scripts/measure-frame-cost.mjs (repeated: 121 draws / 485,134 tris on high) and a real-GPU driver (--use-gl=angle --use-angle=metal): spawn max draws=144, late-session max draws=148, max tris=489,568. docs/perf-budget.md:673-684 records 121 draws / 485,582 tris (97.1%) and '~135-140 theoretical worst' for draws.

**Fix.** Reclaim draw-call headroom on high (merge/instance more of the camp/ruin site meshes, or reduce chunk-cell count) and cap the per-frame draw total so an env-bake frame can't tip past 150.

### 2. [MAJOR] Live perf guard (StatsOverlay/getState) is blind on the compositor tiers — always reports 1 draw / 1 triangle

Engine.getState() reads renderer.info.render.calls/triangles, but on medium/high the EffectComposer calls renderer.render() several times per frame (RenderPass, N8AO, EffectPass) with autoReset on, so renderer.info ends each frame reflecting only the final fullscreen-triangle output pass. I measured engine.draws=1 on high tier while the raw GL layer counted 121. StatsOverlay feeds these bogus 1/1 values into checkFrame, so its 'turns red the instant draw calls/triangles exceed budget' guarantee (perf-budget.md's documented live enforcement) can never fire on exactly the tiers running at 97% of the triangle budget. A developer watching the overlay on a high-tier machine sees '1 draws, 0k tris, within budget' regardless of the real cost.

**Evidence.** src/engine/Engine.ts:247-255 (getState reads renderer.info.render); src/perf/StatsOverlay.tsx:19,26-29 (feeds getState into checkFrame); src/engine/createCompositor.ts:407-420 (EffectComposer, multi-pass composer.render). Measured live: `render_game_to_text()` reported engine.draws=1 / engine.draws=1 on high tier while instrumented GL counted avg 120-121 draws / 485k tris. perf-budget.md:5,1225-1227 claims the overlay flags a live breach.

**Fix.** Have the compositor path expose the true per-frame draw/triangle totals to getState (e.g. sum renderer.info across composer passes with autoReset off, or wire an instrumented counter) so the overlay and checkFrame reflect reality on medium/high.

### 3. [MAJOR] No automated whole-scene budget guard — a total-scene regression over 500k tris / 150 draws ships silently

The test suite asserts only per-component budgets (jaguar < 2000 tris, wildlife aggregate < 40k, boundary quad counts). Nothing in npm test / CI asserts the assembled scene stays under the 500k-triangle / 150-draw whole-frame budget from PERF_BUDGET. The only whole-scene check is the manual scripts/measure-frame-cost.mjs, which is not wired into CI. With the high tier already at 97% and draws spiking to 148, any feature that adds a few thousand triangles or a couple of draws visible from spawn crosses the budget with no red gate to catch it.

**Evidence.** grep of src/**/*.test.ts: budget assertions only per-component (src/wildlife/jaguar.test.ts:381 expect(tris).toBeLessThan(2000); src/wildlife/wildlife.test.ts local ≤40k). No test references maxTriangles/maxDrawCalls against an assembled scene. scripts/measure-frame-cost.mjs header notes it is run manually, and it is not in package.json's CI-run scripts (only check:bundle is gated).

**Fix.** Add a headless-or-instrumented perf assertion (or a required CI job running measure-frame-cost) that fails when the high-tier spawn scene exceeds a headroom threshold below the 500k/150 caps.

### 4. [MAJOR] The mid-range phone the budget targets runs the MEDIUM tier — which has never been fps-measured on mobile-class hardware

The whole perf story assumes low = the mobile stand-in, but the device heuristic caps touch devices at medium (not low) and only drops to low at ≤2 cores / ≤2 GB or (touch && ≤3 GB && dpr≥2). I simulated the exact logic: a 4 GB+ mid-range phone (iPhone SE, typical Android) resolves to MEDIUM, which carries the full fill-rate stack (bloom+N8AO+SMAA+vignette+tone-map merged pass, real-time shadows, water displacement, 8-sample terrain splat, fog, and a PMREM env rebake every ~2s). The only mobile-representative measurement in the whole project is the software-GL LOW-tier render gate; the doc itself admits its headless 120 fps 'is NOT a mobile-equivalent fps figure.' So the 'runs on a mid-range phone ≥30 fps' bar is unverified for the tier those phones actually get, and that tier is materially heavier than the low tier used as the stand-in.

**Evidence.** src/perf/deviceCapability.ts:65-87 (touch caps at medium; low only at ≤2 cores/≤2GB or touch&&≤3GB&&dpr≥2) — simulated: 4-8GB touch phones => medium, only 3GB+dpr2 => low. Full medium stack in src/perf/quality.ts:205-227 (bloom/shadows/waterDisplacement/terrainDetail:full/envDynamic all true). docs/perf-budget.md:694-698 concedes headless fps is not a mobile figure and only the software-GL low gate is the mobile stand-in.

**Fix.** Get a real fps measurement of the MEDIUM tier on a mobile-class GPU (throttled or a physical device) and either confirm ≥30 fps or move the fill-heavy knobs (N8AO, shadows, water displacement) down a tier for touch devices.

### 5. [minor] JS-gzip bundle headroom is thin (406.9 / 432 KB) after a recent cap raise

npm run check:bundle reports 406.9 KB of the 432 KB JS-gzip cap used — only 25.1 KB free — and the cap was itself just raised 400->432 for the reactive-jungle epic. The eager entry chunk has grown to 114.4 KB gz (the doc's last recorded slice baseline was ~99.7 KB), all of it downloaded and parsed on every tier including low and on the TTI path. The budget still passes, but the remaining margin does not survive one more meaningful feature's JS.

**Evidence.** npm run check:bundle: 'JS gzip: 406.9 KB / 432 KB (25.1 KB headroom)'. Build output: index-*.js 356.4 KB raw / 114.65 KB gz. src/perf/perfBudget.ts:35-39 documents the 400->432 raise. docs/perf-budget.md history shows slices closing at ~390-393 KB.

**Fix.** Audit the eager entry chunk for game logic that could move behind the existing dynamic-import seams (wildlife/quest/fx systems) so low-tier + TTI stop paying for medium/high-only behaviour.

### 6. [minor] PMREM environment rebake runs a full fromScene blur chain every ~2s for the entire session on medium/high

On envDynamic tiers (medium/high) EnvLightSystem rebakes scene.environment via PMREMGenerator.fromScene (size 96, cubemap capture + equirect/blur mip chain) about once every 2s for the whole session — the day cycle is always moving so the palette delta clears the 0.05 threshold at nearly every 2s slot (test: ~88 rebakes/180s loop). Each bake is a burst of extra draw calls/fill in that single frame. Measured on high tier: baseline ~117-122 draws vs a bake-frame spike of ~140-167 (some frames exceed the 150 draw-call budget). A steady per-couple-of-seconds spike; possible micro-stutter on fill-bound mid-range GPUs is plausible but device-dependent.

**Evidence.** src/world/envBakeScheduler.ts:47-50 (minIntervalSeconds:2, deltaThreshold:0.05) with the doc noting a rebake 'roughly every 2.0-2.1s almost everywhere in the loop' (envBakeScheduler.ts:38-45); src/world/envLightSystem.ts:167-168 (shouldRebake -> bake in update) and :186 (pmrem.fromScene, size 96). Measured draw spikes to 144-148 (vs avg 121) on high tier correlate with this ~2s cadence.

**Fix.** On the medium tier, throttle the rebake cadence further (e.g. 4-6s) or interpolate between two cached bakes so the per-frame GPU burst is amortized rather than paid whole every 2s.

### 7. [minor] three (532 KB raw / 134 KB gz) is eagerly modulepreloaded and parsed before the title screen, which never uses it

App statically imports GameCanvas, which statically imports three, so the built index.html modulepreloads the three chunk and the entry graph must download+parse it before React can paint the TitleScreen — even though the title screen (the first interactive surface) uses no three at all. On a slow connection the title paints ~1s later than necessary, and on a mid-range phone the ~532 KB raw three parse runs on the main thread up front. TTI still measured within budget (~2s on slow 4G), so this is first-paint/parse waste rather than a breach.

**Evidence.** dist/index.html contains `rel="modulepreload" href=.../three-TwqS59jd.js`; entry index-*.js statically pulls three via src/App.tsx:4 -> src/engine/GameCanvas.tsx:2 (`import * as THREE from "three"`). grep confirms src/ui/TitleScreen.tsx imports no three. Build: three chunk 531.8 KB raw / 133.8 KB gz.

**Fix.** Lazy-load GameCanvas (React.lazy / dynamic import) so the title screen paints on the React+entry chunks and three downloads only when 'Begin the expedition' is pressed.

### 8. [polish] God-rays internal pass runs every frame on high tier even at noon when its contribution is 0

On high tier the GodRaysEffect is part of the merged EffectPass and its light-shaft render is executed every frame; godRaysStrength returns 0 for a high (noon) sun so the blend opacity is set to 0 and nothing is visible, but the effect's internal shaft/sampling pass still runs, spending fill rate for an invisible result across the whole midday portion of the day cycle. Needs-verification on the exact fill cost, but it is a steady per-frame spend with no visible payoff most of the day.

**Evidence.** src/engine/createCompositor.ts:162-166 (godRaysStrength returns 0.6*(1-raised) => 0 at high sun), :207-241 (buildGodRays; update only sets blendMode.opacity, the pass is always in the EffectPass), :360-362 (godRays.effect always added to the high-tier EffectPass).

**Fix.** Skip / short-circuit the god-rays pass when its computed opacity is ~0 (e.g. gate it out of the merged pass when sunDirY is above the noon threshold) so midday frames don't pay for invisible shafts.

### 9. [polish] antialias:true allocates an MSAA backbuffer that is unused on the composited (medium/high) tiers

createRenderer always builds the WebGLRenderer with antialias:true. On medium/high the scene renders into the EffectComposer's own single-sampled HalfFloat targets and SMAA does the antialiasing; the canvas's multisampled default framebuffer is only touched by the final fullscreen-triangle present, where MSAA gives no benefit. The multisampled backbuffer is therefore allocated (extra GPU memory/bandwidth on resolve) for nothing on exactly the tiers with the tightest fill budget. Needs-verification on the exact per-device cost.

**Evidence.** src/engine/createRenderer.ts:25-29 (antialias: config.antialias ?? true, and GameCanvas passes no antialias so it defaults true); src/engine/createCompositor.ts:407 (EffectComposer built with {frameBufferType: HalfFloatType} and no multisampling option => scene AA comes from SMAAEffect at :316, not MSAA).

**Fix.** Pass antialias:false when a compositor will be built (medium/high) since SMAA covers AA there; keep antialias:true only on the bare low-tier path.

---

## Correctness & Bugs  
_7 issues — 1 major, 6 minor_

### 1. [MAJOR] Enter used on a modal button leaks an interact edge — auto-opens and discovers the base-camp clue on onboarding-dismiss and on respawn

The input layer arms the interact edge on any Enter/'e' keydown via a window-level listener regardless of focus or modal state (input.ts:107-109). Modals that are dismissed with Enter don't drain that edge before the sim resumes, so the queued press is consumed on the next unpaused frame by DiscoverySystem, opening AND marking-discovered whatever site is in range. At the camp spawn the base-camp site is always in range, so both the first-run onboarding 'Got it' and the death overlay 'Wake at camp', when activated with Enter, spuriously pop the base-camp clue panel and credit an unearned discovery. Every keyboard/assistive-tech player hits this; the journal→reveal handoff already drains the edge (GameCanvas.tsx:517), but respawn (buildGame.ts:317-322) and onboarding dismiss (Onboarding.tsx:56-59) do not.

**Evidence.** Demonstrated with Playwright: dismissing onboarding with Enter -> discovery goes discovered 0->1, open='site-base-camp'; dying then pressing Enter to respawn -> discovered 0->1, open='site-base-camp'. Root cause: input.ts:109 arms interactQueued on Enter; SurvivalSystem.respawn (SurvivalSystem.ts:124-136) clears the 'death' pause synchronously so the edge survives into the first live frame; DiscoverySystem.ts:91-98 consumes it and opens+persists the site. Onboarding.tsx:26-29 confirms it never pauses, so the edge isn't drained there either.

**Fix.** Drain the interact edge (call consumeInteract) inside respawn and on onboarding dismiss, or ignore keydown-armed interact when the event target is a button/dialog — mirroring the journal→reveal handoff that already does this.

### 2. [minor] "Dig-locked" hint claims the key is never pressable, but at the dig patch the interact key actually reads the fig's page (and the touch button is disabled there)

At the dig patch with a page still unread, the interact-key priority ladder returns 'dig-locked' (disabled) which outranks 'read', even though the fig site is always in read range there. On DESKTOP this is fine: RevealPanel shows a 'Press E to read' prompt for the fig and E does read it. The real, touch-only defect: the same reveal-prompt shows 'Tap Read' while TouchActionButton renders a DISABLED lock button (TouchActionButton.tsx:66-77), so a touch player is told to Tap Read but has no working button and cannot read the in-range fig page while standing on the dig patch — recoverable only by stepping >5 m off the patch, with no cue to do so.

**Evidence.** actionPriority.ts:49-57 returns kind:'dig-locked' with disabled:true before the siteInRange->'read' branch at :58. TouchActionButton.tsx renders disabled={locked}. buildTreasure.ts:125-128 derives digPoint from DIG_LOCAL(2.9,2.9) on the fig group; QuestSystem.ts:129/152 shows the dig press is not consumed unless every page is read; DiscoverySystem.ts:91 then opens the in-range fig.

**Fix.** At the dig with pages missing, either let 'read' outrank 'dig-locked' when a site (the fig) is in range, or keep dig-locked informational but still surface/allow the readable fig page (enable the touch button for reading).

### 3. [minor] "Reset progress" only clears clue discovery — leaving the game unwinnable after a win

The pause-menu 'Reset progress' (src/engine/GameCanvas.tsx:419, note: file is under src/engine/ not src/ui/) wires only to discovery.reset(), which clears just the discovered set + persistence (DiscoverySystem.ts:106-112). QuestSystem has no reset, so treasureFound stays true after a win and digLive is gated false forever (QuestSystem.ts:133) — the dig is permanently spent and the revealed chest stays in the world. Yet the journal is wiped to 0/6 (clueIds = the 6 POI_ANCHORS) and NavSystem re-shows a marker for every now-undiscovered POI, presenting a fresh-looking quest the player can never complete. The honest full reset is only the 'Replay' path, which reloads (GameCanvas.tsx:424-427). 'Reset progress' is a legacy pre-pivot button not covered by the design spec, and the code comment at 421-427 acknowledges it is only a partial reset.

**Evidence.** GameCanvas.tsx:419 resetProgress = () => game?.discovery.reset(); DiscoverySystem.reset (DiscoverySystem.ts:106-112) clears only the discovered set/persistence. No reset path exists on QuestSystem/SurvivalSystem; QuestSystem.ts:133 keeps the dig dead once treasureFound. (Full reset is only via 'Replay', which reloads — GameCanvas.tsx:424-427.)

**Fix.** Either scope the label to 'Reset journal', or make Reset progress also re-arm the quest (re-bury the idol / clear treasureFound) and restore meters so the reset world is actually playable/winnable.

### 4. [minor] First-run onboarding does not pause the sim — meters drain, wildlife stays live, and the win-screen time inflates while the player reads the tutorial

On first run the onboarding overlay does not pause the sim (Onboarding.tsx:26-29), so hunger/thirst decay, wildlife moves, and QuestSystem keeps counting playSeconds while the player reads controls they cannot act on. Verified: after 120s of onboarding-up, hunger 100->82, thirst 100->71, playSeconds 0->120. The one hard correctness bug is that the tutorial-reading time is baked into the win-screen 'Expedition time'; the meter drain is recoverable and once-per-player.

**Evidence.** Demonstrated with Playwright on a fresh context (onboarding shown, not dismissed): after advanceTime(120s) hunger fell 100->82 and thirst 100->71 with the 'Got it' button still present. Contrast: with the pause menu open for 120s, hunger/thirst held at 82/71 (menu correctly pauses). Onboarding.tsx:26-29 documents 'It does NOT pause the sim.'

**Fix.** Have the onboarding set a session pause reason (e.g. session.setPaused('onboarding', open)) like every other modal, so decay, wildlife and the play-clock hold until it is dismissed.

### 5. [minor] No WebGL context-loss handling — canvas freezes with no feedback and the fps read-out corrupts to ~120

Nothing in the renderer, Engine, or GameCanvas listens for 'webglcontextlost'/'webglcontextrestored' (the only loseContext reference is a device-capability probe). On a GPU context loss — common on mobile after backgrounding or a driver reset, the primary shared-link target — the rAF loop keeps running with no player-facing message and the stats/telemetry fps read-out inflates to a bogus value; recovery depends entirely on three.js re-initialising on an automatic browser restore. If the browser does not auto-restore (e.g. too many contexts), the canvas stays blank/frozen indefinitely with running:true and no indication anything is wrong.

**Evidence.** grep found no context-loss listeners in src (only deviceCapability.ts:118 uses loseContext to probe). Playwright: after gl.getExtension('WEBGL_lose_context').loseContext(), console logged 'THREE.WebGLRenderer: Context Lost.' yet render_game_to_text still reported running:true, fps 95.7-119.78 (bogus), drawCalls unchanged (stale). advanceTime did not throw; restoreContext() logged 'Context Restored' but fps stayed at 119.78.

**Fix.** Add canvas 'webglcontextlost'/'webglcontextrestored' handlers: preventDefault + stop the loop + show a brief 'rendering paused' notice on loss, and re-start (and reset the fps EMA) on restore.

### 6. [minor] Phantom drink animation on respawn when death happens with mid-range thirst

HandsSystem infers a 'drink' from any thirst rise no larger than DRINK_RISE_MAX=35 (hands.ts:136,188-190), the guard intended to ignore the respawn refill. But respawn sets thirst to respawnLevel=75 (SurvivalSystem.ts:57,128), so the guard only works when the player died with thirst below 40 (e.g. starvation). Any death with thirst in the (40,75) range — a snake/jaguar strike or drowning while still fairly hydrated — produces a rise under 35 and triggers a spurious hand-cupping-to-mouth drink animation on wake, even though no drink occurred.

**Evidence.** hands.ts:189 `thirst > this.lastThirst && thirst - this.lastThirst <= DRINK_RISE_MAX` fires start('drink'); DRINK_RISE_MAX=35 (hands.ts:136); respawn refills thirst to 75 (SurvivalSystem.ts:128, respawnLevel=75 at :57). For thirstAtDeath in (40,75) the rise is in (0,35] -> mis-detected as a drink. (Starvation death, thirst=0->75=+75>35, is correctly ignored — confirmed via the death drive.)

**Fix.** Detect the refill by watching the respawn/alive edge (or the health+hunger jump) rather than a magic thirst-delta threshold, and reset HandsSystem's lastThirst baseline inside respawn.

### 7. [minor] Sprint has no re-engage hysteresis — it chatters on/off at the stamina floor

The sprint gate is a single threshold with no re-engage hysteresis: canSprint = alive && stamina > 10 (SurvivalSystem.ts:44,100), read each frame by the explorer (explorer.ts:233). Because drain (FULL/6 ~16.67/s) exceeds regen (FULL/10 = 10/s), holding sprint at the stamina floor makes stamina oscillate across 10 and the sprinting flag flip on/off every few frames. Observable symptoms: the HUD 'SPRINT' badge flickers against the compass letter (Hud.tsx:34) and the AudioSystem breathe() panting cue re-fires on every re-engage rising edge (AudioSystem.ts:301), producing a stuttering pant. The actual movement speed does NOT visibly jitter because the speed target is damped (MathUtils.damp, accelLambda=9, explorer.ts:275); only the flag/target/thirst-multiplier flicker at the variable level.

**Evidence.** SurvivalSystem.ts:100 `canSprint = () => this.alive && this.stamina > TUNE.sprintMinStamina` with sprintMinStamina=10 (:44); explorer.ts:233 `this.sprinting = moving && c.sprint && (this.canSprint?.() ?? true)`. Drain 100/6≈16.7/s vs regen 100/10=10/s means stamina oscillates across the single 10 boundary while sprint is held.

**Fix.** Add hysteresis: require a higher stamina (e.g. ~25) to RE-engage sprint after exhaustion while keeping the drop-out at 10, so exhausted sprinting settles instead of chattering.

---

## Persistence & The Returning Player  
_8 issues — 3 major, 5 minor_

### 1. [MAJOR] 'Continue' respawns at camp with full meters — it does not resume the run · _judgment call_

A raw reload always lands on the title screen (initial app state is 'title', no screen is persisted), which offers 'Continue' plus the saved page count — strongly implying a resume. But Continue mounts a brand-new game: survival meters snap back to FULL and the player is teleported to the base-camp spawn regardless of where they were. A player who trekked to the far eastern fig and was near death 'continues' fully healed back at the lagoon, losing all traversal and survival state.

**Evidence.** appState.ts:19 INITIAL_APP_STATE={kind:'title'} with no persisted screen; buildGame.ts:107 createSurvivalStore() returns FULL meters (survivalStore.ts:33-47); buildPlayer.ts:41 always inits position to SPAWN; SPAWN=(-34,124) vs the fig at (108,-46) (worldConfig.ts:101-122). Only discovered ids persist (persistence.ts KEY aboutmegame.discovered.v2). TitleScreen.tsx:64,85-87 labels the CTA 'Continue' whenever discovered>0.

**Fix.** Persist and restore player position and survival meters on Continue, or relabel the CTA and messaging so it never promises a resume it doesn't deliver.

### 2. [MAJOR] Reload after a win re-buries the idol — 'Continue' drops you into a solved world with the treasure gone · _judgment call_

treasureFound is never persisted, so after winning, a reload reconstructs a world with all six pages read but the idol re-buried and hidden. 'Continue' (or a raw reload) drops the player at camp in a coherence limbo: every clue is already read so nothing points anywhere, all nav markers are hidden because every site is discovered, and the only way to re-see the ending is to remember the far fig's location, trek there unaided, and re-dig. The game silently un-wins the player after their climax.

**Evidence.** persistence.ts stores only the discovered id array; QuestSystem.ts:71 treasureFound resets to false and buildTreasure.ts builds group.visible=false (reveal only fires on a completed dig). NavSystem.ts:52 skips markers for discovered pois by default, so 6/6 hides all markers. QuestSystem registers before discovery (buildGame.ts:135-152), so at the fig the dig owns the interact key and the fig page can't be reopened. Empirically: seed all 6 ids, click Continue → quest {clues:'6/6',treasure:false,missingPages:0}, discovery 6/6, nearby=site-base-camp.

**Fix.** Persist treasureFound and, when restored, keep the idol revealed and route the returning player to a coherent post-win state (win recap / free-roam) instead of re-burying it.

### 3. [MAJOR] Win-screen stats reset on any reload — completion numbers are a lie · _judgment call_

The expedition timer, death count and fruit-eaten count are never persisted; they are recreated fresh on every GameCanvas mount. If a player reloads (or the tab reloads) at any point and later completes, the win screen's 'Expedition time', 'Times the jungle won' and 'Fruit eaten' report only the post-reload slice, not the real run. For a game whose single payoff is a shareable completion summary, the headline numbers are wrong.

**Evidence.** buildGame.ts:107-109 create fresh survival/forage/quest stores each mount; QuestSystem.ts:67 playSeconds starts at 0; questStore reads deaths from the fresh survivalStore (survivalStore.ts:37-47, deaths=0) and fruitEaten from the fresh forageStore (forageStore.ts:22, eaten=0); TreasurePanel.tsx:97,107,111 render q.playSeconds/q.deaths/q.fruitEaten. Empirically: seeding all 6 clue ids then clicking Continue and advancing 2s, window.render_game_to_text shows quest playSeconds=3 (a fresh clock), not any restored total.

**Fix.** Persist playSeconds, deaths, fruitEaten (and load them into the quest/survival stores at build time) alongside the discovered set, or explicitly reset discovery too so reload is an honest full restart.

### 4. [minor] A reload during the ~4.5s finale window silently voids a completed dig · _judgment call_

When the dig completes, the chest rises and a finale runs for ~4.5s before treasureFound flips and the win panel appears. Nothing about that in-progress win is persisted. A reload in this window (chest already out of the ground) resets finaleRemaining and treasureFound, re-buries the chest, and drops the player back at camp — the player who visibly dug up the idol loses the win with no record and must re-dig.

**Evidence.** QuestSystem.ts:113-119 flips treasureFound only after finaleRemaining (TUNE.finaleSeconds=4.5, QuestSystem.ts:11) elapses; reveal() and onFinaleStart() fire at :147-149 during the live window; none of finaleRemaining/treasureFound is persisted (persistence.ts). On reload QuestSystem re-initialises with finaleRemaining=null, treasureFound=false (QuestSystem.ts:69-71).

**Fix.** Persist the win the instant the dig completes (or on finale start), not only after the 4.5s spectacle, so an interrupted finale still counts.

### 5. [minor] Completion is not a persisted state — the title can't tell a winner from someone who only read every page · _judgment call_

The title's progress readout is derived purely from the discovered-page count, and winning is never recorded. A player who dug up the idol and one who merely walked to all six sites without digging both see the identical '6 of 6 pages found' + 'Continue' on return. There is no 'expedition complete' acknowledgement anywhere in the returning-player journey, and the model literally cannot represent 'you won'.

**Evidence.** TitleScreen.tsx:41-47 readProgress() counts only persisted discovered ids; TitleScreen.tsx:79-87 renders 'N of total pages found' and a 'Continue' CTA on discovered>0. treasureFound is absent from persistence.ts. Empirically the all-6-seeded title reads '6 of 6 pages found / Continue' with no completion state.

**Fix.** Track a persisted 'idol found' flag and surface a distinct completed state on the title (e.g., 'Expedition complete — Replay / Revisit').

### 6. [minor] Mid-run reload yields a self-contradictory play state (read pages, brand-new body) · _judgment call_

On a mid-expedition reload the world is half-restored: the journal and page counter reflect prior exploration while the survival meters, timer, death count and position all read as a player who just woke up at camp. The live state contradicts itself — you've demonstrably explored (journal shows N read pages) yet the game insists it's minute zero of a fresh, full-health run at the spawn point.

**Evidence.** Empirically: seeding 3 clue ids then Continue → window.render_game_to_text shows discovery {discovered:3,total:6} but quest playSeconds fresh (3 after a 2s advance) and nearby=site-base-camp, with full meters. Root: discovery loads from persistence.ts while buildGame.ts:107-109 rebuild every other store fresh and buildPlayer.ts:41 pins position to SPAWN.

**Fix.** Make persistence atomic across all run-state systems (position, meters, timer, counters, quest) so a restore is internally consistent, or persist nothing and treat every launch as a clean run.

### 7. [minor] Reload is a free survival reset that keeps clue progress · _judgment call_

Because survival meters are recreated at FULL on every mount while discovered pages persist, a player about to die of thirst/hunger can reload and click Continue to wake fully restored with all their clue progress intact. Reload becomes an out-of-band survival reset, undercutting the survival stakes the design leans on (the position cost of respawning at camp is the only friction).

**Evidence.** buildGame.ts:107 createSurvivalStore() → FULL health/hunger/thirst/breath (survivalStore.ts:33-47) with no load path; discovered ids survive via persistence.ts. Meters have no persisted seed anywhere in buildGame.ts.

**Fix.** Persist survival meter values with the rest of the run state so a reload cannot launder a near-death situation into full health.

### 8. [minor] TreasurePanel's reload guard defends a state that can never be restored · _judgment call_

TreasurePanel captures the first treasureFound snapshot as a baseline and comments that 'if the very first snapshot already says treasureFound, that is restored state' — implying a finished session can be reloaded already-won. But treasureFound is never persisted, so on reload the baseline is always false; the guard's named scenario cannot occur. It is a dead guard reflecting an intended win-persistence that was never implemented, masking the real gap.

**Evidence.** TreasurePanel.tsx:47-52 baselineRef initialised from q.treasureFound with the 'restored state' comment; persistence.ts saves only discovered ids and QuestSystem.ts:71 always starts treasureFound=false, so no reload path can hand the panel treasureFound=true at first render.

**Fix.** Either implement win persistence (making the guard meaningful) or drop the misleading 'restored state' rationale so the code doesn't imply a save that isn't there.

---

## Share Flow  
_7 issues — 2 major, 5 minor_

### 1. [MAJOR] Fixed-seed world makes expedition time a real cross-player challenge, and share throws it away · _judgment call_

WORLD.seed is a hard-coded constant ('fixed so the world is identical every load'), so every player runs the exact same island — which makes expedition time a directly comparable, leaderboard-grade metric and 'beat my time on the same map' the design-native competitive hook of a solo time-attack. The share feature ignores this entirely, carrying no time, no seed, and no challenge framing, so the most compelling reason a solo hunt would want a share button goes unused.

**Evidence.** worldConfig.ts:34-35 (`/** Random seed for the terrain — fixed so the world is identical every load. */ seed: 20260708`); TreasurePanel.tsx:96-98 renders `formatPlayTime(q.playSeconds)` but never puts it in the share payload; shareCapabilities.ts:58 shares only the bare origin+base.

**Fix.** Frame the share as a same-map time challenge ('I finished in 12:34 — can you beat it?'), since the fixed seed already guarantees a fair comparison.

### 2. [MAJOR] Share sends the bare homepage URL, wasting the one natural completion-brag moment · _judgment call_

The win screen (TreasurePanel) has just frozen a full set of stats — expedition time, pages found, deaths, fruit eaten — and renders them right above the Share button, yet the Share CTA sends only socialUrlHref(BASE_URL), the bare deploy homepage with zero game state. A player who just dug up the Emerald Idol and taps Share hands a friend a naked link to a title screen — no time, no 'I beat it', no proof. The single moment a solo treasure hunt would want to share (the victory) produces the most generic possible payload, so the feature's purpose did not survive the pivot from party-game lobby-link to solo hunt.

**Evidence.** TreasurePanel.tsx:41 (`shareUrl = realShareUrl`), :48 (`useShare(shareCapabilities, shareUrl)`), :80-83 (`handleShare` shares then announces), :94-113 (stats q.playSeconds/cluesFound/deaths/fruitEaten rendered); shareCapabilities.ts:58 (`realShareUrl = socialUrlHref(import.meta.env.BASE_URL)`); useShare.ts:112 (`await capabilities.share({ url })`). Design line 149 specced 'Completion (idol art + stats + replay/share)'.

**Fix.** Compose a completion-brag payload from the frozen stats (e.g. title/text 'I found the Lost Idol in 12:34 — beat my run') and share that alongside the URL.

### 3. [minor] Desktop fallback silently copies a contextless URL and the panel never shows what was shared · _judgment call_

On desktop browsers without a native share sheet (Chrome/Firefox), Share falls through to a clipboard write of the bare deploy URL and announces only 'Link copied' — the player has no idea a link that says nothing about their victory just landed on their clipboard, and the panel never renders the URL so they cannot see or verify it. Desktop is the primary platform for a keyboard+mouse first-person game, so the worst version of the contextless-link problem is also the most common one.

**Evidence.** useShare.ts:126-132 (clipboard `writeText(url)` fallback → 'copied'); shareAnnouncement.ts:27-28 ('Link copied'); TreasurePanel.tsx:125-127 (the only feedback is the live-region text — no anchor/link element renders the shared URL anywhere on the card).

**Fix.** Show the shared text/URL on the card (a read-only field or visible link) so the copied content is inspectable, and make the copied string carry the completion context.

### 4. [minor] Share CTA is never disabled while a share is pending — violates the useShare contract and allows concurrent shares · _judgment call_

useShare's documented caller obligation is to disable the CTA while a share() call is pending, because the hook has no re-entrancy latch and relies on the button's disabled state for double-tap protection. TreasurePanel renders the Share button with no pending state and no `disabled`, so a rapid double-click fires two concurrent share() calls — benign on the clipboard path, but on the native share path it can attempt to open two share sheets or produce an out-of-order announcement.

**Evidence.** useShare.ts:159-163 ('Disable the CTA while a share() call is pending... There is no re-entrancy latch in here; double-tap protection is the button's disabled state.'); TreasurePanel.tsx:118-120 (`<button type="button" className="cta" onClick={handleShare}>` — no `disabled`, no pending state; handleShare at :80-83 tracks none).

**Fix.** Track a pending flag around the await in handleShare and set `disabled` on the Share button while it is in flight.

### 5. [minor] Share button carries primary-CTA weight equal to Replay while producing the least-valuable outcome · _judgment call_

On the win screen, Replay and Share are both full-weight filled primary buttons (`.cta`), while the actual gentle exit (Keep exploring) is the quiet outlined one. Share thus competes visually on equal footing with the real action even though it only copies/sends a contextless homepage link — it reads as an important action but delivers nothing that represents the run, making it feel like leftover chrome rather than a considered feature.

**Evidence.** TreasurePanel.tsx:115-123 (Replay + Share both `className="cta"`, Keep exploring `className="cta cta--quiet"`); tokens.css:156-167 (`.cta` = filled accent, 700 weight) vs :601-604 (`.cta--quiet` = transparent/outlined).

**Fix.** Demote Share to secondary/quiet weight (or make it primary only once it shares a real completion payload).

### 6. [minor] Share is reachable only after winning — no title-screen invite despite the 'just a shared link' premise · _judgment call_

The product's stated distribution model is 'No installs, just a shared link', but the only place a share affordance exists is the win screen, gated behind completing the entire hunt — a state few players reach. The one gesture that actually spreads the game (send a friend the link) is buried behind the wall of finishing it, while the natural entry point (title screen) has none. The original party-game purpose (share the game link to recruit players) lost both its meaning and its placement in the pivot.

**Evidence.** charter.md:13-15 ('No installs, just a shared link'); grep shows the only non-test importer of useShare/realShareUrl is TreasurePanel.tsx:4-6; TitleScreen.tsx has no share control; the #131 run log records the TitleScreen Share CTA as deliberately omitted.

**Fix.** Add a lightweight 'invite a friend' share on the title screen (bare URL is fine there), keeping the win-screen share for the completion brag.

### 7. [minor] The share seam is structurally url-only and cannot carry a title or text · _judgment call_

Even if the win screen wanted to share a completion message, it cannot: the ShareCapabilities.share type accepts only `{ url: string }` and performShare invokes `share({ url })`, dropping the Web Share API's supported `title` and `text` fields. The seam physically forecloses a 'beat my run' brag, so the generic-link problem is baked into the contract, not just the call site — any fix must widen this type first.

**Evidence.** useShare.ts:53 (`share?: (data: { url: string }) => Promise<void>`), :112 (`await capabilities.share({ url })`); shareCapabilities.ts:19,38-39 (ShareNavigatorLike + wrapper both `{ url }` only). No `title:` or `text:` field exists anywhere in the share modules.

**Fix.** Widen ShareCapabilities.share (and the navigator wrapper) to `{ title?; text?; url }` and thread the completion message through performShare.

---

## Checked and dismissed (12)

These were claimed by a finder but the verifier refuted them against the code/design — listed so you don't re-investigate:

- **On the low (mobile-target) tier the centrepiece water is a flat, pale, featureless sheet** — The claim's load-bearing premise is wrong. The low-tier water IS a flat pale sheet with kelp cross-planes showing through as teal shards (confirmed in shots_low/low-lagoon and low-water-grazing) — but low is NOT the mid-range-phone tier and NOT where the majority of players land. detectTier (deviceCapability.ts:65-88) caps any touch/coarse-pointer device at MEDIUM regardless of cores, and low is only forced by a software renderer (CI/SwiftShader), a genuinely weak device (<=2 cores / <=2GB), or an explicit user 'low' setting. A real mid-range phone (undefined deviceMemory/hardwareConcurrency -> assumed 4, coarse pointer) resolves to medium, which ships waterDisplacement ON + waterDetail 'full'. Additionally, low shipping the byte-identical pre-overhaul flat water is an EXPLICIT, documented design decision (perf-budget.md: 'off on low to protect mobile fill rate'; 'low ships byte-identical pre-slice-4 water'). So the observation is accurate only for a minority/intended fallback tier, not the majority experience the claim asserts; per the verdict rules this complains about an explicitly-intended design under a false premise.
- **Heavy fog plus AgX wash the mid/far world to a flat desaturated haze, losing depth and day-cycle warmth** — The concrete, falsifiable sub-claims are refuted. FogExp2 density is only 0.0022 at noon (skyAtmosphere.ts:89/106, rising ~30% at low sun) — that is ~1% fog at 50m and only ~14% at the 178u boundary, so 'the jungle floor loses detail into pale haze within tens of metres' is quantitatively false, and my fresh high-noon-lagoon-horizon and high-noon-jungle-eye renders show crisp, lush foreground/midground. The aerial (my high-noon-aerial-island) shows only the far third fading to haze while the near/mid island stays clearly green and detailed, contradicting 'the whole island fades into a uniform grey-green haze.' The day cycle plainly registers (golden-lagoon is warm tan vs noon's cooler green-grey). Finally the green-tinted humid haze is the EXPLICITLY intended art direction (dayCycle.ts 'Jungle-feel round 2' note: 'humid, green-tinted haze... one hue shift turns the white-out into jungle air'), and fog is a depth CUE, not 'lost depth.' This is a subjective disagreement with an explicitly-intended look plus refuted quantitative assertions.
- **Sprint 'breathe' pants even when fully rested** — The factual premise is correct — AudioSystem.ts:301 fires breathe() on the sprint rising edge with no stamina check. But the framing is refuted. (1) breathe() is the intended sprint-engage cue, not an exhaustion-only sound: AudioEngine.ts:235 docstring is 'Soft panting breath — a quick two-note exhale when sprint engages' and the inline comment at line 300 is 'Sprint rising edge → soft breathing cue'. It is a deliberately soft, low-gain (0.07 peak), 0.32s cue — calling it a 'labored exhale as if exhausted' overstates it. (2) A dedicated test (AudioSystem.test.ts:235, 'fires the breathing cue on the sprint rising edge only') asserts this exact behavior as correct. (3) The interaction with the exhaustion pant was deliberately engineered, not muddied: lines 314-316 re-arm the pant timer to a full interval specifically to avoid double-firing with the sprint rising-edge breath 'when re-engaging while exhausted' — a documented review finding. Exhaustion is distinguished by repetition (1.6s rhythmic panting while stamina<20 and moving), not by a distinct sample. The claim reads an intentional, documented, tested design decision as a defect.
- **Wildlife cannot meaningfully kill you — the threat half of survival is a scare, not pressure** — The tuning numbers are read correctly (snakes.ts:36-39 ALERT 6/STRIKE 1.6/DMG 25, never-chase; jaguar.ts:57-60,300-304 STRIKE 1.8/DMG 45/COOLDOWN 90, one hit then retreat; TERRITORY far from camp/lagoon), but the complaint is against explicitly-intended design. Design pillar 2 (lines 43-45) is "Survival pressure that teaches, not punishes... Death is a setback, never lost quest progress" and locates the pressure in the METERS. The snake spec (line 130-133) verbatim specifies 6 m alert / 1.6 m strike / -25 and "They never chase — the player is always in control of the risk" — the exact numbers the claim calls too weak. The jaguar (owner note "a deadly animal") is documented in jaguar.ts as an approved hit-and-run predator with deliberate outs ("reach the camp clearing, wade into water, or open 60+ u"). A 45-damage hit is nearly half the bar and, stacked with meter drain, can tip a weakened explorer over. So animals-as-avoidable-risk with meters as the primary pressure is the intended model, not a defect; the claim recharacterizes intended design as a flaw.
- **Fixed world seed gives "Replay" nothing new — zero replayability** — Facts verified (worldConfig.ts:35 seed 20260708 "identical every load"; POI_ANCHORS fixed 116-123; TreasurePanel.tsx:115 Replay first CTA; GameCanvas.tsx:424-427 replay = discovery.reset() + window.location.reload()), but this complains about intended design. The fixed world is a necessary consequence of the "trail is the game" pillar (design 46-49): hand-authored clues that name specific landmarks ("follow the river to where it forks") REQUIRE a stable world — procedural variation would break the authored chain. The product is positioned as "an expedition in one sitting," not a procedural roguelike (replayability/procgen is not a design goal). Replay is a legitimate time-trial/retry: the win screen tracks expedition time, deaths, and fruit eaten (TreasurePanel.tsx:95-112) precisely to support a beat-your-run replay. "Zero replayability" mischaracterizes an intended, stats-backed retry loop.
- **Audio setting is mute-only; there is no volume control** — The factual observation is accurate — SettingsMenu.tsx:56-67 exposes only an On/Muted switch writing settings.set({muted}), and settingsStore.ts Settings has muted/quality/reducedMotion/showDiscoveredMarkers with no volume field. But this is an explicitly intended design decision, not a defect: the design spec's Audio section (line 161) states 'All routed through the existing settings mute,' and the UI section (line 150) says 'Pause/settings (existing quality/audio/motion settings kept)' — the kept audio setting IS the mute toggle. A volume slider was never in scope; the claim is a feature request against a deliberate mute-only design, so per the verdict rules (complaining about something the spec explicitly intends) it is not a real issue.
- **Survival meters are unlabeled emoji bars; identity and health state are ambiguous** — The factual observations are accurate (verified at runtime: visible text is emoji-only — ♥ ⚡ 🍖 💧; the numeric value sits only in aria-label; health fill is #e05656 = rgb(224,86,86) at 100% width). But the claim complains about design-intended behavior. Design spec line 144 explicitly calls for 'four slim meters (health, stamina, hunger, thirst) bottom left WITH ICONS' as a 'diegetic-leaning HUD', and SurvivalMeters.tsx:18-24 documents the AT-only numeric values as a deliberate accessibility choice. Red is the near-universal game convention for health/HP and is reinforced by the ♥ icon; danger is signaled by the documented flash-at-≤25 mechanism (LOW_METER=25; design line 147), not the resting color — so 'red reads as danger' is contradicted by both convention and the game's own danger cue. The icons chosen are conventional survival iconography (heart/lightning/meat/droplet). Emoji cross-platform variance is a real but marginal side-point that does not carry the claim's thesis of 'ambiguous identity and health state'.
- **The river is a fordless barrier the intended chain must cross three times against an un-fightable current** — The individual facts check out (I reproduced them): centreline depth is a uniform 2.6 m with no in-channel ford, there is no bridge/stepping-stone geometry, currentSpeed 4.5 / currentInputFactor 0.4 (explorer.ts:79-82), and the chain banks are W-W-E-W-E-E → 3 crossings. But the conclusion 'zero designed way to get across' is wrong. Swimming (#184) IS the designed crossing: explorer.swim.test.ts:212-225 verifies a gripped swimmer who steers toward a bank RELEASES to a walk at wade depth, and explorer.ts documents 'Surfacing + swimming shoreward always works — swimming never traps' with the current 'un-fightable at 100%' as deliberate design. The clue chain explicitly names the crossings ('EAST ACROSS THE RIVER' in clue 4; 'don't trust the deep water: what the river carved, it keeps' in clue 2), the worldConfig.ts:108-114 loop comment describes the cross-river route as intended, and a fully dry walk-around exists north of the source (a z=-155 west→east line has max water depth 0.00). Being swept downstream on a crossing is intended difficulty, not a missing mechanic. This complains about behaviour the spec/code explicitly intend.
- **Carved-overhang site is on the far bank from the approach, and its clue never says to cross the river** — The geography is right — the overhang (34,-104) is ~35.5 units EAST of the river centreline (centreline x≈-1.5 at z=-104), distToRiver 31.0 (just inside the 32 m teaser radius). But the 'unfair, unhinted crossing' framing is refuted. Clue 2 directs the player 'UPRIVER, toward the country where the river is born' (the northern source) and warns 'Climb steadily and don't trust the deep water,' and worldConfig.ts:108-114 places the overhang in 'the northern highland' reached via the headwaters — where I confirmed a dry walk-around exists (z=-155 crossing, depth 0.00). So the crossing is neither forced (dry route around the source) nor unhinted (the clue steers you upriver and off the deep water); a player can also simply swim across (drifting downstream but reaching the far bank per the swim tests). The claim is additionally self-admittedly hypothetical ('with markers removed as the spec intends'), and the always-on markers currently guide the player straight there. The failure scenario (walk the west bank, ignore the clue, never cross) is contrived.
- **Chain legs are very long relative to the island, producing long featureless treks** — The leg distances are factually accurate (camp->canoe 69.0, canoe->overhang 172.9, overhang->last-camp 132.8, last-camp->ruin 163.8, ruin->fig 75.9; playable diameter ~356), but the complaint targets spec-intended design and its supporting rationale is contradicted by the code. worldConfig.ts:108-115 and the design spec explicitly intend the chain to 'loop the whole island' with these long legs. The 'no intermediate landmarks / risks feeling like aimless walking' claim is refuted by content/expedition.json: every long leg is navigated by the river as a continuous readable spine or toward a large landmark ('Follow the shore north, keep the water on your right'; 'UPRIVER, toward the country where the river is born'; 'down the LOW VALLEY WEST OF THE RIVER'; 'EAST ACROSS THE RIVER from here'; 'up the rise at the STRANGLER FIG'). The world also populates the routes with wildlife (jaguar, monkeys, snakes, birds), 22 forage plants, terrain relief and river crossings. The 'once the GPS markers are removed as the spec intends' premise describes a non-current state — the running build still ships nav.markers=5. The distances alone do not establish 'featureless/aimless' when the spec's navigate-by-the-world model (the river) is implemented in the clue text.
- **No standalone head-bob / camera-motion comfort toggle** — The binding design spec explicitly intends exactly this behaviour: line 68 states 'Head-bob amplitude tied to speed, disabled by the existing reduced-motion setting.' The single reduced-motion flag intentionally bundles head-bob with the other decorative motion (perf-budget.md:429 treats it as 'decorative motion, not information'), and fpCamera.ts:47 gates bob on that shared flag by design. The claim's factual description of what the flag controls is accurate, but it complains about the absence of a granular toggle that the design deliberately chose NOT to provide — a feature request contrary to the explicit spec, not a defect.
- **Thunder rumbles but there is no lightning flash** — The factual observation is true — justThundered() (weatherSystem.ts:86-90) is consumed only as engine.thunder() audio (AudioSystem.ts:370), and no visual consumer of the thunder edge exists (grep confirms only that one consumer). But framing this as a defect is refuted by the binding weather design spec, which lists 'Lightning flashes (sky/postfx coupling — a follow-up slice if wanted)' explicitly under 'Out of scope' (docs/superpowers/specs/2026-07-18-weather-over-the-island-design.md:116-118). The spec deliberately designs thunder as 'distant rumbles' / 'distant, never a crack' — ambient mood 'the player feels arrive and pass, never a scripted cutscene'. The current behavior is exactly what was intended and consciously scoped; the missing flash is a deferred future slice, not a bug.
