# The Lost Idol — Remediation Plan

_Generated 2026-07-19 from the full-game audit of the same date. Every issue below was verified against the source and the running build during the audit; every solution here was written by a domain-expert engineer agent that re-read the cited code before proposing the fix. Companion document: the audit report (`lost-idol-audit-2026-07-19.md`), which holds the evidence for each issue._

**Scope:** 117 concrete solutions covering the 119 verified issues (some issues share one unified fix — see Cross-cutting fixes). Effort mix: 57×S (<2h), 50×M (~½ day), 10×L (1–2 days), 0×XL (multi-day), single-engineer.

Each solution card gives: **root cause** (the real mechanism in code), **solution** (the approach), **files** to touch, ordered **steps**, an **acceptance** check, **effort**, and **risk** (including perf-budget impact — the high tier has ~0 headroom, so any geometry/draw addition states how it stays in budget).

## How to use this

1. **Start with the sequence below** — 8 milestones ordered by dependency, not by area. It tells you what to build first and why.
2. **Cross-cutting fixes** collapse issues that four different auditors reported as one underlying change (the biggest: GPS nav markers). Do these once.
3. **Detailed solutions by area** is the reference: every issue's full card. The sequence and cross-cutting sections link back to these by title.

---

## Recommended implementation sequence

Eight milestones covering all 119 issues. Order respects dependencies — core-loop integrity and correctness before tuning and polish — and groups by code locality to cut rework.

### M1 — Restore the core pillar: strip GPS nav, dead machinery, and off-theme HUD
_9 issues_

The design's central pillar ('navigate by reading the world, not GPS markers') is actively violated by the still-shipping nav markers — reported four times — plus dead about-me quiz code and a vehicle-era m/s readout. This is pure removal: highest-value integrity work, no new geometry or budget cost, and it unblocks the HUD/UX and world-integrity milestones. Doing it first prevents building UX/accessibility affordances on top of subsystems slated for deletion.

- GPS-style nav markers defeat the entire "read the clues to navigate" core loop
- Dead about-me quiz machinery (guess/highlight) still ships behind the clue panel
- GPS-style nav arrows contradict the "read the world, no map markers" pillar the design explicitly cut
- HUD speedometer ("0 m/s") is an off-theme leftover from the vehicle/flight game
- GPS-style nav arrows + distance readouts to all sites still ship, gutting the 'read the clues to navigate' pillar
- 'Show discovered markers' setting is opaque and exposes a design-removed feature
- Vehicle-era speed readout (m/s) persists on the walking survival HUD
- GPS-style nav markers to every undiscovered site are still live — the design said to remove them
- Nav markers are aria-hidden and carry no landmark identity

### M2 — Core-loop correctness bugs: interact edges, prompt priority, sprint, respawn, context-loss
_Depends on: M1 — Restore the core pillar: strip GPS nav, dead machinery, and off-theme HUD_  
_10 issues_

Functional bugs in the core loop must be fixed before any tuning or polish (rule a). These are all correctness defects in the interact/survival/quest systems and cluster by locality: the Enter-edge leak, the onboarding-pause miss, the dig-locked-vs-read priority bug, the sprint hysteresis chatter (and the coupled stamina throttle feel), the phantom drink/gulp on respawn, and WebGL context-loss handling. Depends on M1 because prompt/HUD priority is cleaner once the nav overlay is gone.

- Enter used on a modal button leaks an interact edge — auto-opens and discovers the base-camp clue on onboarding-dismiss and on respawn
- First-run onboarding does not pause the sim — meters drain, wildlife stays live, and the win-screen time inflates while the player reads the tutorial
- Onboarding/tutorial does not pause the sim — slow readers take damage while learning
- "Dig-locked" hint claims the key is never pressable, but at the dig patch the interact key actually reads the fig's page (and the touch button is disabled there)
- At the fig climax the UI shows a disabled "pages missing" lock over the page you're standing on
- Sprint has no re-engage hysteresis — it chatters on/off at the stamina floor
- Stamina is a bare sprint throttle that makes the long treks stop-start
- Phantom drink animation on respawn when death happens with mid-range thirst
- Phantom gulp on respawn after a thirst death
- No WebGL context-loss handling — canvas freezes with no feedback and the fps read-out corrupts to ~120

### M3 — World & performance foundations: collision, site placement, biome, and budget guardrails
_Depends on: M1 — Restore the core pillar: strip GPS nav, dead machinery, and off-theme HUD_  
_13 issues_

Two prerequisite domains. Now that navigation depends on reading the world (M1), the world itself must be physically and narratively coherent — prop collision, the canoe beached on actual water, a jungle highland, a waterline boundary. In parallel, the perf guardrails must be restored/reclaimed BEFORE any rendering or game-feel work adds geometry or passes: the compositor-tier perf guard is blind, high tier sits at 97% tris with zero draw-call headroom, and there is no whole-scene budget assertion. Landing these first gives the later visual milestones a working budget guard to build against. All the majors here are foundational, so they go early.

- No prop collision anywhere — the player walks through trees, rocks, ruin walls, tents and the fig trunk
- The 'wrecked canoe' site sits 11 m up a dry jungle hillside, nowhere near water — contradicting its own clue
- The northern highland is a large bare dirt plateau, not the 'rockier jungle' biome the spec promises
- The world boundary turns the player back on a dry sloping beach, short of the water
- The mid-range phone the budget targets runs the MEDIUM tier — which has never been fps-measured on mobile-class hardware
- Live perf guard (StatsOverlay/getState) is blind on the compositor tiers — always reports 1 draw / 1 triangle
- High tier sits at 97% triangles and spikes to 148/150 draw calls — effectively zero headroom, above the doc's own worst case
- No automated whole-scene budget guard — a total-scene regression over 500k tris / 150 draws ships silently
- three (532 KB raw / 134 KB gz) is eagerly modulepreloaded and parsed before the title screen, which never uses it
- PMREM environment rebake runs a full fromScene blur chain every ~2s for the entire session on medium/high
- JS-gzip bundle headroom is thin (406.9 / 432 KB) after a recent cap raise
- antialias:true allocates an MSAA backbuffer that is unused on the composited (medium/high) tiers
- God-rays internal pass runs every frame on high tier even at noon when its contribution is 0

### M4 — Endgame & survival systems: run persistence, win-state, reset semantics, balance, and share
_Depends on: M2 — Core-loop correctness bugs: interact edges, prompt priority, sprint, respawn, context-loss_  
_22 issues_

The reload/persistence gaps corrupt completion stats and drop winners into a solved world — three majors — and they are only fixable as one atomic save/restore layer, which also underpins honest 'Reset progress' semantics and the win-payload share flow. Survival balance (respawn cost, meter tension, mobile fruit floor, hold-to-drink) rides on the same respawn/meter/quest code, so it batches here. Share is placed last within the milestone because a completion-brag payload needs the frozen persisted stats. Depends on M2 because persistence/reset build on the fixed respawn and interact edges.

- Win-screen stats reset on any reload — completion numbers are a lie
- 'Continue' respawns at camp with full meters — it does not resume the run
- Reload after a win re-buries the idol — 'Continue' drops you into a solved world with the treasure gone
- Completion is not a persisted state — the title can't tell a winner from someone who only read every page
- TreasurePanel's reload guard defends a state that can never be restored
- A reload during the ~4.5s finale window silently voids a completed dig
- Reload is a free survival reset that keeps clue progress
- Mid-run reload yields a self-contradictory play state (read pages, brand-new body)
- "Reset progress" only clears clue discovery — leaving the game unwinnable after a win
- 'Reset progress' is a destructive one-click action with no confirmation and no feedback
- After winning, the title offers only "Continue" back into a fully-solved world
- Respawn refills meters, so death near camp is nearly free and starvation has a safety valve
- Meters are trivially satisfied — survival tension is thin on a normal run
- Mobile (low) tier ships only ~22 fruit plants island-wide, elevation-gated
- Drinking is press-per-gulp, deviating from the spec'd hold-to-drink
- Share sends the bare homepage URL, wasting the one natural completion-brag moment
- The share seam is structurally url-only and cannot carry a title or text
- Fixed-seed world makes expedition time a real cross-player challenge, and share throws it away
- Share is reachable only after winning — no title-screen invite despite the 'just a shared link' premise
- Share button carries primary-CTA weight equal to Replay while producing the least-valuable outcome
- Desktop fallback silently copies a contextless URL and the panel never shows what was shared
- Share CTA is never disabled while a share is pending — violates the useShare contract and allows concurrent shares

### M5 — Audio overhaul: mix architecture, positional threats, synthesis quality, and gating
_Depends on: M2 — Core-loop correctness bugs: interact edges, prompt priority, sprint, respawn, context-loss_  
_15 issues_

The audio system is rebuilt in one pass to avoid repeatedly re-wiring the engine graph: master limiter + stereo width + volume/per-channel control + ambient bus for ducking are architectural and best done together, and the individual synth fixes (rattle, chirp, river drone, footstep surface variation, low-meter/UI cues) plug into that graph. The positional-threat work shares its nearest-threat bearing signal with an on-screen indicator (cross-cutting), so both the audio pan and the HUD danger cue land here. Depends on M2 because the respawn-gulp baseline fix is resolved there first.

- Threat warning sounds are non-positional despite being the mechanic
- Wildlife danger warnings are audio-only — no HUD/visual alternative
- Footsteps are a single identical tonal tick — no surface or per-step variation
- Footsteps do not couple to terrain type
- No audio warning for critical or draining survival meters
- The two biggest payoffs can be masked — duck only touches the insect bed
- River water is a tonal oscillator drone, not water noise
- Snake rattle reads as a harsh alarm-clock beep
- Bird chirp is a single pure sine 'ping'
- No volume control — settings expose only a binary mute
- Sound is a single mute toggle — no volume or per-channel control
- No master limiter — concurrent voices can clip
- Entire mix is mono / dead-center — no stereo width
- Ambient bird/owl accents keep firing over the death overlay and menus
- No audio feedback on UI interactions (journal, guess, respawn, menu)

### M6 — Accessibility, input & UX affordances
_Depends on: M1 — Restore the core pillar: strip GPS nav, dead machinery, and off-theme HUD_  
_11 issues_

Foundational accessibility and interaction affordances that later visual polish depends on. Critically, this milestone initialises the OS prefers-reduced-motion default — the gate that M7's head-bob, vignette, FOV kick, death fade and rain animation all must honour, so it must land before M7. It also delivers the pointer-lock 'click to look' affordance, focus trapping, crosshair, look-sensitivity, text/UI scale, input remapping, numeric/non-motion meter cues, the live-region chatter fix, fullscreen, and keeping the compass visible while sprinting. Depends on M1 (settings/HUD surface cleared of nav-marker leftovers).

- OS prefers-reduced-motion is ignored by all in-world motion (head-bob, FX)
- No pointer-lock state affordance: look silently dies after resume/tab-out and there is no 'click to look' prompt
- Modal dialogs do not trap focus — Tab escapes to background HUD
- No look-sensitivity or invert-Y control for a pointer-lock first-person game
- No crosshair or center reticle in the first-person view
- Compass heading disappears while sprinting, exactly when traversing the island
- No input remapping and no left-handed layout
- Survival meters lose their only critical-low cue under reduced motion, and have no numeric readout
- HUD telemetry is a polite live region — screen-reader chatter while moving
- No text-size / UI-scale option; several sub-11px HUD labels
- No fullscreen affordance for a pointer-lock browser game

### M7 — Theming, narrative & onboarding copy
_Depends on: M1 — Restore the core pillar: strip GPS nav, dead machinery, and off-theme HUD_  
_16 issues_

Content and presentation coherence with no runtime/budget cost: reconcile the five-vs-six page count across all copy AND the screen-reader announcement (cross-cutting), give the clue panel parchment styling, seed the jaguar into narrative, close the R./M./K. threads, and rebrand away from the 'AboutMeGame' slug/favicon/social image plus stale docstrings. The onboarding-modal copy/behaviour findings (review-anytime, backdrop guard, teach Journal J, shorten the swim row) sit here alongside the counter reconciliation. Depends on M1 because the counter/HUD copy and onboarding controls list settle only after the nav/HUD leftovers are removed.

- "Five clues" narrative vs the in-game "6 pages" counter
- "Five pages" in onboarding/README/notice vs "6" in every in-game counter
- Screen-reader page announcement uses find-count while the visible eyebrow uses narrative order
- The jaguar (a lethal ~45-damage pounce predator) is absent from all narrative and onboarding
- The clue panel is a generic dark UI dialog, not the parchment styling the design called for
- Deploy and share URL still carries the retired "AboutMeGame" product slug
- Favicon is a pre-pivot "sky-beacon" mark labeled "AboutMeGame"
- Ending leaves the R./M./K. character threads unresolved
- Social share image is a hazy, title-less terrain screenshot
- Stale pivot leftovers in shipped code docstrings (13-landmark count, "Drive on", DRIVE/FLY)
- Onboarding controls table crams a chatty run-on aside into the swim row
- The 'Space — swim' onboarding row is a long run-on inconsistent with the terse control list
- Onboarding controls list omits the Journal (J) key
- Onboarding never teaches the journal key (J)
- Onboarding is one-time-only with no way to review controls afterward
- Onboarding backdrop click neither dismisses the modal nor is guarded from grabbing pointer lock

### M8 — Rendering & game feel: water/terrain shaders, tactile feedback, and camera
_Depends on: M3 — World & performance foundations: collision, site placement, biome, and budget guardrails_  
_23 issues_

The visual/tactile polish layer, deliberately last: it is the only work that adds geometry, passes or per-frame cost, so it must land after the perf guardrails and reclaimed headroom (M3) and after the reduced-motion gate exists (M6) since every effect here honours it. The water-material findings are retuned in one coordinated shader pass; tri-planar terrain UVs, foliage cards and the waterfall curtain batch alongside. Tactile feel — the shared damage/health vignette, FOV plumbing (setting + sprint kick), head-bob cadence, water/swim feedback, landing dip, death fade, rain drift and haptics — all reuse the same overlay/camera seams. Depends on M3 (budget headroom + guard to measure against) and M6 (reduced-motion default + camera/settings surface).

- Water ripple-normal tiles at a 5-unit repeat with no distance fade; all open water reads as a woven grid
- Shoreline and river foam edge is a hard geometric zigzag sawtooth
- Terrain planar-XZ UV stretches ground textures into vertical smears on riverbanks, the waterfall gorge and steep slopes
- Low-tier procedural foliage reads as flat intersecting green cardboard cards
- Waterfall curtain is a flat hard-edged scrolling plane in a very dark gorge
- High-tier water sun-glint is an intense concentrated white sparkle blob
- Open sea, lagoon and river all render the same bright turquoise; deep water never darkens
- Low-tier river/shore water mask edge is blocky and stair-stepped from above
- Taking damage has no visual feedback at all
- Taking damage has no on-screen feedback
- No critical-health screen state — the only low cue is a bar flash
- No FOV control for a first-person game (fixed 60°)
- Sprint has no sense of speed (no FOV kick or motion cue)
- Head-bob cadence is far faster than a stride and decoupled from footstep audio
- Water contact produces no splash, ripple, or entry sound
- Swimming has no body or stroke presence
- Dry-land footstep ticks play while swimming
- No splash, swim-stroke, or underwater muffling for water play
- Underwater wash hard-cuts on submerge and surface
- No landing or step-down impact; verticality has no physical feel
- Rain-on-lens overlay is completely static
- Death arrives with no transition
- No haptic feedback on touch/mobile actions

---

## Cross-cutting fixes

Issue clusters that are really one change, or that must be solved together. Fix these once; the per-area cards for the listed issues defer to the unified solution here.

### One nav-marker removal: the GPS-style markers/arrows are reported four times plus their settings toggle and a11y note — all resolved by deleting the NavSystem/NavMarkers wiring

**Covers:** GPS-style nav markers defeat the entire "read the clues to navigate" core loop; GPS-style nav arrows contradict the "read the world, no map markers" pillar the design explicitly cut; GPS-style nav arrows + distance readouts to all sites still ship, gutting the 'read the clues to navigate' pillar; GPS-style nav markers to every undiscovered site are still live — the design said to remove them; 'Show discovered markers' setting is opaque and exposes a design-removed feature; Nav markers are aria-hidden and carry no landmark identity

**Unified solution.** Delete NavSystem/NavMarkers and their wiring (or gate the whole subsystem behind an off-by-default assist), and remove the now-orphaned 'show discovered markers' setting. Navigation is left to the cardinal-letter compass + clue text as the spec mandates. This single change closes all four duplicate 'GPS markers still ship' majors, removes the opaque toggle, and moots the aria-hidden-markers a11y finding (no markers to make accessible).

**Files.** `src/ui/NavSystem.ts`, `src/ui/NavMarkers.tsx`, `src/ui/navStore.ts`, `src/settings/settingsStore.ts`, `src/ui/SettingsMenu.tsx`, `src/buildGame.ts`

### Reconcile the page count: 'five' in copy vs '6' in every counter, plus the screen-reader announcement using a different count than the visible label

**Covers:** "Five clues" narrative vs the in-game "6 pages" counter; "Five pages" in onboarding/README/notice vs "6" in every in-game counter; Screen-reader page announcement uses find-count while the visible eyebrow uses narrative order

**Unified solution.** Pick one canonical count (either count only the five clue pages, or call it six pages everywhere including the auto-read camp page) and make all prose, README, notices, in-game counters AND the screen-reader announcement agree — announce the page's narrative order so spoken and visible labels match. Doing these together avoids re-touching the same counter/copy twice.

**Files.** `src/ui/Onboarding.tsx`, `src/ui/RevealPanel.tsx`, `src/content/discoverablePois.ts`, `src/discovery/DiscoverySystem.ts`

### Remove the vehicle-era m/s speed readout from the survival HUD (reported by both story-theming and ux-onboarding)

**Covers:** HUD speedometer ("0 m/s") is an off-theme leftover from the vehicle/flight game; Vehicle-era speed readout (m/s) persists on the walking survival HUD

**Unified solution.** Drop the m/s speed readout (and its stale telemetry doc) from the top-center HUD, leaving only the diegetic cardinal compass. Single edit to the HUD component and its store closes both reports.

**Files.** `src/ui/Hud.tsx`, `src/ui/hudStore.ts`, `src/ui/HudSystem.ts`

### Onboarding must pause the sim (reported as both a correctness bug and an accessibility defect)

**Covers:** First-run onboarding does not pause the sim — meters drain, wildlife stays live, and the win-screen time inflates while the player reads the tutorial; Onboarding/tutorial does not pause the sim — slow readers take damage while learning

**Unified solution.** Have the first-run onboarding set a session pause reason (session.setPaused('onboarding', open)) exactly like the menu/journal modals, so decay, wildlife and the play-clock hold until dismissed. One fix satisfies both the correctness (inflated time/meter drain) and accessibility (slow-reader damage) findings.

**Files.** `src/ui/Onboarding.tsx`, `src/engine/GameCanvas.tsx`

### Teach the Journal (J) key in onboarding (duplicated across ux-onboarding and accessibility)

**Covers:** Onboarding controls list omits the Journal (J) key; Onboarding never teaches the journal key (J)

**Unified solution.** Add a 'J — Journal' entry to KEYBOARD_ENTRIES so the onboarding controls list teaches it. One line closes both reports.

**Files.** `src/ui/Onboarding.tsx`

### Shorten the run-on 'Space — swim' onboarding row (reported by story-theming and ux-onboarding)

**Covers:** Onboarding controls table crams a chatty run-on aside into the swim row; The 'Space — swim' onboarding row is a long run-on inconsistent with the terse control list

**Unified solution.** Shorten the Space action to a control-length label ('Swim up') and move the lagoon/current guidance into the lede prose or a separate tip line. Same single edit to the controls table.

**Files.** `src/ui/Onboarding.tsx`

### One screen-space health/damage vignette overlay serves the damage-feedback dup and the critical-health state

**Covers:** Taking damage has no on-screen feedback; Taking damage has no visual feedback at all; No critical-health screen state — the only low cue is a bar flash

**Unified solution.** Build one reduced-motion-gated screen-edge vignette overlay component: a red flash (scaled by amount) driven off the hurt() edge, plus a sustained low-health ramp as health falls below a danger threshold, with a static-but-visible reduced-motion fallback. The accessibility and game-feel 'no damage feedback' reports are the same fix; the critical-health state reuses the same overlay.

**Files.** `src/ui/Hud.tsx`, `src/survival/SurvivalSystem.ts`

### Threat localization: the same nearest-threat bearing/distance signal must feed both positional audio and an on-screen danger indicator

**Covers:** Threat warning sounds are non-positional despite being the mechanic; Wildlife danger warnings are audio-only — no HUD/visual alternative

**Unified solution.** Expose the nearest-threat bearing/distance once (from the existing anyAlert()/isStalking() edges) and fan it out: pan + attenuate the rattle/growl in the audio engine (StereoPanner + distance gain), and drive an on-screen directional danger indicator / edge vignette plus an optional AT live-region announcement from the same signal. Sharing the signal is why these must be done together.

**Files.** `src/wildlife/snakes.ts`, `src/wildlife/jaguar.ts`, `src/audio/AudioEngine.ts`, `src/audio/AudioSystem.ts`, `src/ui/Hud.tsx`

### Master/per-channel volume control (reported by both sound-design and accessibility as the same missing feature)

**Covers:** No volume control — settings expose only a binary mute; Sound is a single mute toggle — no volume or per-channel control

**Unified solution.** Add a persisted 0–1 master volume setting the engine applies to master gain, ideally split into music vs SFX (ambient/SFX), surfaced in settings. One settings+engine change closes both.

**Files.** `src/settings/settingsStore.ts`, `src/ui/SettingsMenu.tsx`, `src/audio/AudioEngine.ts`

### Re-baseline thirst on respawn: the phantom drink animation and the phantom gulp sound are the same lastThirst-delta bug

**Covers:** Phantom gulp on respawn after a thirst death; Phantom drink animation on respawn when death happens with mid-range thirst

**Unified solution.** Detect the respawn refill by watching the respawn/alive edge (not a magic thirst-delta threshold) and re-baseline lastThirst inside respawn for both the HandsSystem animation and the audio gulp cue. Same root cause, one fix.

**Files.** `src/player/hands.ts`, `src/audio/AudioSystem.ts`, `src/survival/SurvivalSystem.ts`

### Footstep terrain-surface coupling (sound-design 'identical tick' and game-feel 'no terrain coupling' are one fix)

**Covers:** Footsteps are a single identical tonal tick — no surface or per-step variation; Footsteps do not couple to terrain type

**Unified solution.** Pass a coarse surface type (soil/sand/leaf-litter/stone/shallow-water) from the terrain into footstep(), and add per-step pitch/level jitter plus a filtered-noise crunch branched on that surface. The audio and game-feel reports describe the same footstep() change.

**Files.** `src/audio/AudioEngine.ts`, `src/audio/AudioSystem.ts`, `src/player/explorer.ts`

### Water & swim feedback: footsteps-while-swimming, splash/entry, swim body pose, and the underwater muffle/wash are one swim-edge-driven pass

**Covers:** Dry-land footstep ticks play while swimming; No splash, swim-stroke, or underwater muffling for water play; Water contact produces no splash, ripple, or entry sound; Swimming has no body or stroke presence; Underwater wash hard-cuts on submerge and surface

**Unified solution.** Drive all water traversal feedback off the mode==='swim' / water-entry edge: suppress footsteps (swap to a swim-stroke cue), emit a splash particle burst + splash sound on the wade/enter-swim edge, add a looping breaststroke hand pose to HandsSystem, and CSS-transition the underwater wash opacity while applying a master low-pass filter when submerged. These all key off the same swim state, so doing them together avoids re-plumbing the swim edge repeatedly.

**Files.** `src/player/explorer.ts`, `src/player/hands.ts`, `src/audio/AudioEngine.ts`, `src/audio/AudioSystem.ts`, `src/fx/`, `src/world/underwaterFxSystem.ts`

### Sprint/stamina behaviour: the hysteresis bug and the stop-start throttle feel are one tuning pass over the same stamina system

**Covers:** Sprint has no re-engage hysteresis — it chatters on/off at the stamina floor; Stamina is a bare sprint throttle that makes the long treks stop-start

**Unified solution.** Rework the stamina/sprint state machine once: add re-engage hysteresis (require ~25 to resume, keep drop-out at 10) so exhausted sprinting settles, and in the same pass lengthen the sprint window / soften the regen gate (or add a second stake) so sustained travel stops feeling choppy. Fixing the chatter bug and the feel together avoids two rounds of retuning.

**Files.** `src/player/explorer.ts`, `src/survival/SurvivalSystem.ts`

### 'Reset progress' needs both a confirm guard and to actually re-arm the quest (destructive-one-click UX + unwinnable-after-win correctness are one feature fix)

**Covers:** 'Reset progress' is a destructive one-click action with no confirmation and no feedback; "Reset progress" only clears clue discovery — leaving the game unwinnable after a win

**Unified solution.** Rework Reset progress as one feature: gate it behind an inline confirm ('Erase all found pages?') with brief confirmation feedback, and make it truly reset the run — re-arm the quest (re-bury the idol / clear treasureFound) and restore meters/position — so the reset world is playable and winnable. The UX guard and the semantics fix touch the same handler.

**Files.** `src/ui/SettingsMenu.tsx`, `src/discovery/DiscoverySystem.ts`, `src/discovery/persistence.ts`, `src/engine/GameCanvas.tsx`

### Fig-climax 'dig-locked' hint vs the readable page (gameplay-core and correctness-bugs describe the same priority bug)

**Covers:** At the fig climax the UI shows a disabled "pages missing" lock over the page you're standing on; "Dig-locked" hint claims the key is never pressable, but at the dig patch the interact key actually reads the fig's page (and the touch button is disabled there)

**Unified solution.** Rank 'read' above 'dig-locked' when a site's own read prompt is in range (and enable the touch button for reading), so arriving at the fig reads as 'read this, then dig' instead of a misleading disabled lock. One prompt-priority change.

**Files.** `src/ui/ActionHint.tsx`, `src/ui/TouchActionButton.tsx`, `src/discovery/DiscoverySystem.ts`

### Camera FOV plumbing: the FOV setting and the sprint FOV kick both require making the PerspectiveCamera FOV a driven value

**Covers:** No FOV control for a first-person game (fixed 60°); Sprint has no sense of speed (no FOV kick or motion cue)

**Unified solution.** Turn camera FOV into a driven value once: a persisted base-FOV setting (e.g. 60–100°) applied to the PerspectiveCamera, plus a transient sprint offset eased on/off (respecting reduced motion) layered on top. Doing both together means the FOV plumbing is written once instead of conflicting.

**Files.** `src/engine/Engine.ts`, `src/engine/GameCanvas.tsx`, `src/settings/settingsStore.ts`, `src/player/fpCamera.ts`

### Water surface material overhaul — five graphics findings all edit the same water shader/material and should be retuned in one pass

**Covers:** Water ripple-normal tiles at a 5-unit repeat with no distance fade; all open water reads as a woven grid; Shoreline and river foam edge is a hard geometric zigzag sawtooth; High-tier water sun-glint is an intense concentrated white sparkle blob; Open sea, lagoon and river all render the same bright turquoise; deep water never darkens; Low-tier river/shore water mask edge is blocky and stair-stepped from above

**Unified solution.** Do one coordinated pass over the water material: raise the ripple tile + add a second octave with distance fade, drive foam from a noise-warped distance-to-shore field, spread the sun-glint by nudging detail roughness/amplitude, strengthen depth-based colour absorption for deep water, and smooth the low-tier land/water mask boundary. Editing the shared shader in isolation forces repeated recompile/retune cycles, so these must be batched.

**Files.** `src/world/aquatic.ts`, `src/world/`

### Atomic run-persistence layer — the eight gap-1 reload findings are all the same missing save/restore of run state

**Covers:** Win-screen stats reset on any reload — completion numbers are a lie; 'Continue' respawns at camp with full meters — it does not resume the run; Reload after a win re-buries the idol — 'Continue' drops you into a solved world with the treasure gone; Completion is not a persisted state — the title can't tell a winner from someone who only read every page; TreasurePanel's reload guard defends a state that can never be restored; A reload during the ~4.5s finale window silently voids a completed dig; Reload is a free survival reset that keeps clue progress; Mid-run reload yields a self-contradictory play state (read pages, brand-new body)

**Unified solution.** Introduce one atomic run-state persistence layer covering position, survival meters, play timer, counters (playSeconds/deaths/fruitEaten), and quest/treasureFound — written at build time into the stores, and the win persisted the instant the dig completes. Restore is then internally consistent: Continue resumes the actual run, a winner returns to a coherent post-win state, and stats survive reload. (Alternatively, if the team chooses, persist nothing and treat every launch as a clean restart.) All eight findings collapse into this one decision.

**Files.** `src/discovery/persistence.ts`, `src/buildGame.ts`, `src/ui/TreasurePanel.tsx`, `src/ui/TitleScreen.tsx`, `src/survival/SurvivalSystem.ts`

### Share seam must carry a completion payload — widening the url-only seam unblocks the whole share-flow redesign

**Covers:** Share sends the bare homepage URL, wasting the one natural completion-brag moment; The share seam is structurally url-only and cannot carry a title or text; Fixed-seed world makes expedition time a real cross-player challenge, and share throws it away

**Unified solution.** Widen ShareCapabilities.share (and the navigator wrapper) to { title?; text?; url } and thread a completion-brag payload composed from the frozen stats through performShare, framed as a same-map time challenge ('I found the Lost Idol in 12:34 — beat my run'). The seam widening is the structural prerequisite the other share-flow findings build on, so it lands first.

**Files.** `src/share/`, `src/ui/TreasurePanel.tsx`

---

## Detailed solutions by area

## Gameplay & Core Loop  
_9 solutions_

### 1. [MAJOR] GPS-style nav markers defeat the entire "read the clues to navigate" core loop
_Effort: M_

**Root cause.** buildGame.ts:217-228 registers `NavSystem` (a per-frame projector) and GameCanvas.tsx:498 renders `<NavMarkers>`. NavSystem.ts:51-55 iterates every UNDISCOVERED POI each frame, computes `dist = eye.distanceTo(poi.position)` and a `${Math.round(dist)} m` label, projects it to NDC (line 58) and pushes on-screen dots + up to 3 rim arrows (lines 62-88). NavMarkers.tsx:31-56 draws colored pips and rotated `➤` arrows with live distance labels. This is the pre-pivot #44 nav-hint feature that the pivot table (design line 171) marks REMOVED and pillar 3 (design lines 46-49) forbids — the player can chase the nearest distance readout and never read a clue, making the authored 6-page chain decorative.

**Solution.** Delete the nav subsystem entirely rather than gate it, because the design forbids any GPS-style direction/distance to sites (not just when discovered). Remove NavSystem.ts, NavMarkers.tsx, navStore.ts and their three test files; strip the `nav` field from the `Game`/GameCanvas types; remove the `<NavMarkers>` render and its import. The cardinal-letter compass survives untouched — it is `h.compass` rendered in Hud.tsx:34 (the top-left hud-mode span), a separate store, so navigation collapses to "read the page, watch the compass" exactly as specced. Because `showDiscoveredMarkers` (settingsStore.ts:31, SettingsMenu.tsx:109-112) exists ONLY to feed NavSystem's `showDiscovered` callback (buildGame.ts:226), grep-confirm no other consumer and remove that setting field + its SettingsMenu toggle too — a dead setting once the system is gone.

**Files.**
- `src/ui/NavSystem.ts (delete)`
- `src/ui/NavMarkers.tsx (delete)`
- `src/ui/navStore.ts (delete)`
- `src/ui/NavSystem.test.ts (delete)`
- `src/ui/NavMarkers.test.tsx (delete)`
- `src/ui/navStore.test.ts (delete)`
- `src/buildGame.ts (remove imports lines 9-10, the createNavStore/NavSystem block 217-228, and `nav` from the returned Game at 311)`
- `src/engine/GameCanvas.tsx (remove NavMarkers import line 16, NavStore type import/field, render line 498)`
- `src/settings/settingsStore.ts (remove showDiscoveredMarkers field, default, load branch)`
- `src/ui/SettingsMenu.tsx (remove the toggle block ~109-112)`
- `src/settings/settingsStore.test.ts + src/ui/SettingsMenu.test.tsx (drop the showDiscoveredMarkers assertions)`

**Steps.**
1. grep -rn 'nav\|Nav\|showDiscoveredMarkers' src to enumerate every reference before deleting.
2. Delete the six nav source/test files.
3. Remove the NavSystem construction + createNavStore from buildGame.ts and the `nav` property from the Game return; fix the Game type.
4. Remove the NavMarkers import and JSX from GameCanvas.tsx and its `nav` field from the GameHandle type.
5. Remove showDiscoveredMarkers from settingsStore.ts (field, DEFAULTS, load parser) and its SettingsMenu toggle; update the two affected tests.
6. Run `npm run build` (typecheck catches every dangling reference) then `npm test`.

**Acceptance.** buildGame.test.ts: assert the engine has no system with id 'nav' after buildGame (e.g. the systems list / describe() output contains no 'nav'). A GameCanvas render test (pattern: GameCanvas.test.tsx) asserts the mounted DOM contains no `.nav-markers`, `.nav-dot`, or `.nav-arrow`. Observable in the running build: at spawn (0 pages found) no distance readouts or direction arrow appear; only the compass letter shows.

**Risk.** No dependency on other findings. PERF: strictly positive — removes a per-frame loop over all undiscovered POIs (matrix refresh + projection + sort) and a React component; zero geometry/draws added. Regressions to watch: buildGame.test.ts, GameCanvas.test.tsx, GameCanvas.journal/envLight tests reference nav wiring and must be updated; settingsStore persistence reads unknown JSON keys gracefully so an old save with showDiscoveredMarkers is ignored harmlessly.

**Cross-cutting.** This is the single unified fix for the GPS-marker problem that the audit surfaces under gameplay, story, ux AND world. There is ONE mechanism (NavSystem+NavMarkers+navStore) and ONE deletion; the other areas' findings should reference this solution rather than propose parallel gating. The compass (Hud.tsx:34) is the intentional remaining nav aid and must be preserved by all four.

### 2. [minor] At the fig climax the UI shows a disabled "pages missing" lock over the page you're standing on
_Effort: S_

**Root cause.** actionPriority.ts:49-58 evaluates `missingPages > 0` (dig-locked) BEFORE `siteInRange` (read). At the fig with its own page still unread, QuestSystem publishes missingPages≥1 (QuestSystem.ts:135, clueIds includes site-ancient-fig) AND DiscoverySystem reports the fig site in range, so the ladder returns dig-locked — ActionHint.tsx:79-87 renders "…1 page still missing" while RevealPanel.tsx:71-80 simultaneously shows the "Press E to read" teaser (it only hides on digOwnsKey, which is false because the fig page is unread). Two center-bottom hints, one telling you to read the very page the other calls missing.

**Solution.** Reorder the single resolver ladder so `read` outranks `dig-locked`: move the `if (input.siteInRange) return {kind:'read'…}` check (currently line 58) above the `if (input.missingPages > 0)` block (currently 49-57). New order: dig-progress > dig > read > dig-locked > forage > drink. Effect: arriving at the fig with its own page unread resolves to `read` — ActionHint already returns null for read (line 77) and RevealPanel owns the single "Press E to read" prompt; the dig-locked lock disappears. Once the fig page is read the site is discovered so siteInRange flips false, and if earlier clues are still missing dig-locked correctly reappears. The climax now reads "read this, then dig." No new state — a one-block move.

**Files.**
- `src/ui/actionPriority.ts (move the siteInRange/read return above the missingPages/dig-locked block in resolveActionPriority)`
- `src/ui/actionPriority.test.ts (update the ordering test at line 40)`

**Steps.**
1. In resolveActionPriority, relocate the `if (input.siteInRange) return { kind: 'read' … }` line to sit immediately after the `digOwnsKey` check and before the `missingPages` check.
2. Update actionPriority.test.ts line 40 ("dig-locked sits between dig and a site in range") to assert read now outranks dig-locked, and add a case for the fig-arrival scenario.
3. Run `npm test`; manually verify at the fig both surfaces (ActionHint and TouchActionButton, which share this resolver) show Read, not the lock.

**Acceptance.** actionPriority.test.ts: `resolveActionPriority(input({missingPages:1, siteInRange:true}))` returns `{kind:'read'}`; `input({missingPages:1, siteInRange:false})` still returns `{kind:'dig-locked', disabled:true}`. Observable: walking up to the fig with 5 clues read shows only "Press E to read"; after reading, "Press E to dig" (or the dig-locked hint if other clues remain).

**Risk.** Minimal. TouchActionButton consumes the same resolver, so it also switches from the disabled lock to a Read button at the fig — intended. No perf impact. Watch: ensure dig-locked still surfaces when you stand at the dig patch AFTER the fig page is read but with earlier clues missing (siteInRange false there → dig-locked wins, correct).

**Cross-cutting.** Overlaps the ux audit's 'two conflicting center-bottom hints' finding — same one-line reorder fixes both surfaces.

### 3. [minor] Dead about-me quiz machinery (guess/highlight) still ships behind the clue panel
_Effort: M_

**Root cause.** contentModel.ts:29-134 defines a 3-arm `PoiInteraction` union (plain/guess/highlight) with GuessOption, GUESS_MIN/MAX_OPTIONS and a full validating parser; discoveryStore.ts carries `interaction`, `guessChoice`, `bodyUnlocked`, and `answerGuess` on every open (lines 29-44, 98-101, 144-153); RevealPanel.tsx:186-292 renders a RevealBody switch with GuessBody, highlight emphasis and answerReveal. All six pages in content/expedition.json are plain (`grep -c interaction` = 0), so the guess/highlight paths are unreachable. The Next selector (RevealActions, RevealPanel.tsx:146-171) is NOT dead — for plain pages discoveryStore derives bodyUnlocked=true (line 99-100) so `nextUndiscovered` runs and "Next: <title> →" renders whenever a target exists.

**Solution.** Collapse the interaction discriminant to the only variant the game uses. In contentModel.ts remove the guess/highlight arms, GuessOption, GUESS_MIN/MAX_OPTIONS and their parser cases; the simplest end-state deletes `parseInteraction` and the `interaction` field from PoiContent entirely (the loader keeps its required-field throw). In discoveryStore.ts drop `interaction`, `guessChoice`, `bodyUnlocked` from OpenInfo/OpenPoiInput, delete `answerGuess`, and remove the bodyUnlocked derivation in `set`. In RevealPanel.tsx delete RevealBody's switch (render `<p className="reveal-panel__body">{open.body}</p>` inline), GuessBody, and change RevealActions' Next gate from `open.bodyUnlocked ?` to unconditional `nextUndiscovered(...)` (bodyUnlocked was always true for plain, so behavior is identical). This is the "shape the touched files as if from scratch" licence within a genuinely vestigial subsystem.

**Files.**
- `src/content/contentModel.ts (remove guess/highlight from PoiInteraction, GuessOption, GUESS_MIN/MAX_OPTIONS, parseInteraction guess/highlight cases; ideally drop the interaction field)`
- `src/discovery/discoveryStore.ts (OpenInfo/OpenPoiInput, answerGuess, set() bodyUnlocked derivation)`
- `src/ui/RevealPanel.tsx (RevealBody, GuessBody, RevealActions Next gate)`
- `affected tests: contentModel guess/highlight tests, RevealPanel guess tests, discoveryStore answerGuess tests`

**Steps.**
1. Confirm no content uses interaction: `grep -rn interaction content/`.
2. Trim contentModel.ts to the plain path (or remove the interaction field wholesale) and delete the now-unused exports.
3. Remove guessChoice/bodyUnlocked/interaction/answerGuess from discoveryStore.ts; keep discoveredIds/nearby/open/total intact.
4. Simplify RevealPanel.tsx: inline the plain body, delete GuessBody, make Next depend only on nextUndiscovered returning a target.
5. Delete or rewrite the guess/highlight/answerGuess unit tests; keep and re-run the plain-render + Next-selector tests.
6. `npm run build` (exhaustiveness `never` defaults will flag anything missed) then `npm test`.

**Acceptance.** contentModel.test.ts: loadContent() returns 6 pages, each with a body and no interaction field. RevealPanel.test.tsx: opening a plain page renders `.reveal-panel__body` and, when an undiscovered next target exists, a `.reveal-panel__next` button labeled "Next: … →"; assert no `.reveal-panel__option` ever renders. discoveryStore.test.ts loses the answerGuess suite.

**Risk.** Must NOT regress the live Next selector — the Next gate change from bodyUnlocked to unconditional is behavior-preserving only because plain always unlocked; verify with the existing nextUndiscovered tests. No perf impact (React/data only). Watch focus-on-open: with GuessBody gone, focus always lands on the close button (closeRef), matching the current plain/highlight branch.

**Cross-cutting.** None — this is self-contained to the content/reveal seam.

### 4. [minor] Meters are trivially satisfied — survival tension is thin on a normal run
_Effort: M_

**Root cause.** SurvivalSystem.ts:25,29 set thirst full→empty in ~7min and hunger in ~11min; over the ~614u chain at walk pace (explorer walk 4.2) those barely dent (~-35/-22 pts), and decay is held entirely while a clue/menu panel is open (update() early-return at line 139). drinkPerGulp (line 51) is a one-tap +30, and the river/lagoon are central (worldConfig RIVER), so topping up is an incidental tap, not a routing decision.

**Solution.** Tighten the survival economy as one balance pass rather than restructuring the world (the central river is a fixed world-design constraint). Increase decay: thirstPerSec to ~FULL/5min and hungerPerSec to ~FULL/8min so a walk-pace run forces at least one deliberate drink stop before mid-chain. Pair with finding 8 (hold-to-drink) so drinking costs time-standing-still instead of a free tap, and reduce the per-second drink value so a full top-up is a real pause. Keep the panel-pause on decay (reading should not punish) — the thinness comes from slow rates + free water, not the pause. Choose final numbers by walking the actual POI_ANCHORS chain and measuring meter deltas.

**Files.**
- `src/survival/SurvivalSystem.ts (TUNE.thirstPerSec, hungerPerSec, drinkPerGulp / new drinkPerSec if finding 8 lands)`
- `src/survival/SurvivalSystem.test.ts (rate assertions)`

**Steps.**
1. Retune TUNE.thirstPerSec (~FULL/300) and hungerPerSec (~FULL/480).
2. Coordinate the drink change with finding 8 (hold-to-drink) so a top-up is a timed stop.
3. Walk the POI_ANCHORS chain (or script a walk-pace simulation) and verify thirst forces a stop before the third site.
4. Update the rate unit tests to the new constants and document the intended pace in a TUNE comment.

**Acceptance.** SurvivalSystem.test.ts: simulate walk-pace travel of the canoe→overhang leg (173u @ 4.2 m/s) and assert thirst drops enough to cross the drink-worthy threshold; assert the new rate constants. Observable: a careful player still finishes, but must plan at least one drink and one forage stop.

**Risk.** Over-tuning turns exploration into a chore; must be playtested end-to-end, and coupled with the mobile food floor (finding 7) and hold-to-drink (finding 8) so the harder economy is survivable on every tier. No perf impact.

**Cross-cutting.** Core of the survival-tuning cluster (4, 5, 6, 8) — do decay rates, drink mechanic, respawn cost and sprint hysteresis in ONE balance slice so they compose, not fight.

### 5. [polish] "Five clues" narrative vs the in-game "6 pages" counter
_Effort: S_

**Root cause.** Player-facing prose says five (Onboarding.tsx:68 "Five pages lead…", TextView.tsx:32-33 "follow five pages") while every counter reads six because total/cluesTotal = POI_ANCHORS.length = 6 (Hud.tsx:59 "Pages N / total"; TreasurePanel.tsx:100-103; TitleScreen.tsx:81; QuestSystem.ts:135 clueIds includes site-ancient-fig). The 6th POI (content/expedition.json site-ancient-fig, order 6) is a real readable page ending "This is the place. Dig." — so both numbers are individually correct; the copy and the counter just describe different things.

**Solution.** Reconcile the framing without changing the quest logic (which legitimately requires all 6 pages read before the dig — QuestSystem allRead). Lowest-risk, narrative-true option: keep the 6-page counter (it is the true readable-page count) and update the two copy sites so they no longer say 'five pages'. Rewrite Onboarding.tsx:68 to something like "Six pages — five clues and the dig itself — lead from your camp to the Emerald Idol…" and TextView.tsx:32-33 similarly. This preserves the design's 'five clues form a chain' story (design line 27) while making the number match the HUD/completion/title counters. Do NOT try to make the badge count 5 — that would desync from QuestSystem.clueIds.length and missingPages, a far riskier change.

**Files.**
- `src/ui/Onboarding.tsx (lede, line 68)`
- `src/ui/TextView.tsx (lede, lines 32-33)`
- `any onboarding/TextView copy tests`

**Steps.**
1. Reword Onboarding lede to name six pages (five clues + the dig page).
2. Reword TextView lede to match.
3. grep -rn 'five' src to confirm no other UI copy still conflicts with the 6-count.
4. Update/ add a test asserting the onboarding/TextView copy no longer says 'five pages' in a way that contradicts the counter.

**Acceptance.** A snapshot/text test on Onboarding and TextView asserts the lede references six pages (or omits a conflicting number); grep for 'five pages' in src returns nothing. Observable: onboarding, HUD badge, completion stats and title all agree on 6.

**Risk.** Pure copy; no logic, no perf. Only regression risk is a test that asserts the old 'Five pages' string — update it.

**Cross-cutting.** Same copy inconsistency the story and ux audits flag; one reconciliation of the two lede strings fixes all three areas. Keep the fix on the copy side, not the counter/quest side.

### 6. [polish] Drinking is press-per-gulp, deviating from the spec'd hold-to-drink
_Effort: M_

**Root cause.** SurvivalSystem.ts:188-192 grants a flat +TUNE.drinkPerGulp (30) once per consumed interact edge; the input seam (input.ts:49-50) exposes only `consumeInteract(): boolean` (an edge), no held state. ActionHint.tsx:107 reads "Press E to drink". The binding spec (design line 80) calls for hold ~1s → thirst +40/s and a "Hold E — drink" prompt.

**Solution.** Implement hold-to-drink accumulation, which requires a held signal the input controller doesn't yet expose. Add `isInteractHeld(): boolean` to PlayerInputController (input.ts) driven by the E key / gamepad A held state and a TouchActionButton press-and-hold. In SurvivalSystem, while `isInteractHeld() && canDrink && !siteOwnsKey`, accumulate `thirst += TUNE.drinkPerSec * dt` (drinkPerSec=40) clamped to FULL, replacing the per-gulp branch. Update ActionHint.tsx:104-108 copy to "Hold E — drink" and the touch label. This both matches the spec and (with finding 6) turns drinking into a real timed stop. If the input-seam + touch-hold work is judged out of scope for the value, the honest alternative is to reconcile the design doc to the gulp-per-press decision — but the spec is binding, so prefer implementing it.

**Files.**
- `src/player/input.ts (add isInteractHeld to PlayerInputSnapshot/Controller and the key/touch state that backs it)`
- `src/survival/SurvivalSystem.ts (InteractSource gains held query; replace per-gulp with per-second accumulation; add TUNE.drinkPerSec)`
- `src/ui/ActionHint.tsx (drink copy → "Hold E — drink")`
- `src/ui/TouchActionButton.tsx (press-and-hold for drink)`
- `tests: SurvivalSystem.test.ts, ActionHint test, input test`

**Steps.**
1. Extend the input controller with a tracked held-interact boolean (keydown/keyup for E, gamepad A, and touch button down/up) and expose isInteractHeld().
2. Widen SurvivalSystem's InteractSource to include the held query; add TUNE.drinkPerSec (40) and remove drinkPerGulp usage.
3. Accumulate thirst per frame while held+canDrink+!siteOwnsKey; keep draining the edge for the site/forage chain.
4. Update ActionHint and TouchActionButton copy/gesture to hold.
5. Add tests: 1s of held interact at water raises thirst ~40; a single tap adds little; the ActionHint renders 'Hold E — drink'.

**Acceptance.** SurvivalSystem.test.ts: feeding isInteractHeld()=true for ~1s of dt while canDrink raises thirst by ≈drinkPerSec; a lone edge with no hold adds ≈0. ActionHint test asserts the drink hint reads "Hold E — drink". Observable: holding E at the river fills thirst smoothly; tapping does almost nothing.

**Risk.** Touches the input seam (new held signal) and the touch button gesture — the fiddliest part; keep the edge-consume behavior for site/forage/dig intact so those aren't affected. No perf impact. Coordinate drinkPerSec with finding 6's decay so a top-up cost is meaningful but not punishing.

**Cross-cutting.** Survival-tuning cluster (4, 5, 6, 8). The drink-value change here IS the lever finding 6 needs for 'drinking is a real stop', so land them together.

### 7. [polish] Mobile (low) tier ships only ~22 fruit plants island-wide, elevation-gated
_Effort: S_

**Root cause.** buildForage.ts:100 sizes each kind's budget as `Math.max(1, Math.round(BUDGET[kind] * density))` with BUDGET berries26/banana34/mango24 (line 17). At low-tier density 0.26 that yields ~7/9/6 = ~22 ripe plants island-wide, elevation-banded (lines 62-81) with 90s regrow — a thin food supply on the software-GL/weak-phone floor. Unlike the tree layers (props.ts:130-133 also scale by density but the canopy budgets are large), forage has no per-kind minimum, so the smallest tier can dip below a survivable supply.

**Solution.** Floor each fruit kind independent of propDensity: `const count = Math.max(FLOOR[kind], Math.round(BUDGET[kind] * density))` with FLOOR ≈ {berries:12, banana:16, mango:12} (~40 plants minimum). Allocate the InstancedMesh capacity to that floored count so the meshes have room. High/medium tiers already exceed the floor (0.55×BUDGET and 1.0×BUDGET) so they are unchanged; only the low floor rises. This mirrors the intent of the low-tier tree handling — guarantee a playable minimum below which density scaling doesn't cut.

**Files.**
- `src/forage/buildForage.ts (line 100 budget computation; add a FLOOR record next to BUDGET at line 17)`
- `src/forage/buildForage.test.ts (density-floor assertion)`

**Steps.**
1. Add `const FLOOR: Record<FruitKind, number> = { berries: 12, banana: 16, mango: 12 };` near BUDGET.
2. Change line 100 to `const budget = Math.max(FLOOR[spec.kind], Math.round(BUDGET[spec.kind] * density));`.
3. Verify InstancedMesh allocation (lines 103-104) uses this floored budget (it already reads `budget`).
4. Add a test asserting at density 0.26 the total placed plants ≥ sum(FLOOR).

**Acceptance.** buildForage.test.ts: `buildForage(terrain, 0.26).plants.length >= 40` (sum of floors); at density 1.0 counts remain BUDGET-driven (26/34/24). Observable in the low-tier smoke: STATE.forage.plants rises from ~22 to ~40.

**Risk.** PERF: the extra ~18 plants land ONLY on the low tier, which sits far under the triangle/draw-call budget (the near-zero-headroom concern is the HIGH tier, unaffected here). Forage stays 6 instanced draw calls regardless of count (buildForage.ts merges per kind), so no new draw calls. Watch the rejection-sampler's attempt cap (line 112, budget*220) still finds enough banded slots for the higher floor.

**Cross-cutting.** Pairs with the survival-tuning cluster (finding 6): if hunger decay increases, the mobile food floor must rise in the same slice so the harder economy stays survivable on weak devices.

### 8. [polish] Respawn refills meters, so death near camp is nearly free and starvation has a safety valve
_Effort: S_

**Root cause.** SurvivalSystem.ts:124-136 respawn() sets health/hunger/thirst = TUNE.respawnLevel (75) and stamina/breath = FULL, keeping quest progress. Near camp the teleport cost is ~0, so intentional death becomes a soft heal-to-75-and-refuel, especially since the lagoon is adjacent.

**Solution.** Make waking a real setback rather than a refuel. Two composable levers: (a) lower TUNE.respawnLevel from 75 to ~45 so you wake weak (but keep it safely above 0 so respawn never immediately re-drains health via the starve rule); (b) do not restore stamina/breath to FULL — set stamina to respawnLevel too (breath can stay full since you wake on dry land). Result: after death you must immediately drink/forage before you can travel or sprint, so death costs time and routing, not just position. Because the design spec fixes respawn at 75, record this as a deliberate reconciliation in the design doc (note it, since the spec is binding).

**Files.**
- `src/survival/SurvivalSystem.ts (TUNE.respawnLevel, respawn() stamina line 127)`
- `src/survival/SurvivalSystem.test.ts (respawn assertions)`
- `docs/design/2026-07-08-the-lost-idol-design.md (record the changed respawn value — a docs-only note, not this planning task's edit)`

**Steps.**
1. Lower TUNE.respawnLevel to ~45 (or a playtested value) keeping it well above the starve boundary.
2. In respawn(), set stamina = TUNE.respawnLevel instead of FULL (leave breath = FULL).
3. Update SurvivalSystem.test.ts respawn expectations.
4. Flag the spec deviation in the design doc as a deliberate decision (separate docs change).

**Acceptance.** SurvivalSystem.test.ts: after a death and respawn(), health/hunger/thirst/stamina equal the new respawnLevel (not 75/FULL), and a subsequent update() with empty-meter conditions does not instantly kill (respawnLevel keeps health regenerating or stable). Observable: dying leaves you visibly weakened and thirsty, forcing a drink/forage stop.

**Risk.** Balance-sensitive: keep respawnLevel high enough to avoid a death spiral (respawn → immediate re-death). No perf impact. Depends on nothing but should be tuned alongside findings 4/6. Watch the death-overlay copy ("weaker and wiser") — the new value makes it literally true.

**Cross-cutting.** Survival-tuning cluster (4, 5, 6, 8). Also touches the design spec's binding respawn value — reconcile the doc in the same slice.

### 9. [polish] Stamina is a bare sprint throttle that makes the long treks stop-start
_Effort: S_

**Root cause.** SurvivalSystem.ts:100 `canSprint = alive && stamina > TUNE.sprintMinStamina` (10), and stamina drains at FULL/6 (~6s) / regens FULL/10 (~10s) (lines 31-32). The disable floor and re-engage threshold are the SAME value (10), so at the boundary sprint flickers on/off frame-to-frame with no clear recharge window — the explorer (explorer.ts canSprint gate) toggles the moment stamina crosses 10 either way.

**Solution.** Add recovery hysteresis: track a private `sprintReady` boolean in SurvivalSystem. When stamina falls to/below `sprintMinStamina` set sprintReady=false; it flips true again only once stamina climbs above a new `TUNE.sprintReengageStamina` (~35). `canSprint` returns `alive && sprintReady && stamina > sprintMinStamina`. This gives the player a decisive "catch your breath, then go" cadence over the ~614u chain instead of a stutter at the floor, without adding a second resource stake (the lighter of the two fix directions, and it keeps the specced 6s/10s feel).

**Files.**
- `src/survival/SurvivalSystem.ts (add TUNE.sprintReengageStamina ~35; add private sprintReady=true; update sprintReady each update() from current stamina; update canSprint at line 100)`
- `src/survival/SurvivalSystem.test.ts (add hysteresis case)`

**Steps.**
1. Add `sprintReengageStamina: 35` to TUNE and `private sprintReady = true`.
2. In update(), after computing stamina: `if (this.stamina <= TUNE.sprintMinStamina) this.sprintReady = false; else if (this.stamina >= TUNE.sprintReengageStamina) this.sprintReady = true;`.
3. Change canSprint to `this.alive && this.sprintReady && this.stamina > TUNE.sprintMinStamina`.
4. Reset sprintReady=true in respawn().
5. Add a test draining stamina to 0 then confirming canSprint stays false until stamina exceeds 35.

**Acceptance.** SurvivalSystem.test.ts: after sprinting stamina to ≤10, canSprint() stays false across frames while stamina regens from 10→34, then returns true at ≥35. Observable: sprint doesn't chatter at the low end; it comes back in one clean burst after a rest.

**Risk.** Pure feel/balance, no perf, no geometry. Coordinate with findings 5/6 (survival tuning cluster) so values are chosen together. Watch: explorer.ts reads canSprint only — no other consumer — so the seam is unchanged.

**Cross-cutting.** Part of the survival-tuning cluster (findings 4, 5, 6, 8); tune these together in one balance pass so the meters read as a coherent challenge.

---

## World & Level Design  
_5 solutions_

### 1. [MAJOR] GPS-style nav markers to every undiscovered site are still live — the design said to remove them
_Effort: S_

**Root cause.** buildGame.ts:218-228 constructs `new NavSystem(engine, player.explorer, discovery.pois, nav, discovery.store, () => settings.getSnapshot().showDiscoveredMarkers)` with the FULL poi array. In NavSystem.ts:51-52 the loop skips a poi only when `discovered.has(poi.id) && !showDiscovered` — so every UNDISCOVERED site is projected unconditionally each frame into either an on-screen dot (`x/y%`, NavMarkers.tsx:31-38) or an off-screen edge arrow (NavMarkers.tsx:40-56), both carrying `label = "${Math.round(dist)} m"` (NavSystem.ts:55). settingsStore.ts:16-17,31 exposes only `showDiscoveredMarkers` (default false) — there is no switch that governs undiscovered sites, so at 0/6 clues the player sees a live distance-labelled arrow to the nearest site. That is exactly the GPS quest arrow the pivot spec (design doc:47-49 and the removed-table row 'Nav markers to landmarks (compass instead)') deleted.

**Solution.** Invert the visibility rule so a marker is NEVER produced for an undiscovered site: only ALREADY-discovered sites may show a marker, and only when the existing off-by-default `showDiscoveredMarkers` assist is on. Change the guard in NavSystem.update from `if (discovered.has(poi.id) && !showDiscovered) continue;` to `if (!showDiscovered || !discovered.has(poi.id)) continue;`. With the default settings this makes NavSystem emit an empty marker list every frame (navStore.set([])), so at 0/6 clues nothing points anywhere — navigation is driven purely by the clue texts (expedition.json) + the compass strip (HudSystem already feeds `compassDegFromYaw`). The distance label and edge-arrow paths are then only reachable for a site the player has personally reached, which is a legitimate revisit aid, not a spoiler. Do NOT delete NavSystem/NavMarkers wholesale — the discovered-assist behaviour is a real, tested, off-by-default feature; gut only the undiscovered projection. This is the unified fix for the same symptom flagged in gameplay/story/ux.

**Files.**
- `src/ui/NavSystem.ts (update(): the poi-skip guard at line 52)`
- `src/ui/NavSystem.test.ts (adjust/extend expectations)`
- `src/ui/NavMarkers.test.tsx (drop any assertion that undiscovered sites render)`

**Steps.**
1. In NavSystem.ts:52 replace the guard with `if (!showDiscovered || !discovered.has(poi.id)) continue;` so undiscovered sites are always skipped and discovered sites appear only under the assist toggle.
2. Update the class doc comment (NavSystem.ts:11-20) to state the new contract: markers exist only for discovered sites under the assist, never as a next-clue GPS pointer.
3. In NavSystem.test.ts add a case: given 3 undiscovered pois, showDiscovered=false → navStore receives []; given the same pois all undiscovered, showDiscovered=true → still [] (undiscovered never shows); given one discovered poi + showDiscovered=true → exactly one marker.
4. Run npm test and npm run build; confirm no other caller depends on undiscovered projection (grep NavSystem/navStore).

**Acceptance.** New/updated cases in src/ui/NavSystem.test.ts prove undiscovered pois yield zero markers regardless of the toggle, and discovered pois yield markers only when showDiscoveredMarkers is true. Observable in the running build: fresh game at 0/6 clues shows no on-screen dots or edge arrows anywhere in wld-01-spawn / wld-inland — only the compass strip.

**Risk.** No perf impact (strictly less per-frame work). Regression to watch: NavMarkers.test.tsx or any smoke/Playwright assertion that expected an arrow to exist at spawn — update those. No dependency on other findings.

**Cross-cutting.** This is the single unified fix for the 'GPS nav markers vs. read-the-world' issue that the audit raises under gameplay, story, ux AND world. All four are the same mechanism (NavSystem projecting undiscovered sites); fixing the guard here resolves every instance. The other areas should reference this change rather than each re-touch NavSystem.

### 2. [MAJOR] No prop collision anywhere — the player walks through trees, rocks, ruin walls, tents and the fig trunk
_Effort: L_

**Root cause.** explorer.ts updateWalk (259-318) resolves a step purely from `terrain.heightAt` (slope/grade) and `waterDepthAt` (wade/swim). No collider is ever consulted; buildPlayer.ts:36-47 injects only terrain, boundaries and waterDepthAt. The data to collide against already exists but is used only for grounding shadows: props.ts exposes `Props.groundPoints: GroundPoint[]` — one `{x,z,radius}` per SOLID instance (canopy trunks r=1.4·s, palms r=1.1·s, rocks r=1.2·s; lines 276/372/447) — and landmarks.ts exposes `Landmarks.placed[]` with per-site positions. Nothing turns these into movement blockers.

**Solution.** Introduce a CollisionField seam (new src/world/collision.ts) and inject it into ExplorerSystem exactly like waterDepthAt. The field is a uniform XZ spatial-hash grid (cell ~8u) of circle colliders {x,z,r}, built ONCE at world build time from two sources: (1) props — add a `Props.colliders` array populated at placement with a SOLID-trunk radius (not the crown-sized groundPoint radius): canopy trunk ≈ min(0.6, 0.35·s), palm ≈ 0.3·s, rock ≈ 0.9·(rock radius); understory/ferns excluded (you push through leaves). (2) sites — per-archetype collider primitives from landmarks: fig = one ~1.1 circle at trunk centre (this is what stops clipping to the dig patch), tent/camp = one small circle, ruin = 2-3 circles along the fallen wall, overhang/canoe left passable or single small circle. Expose `field.resolve(x, z, playerRadius) → {x,z}`: query the 3×3 cells around the point, and for each overlapping collider push the point radially out to `r+playerRadius`, 2 iterations max so a wedge between two trunks resolves without jitter. In explorer.updateWalk, after computing the candidate `nx,nz` and BEFORE committing the move, run `const p = field.resolve(nx,nz, PLAYER_RADIUS)` (PLAYER_RADIUS≈0.35) and use p.x/p.z; the existing grade/water checks stay. Because resolve slides along the obstacle rim rather than hard-stopping, dense jungle reads as something you weave through. Slice it: Slice 1 = trees/palms/rocks via props.colliders (delivers the headline 'walk through trunks' fix); Slice 2 = site colliders (fig trunk + ruin walls).

**Files.**
- `src/world/collision.ts (new: CollisionField, buildCollisionField(colliders), grid + resolve)`
- `src/world/props.ts (add `colliders: Collider[]` to Props + populate in placeCanopy/palm/rock passes)`
- `src/world/landmarks.ts (add per-archetype collider primitives to PlacedLandmark or a `siteColliders` export)`
- `src/world/buildWorld.ts (assemble field from props.colliders + site colliders, expose on World)`
- `src/player/buildPlayer.ts (inject world.collisionField into ExplorerSystem)`
- `src/player/explorer.ts (ExplorerSystem ctor param + updateWalk resolve call)`
- `src/world/collision.test.ts (new)`
- `src/player/explorer.test.ts (add collision cases)`

**Steps.**
1. Write src/world/collision.ts: a `Collider = {x,z,r}` type, `buildCollisionField(colliders, cellSize=8)` bucketing into a Map<cellKey, Collider[]>, and `resolve(x,z,pr)` doing 2 push-out iterations over the 3×3 neighbour cells. Default/empty field is a no-op (zone-less unit-test safety, mirroring the SwimZones default).
2. Add `colliders: Collider[]` to the Props interface and push a solid-radius collider in placeCanopy (line ~276), the palm pass (~372) and the rock pass (~447). Do NOT collide understory.
3. Add site collider primitives in landmarks.ts (start with fig + ruin), returned alongside `placed`.
4. In buildWorld.ts build the field and expose `world.collisionField` (with a no-op default so existing tests/previews stay green).
5. Thread the field through buildPlayer.ts into a new ExplorerSystem ctor arg (defaulted to a no-op field, like `zones`).
6. In explorer.updateWalk, after `nx,nz` are computed and the swim/deep-water branch is ruled out, apply `const r = field.resolve(nx,nz,PLAYER_RADIUS); nx=r.x; nz=r.z;` before the grade/water commit.
7. Add tests: collision.test.ts (a point inside a collider is pushed to its rim; a point outside is unchanged; two overlapping colliders resolve to outside both). explorer.test.ts (a straight walk into a single collider ends with position outside r+PLAYER_RADIUS instead of passing through).

**Acceptance.** src/world/collision.test.ts: resolve() ejects an interior point to exactly r+playerRadius and leaves clear points untouched. src/player/explorer.test.ts: driving moveZ toward a collider placed 3u ahead leaves `explorer.state.position` outside the collider after N frames (currently it would pass through). Observable: walking S from spawn into the canopy stand decelerates/deflects instead of gliding through at 4.2 m/s; you can no longer clip through the fig buttress to the dig patch.

**Risk.** PERF: CPU-only, zero geometry/draws/passes. The grid is built once at load; per frame resolve() touches only the 3×3 cells around the player (~a handful of colliders), so it is negligible and needs no tier gate — collider COUNT already scales down with prop density on low. Regression risk: a bad push-out could trap the player or block the camp — mitigate with an iteration cap, PLAYER_RADIUS small, and rely on props already excluding the campClearRadius (props.ts:151) so no collider spawns on the spawn pad. Watch that resolve never pushes into deep water/off a cliff (apply it before, then re-run the existing grade/depth refusal). No hard dependency on other findings, but overlaps with the canoe move (finding 3): re-check the canoe site collider after relocation.

**Cross-cutting.** The 'no physicality / clip through solids' complaint likely also appears under gameplay and ux; the CollisionField is the one fix for all of them. Wildlife pathing already uses waterDepthAt and does not need this field, so keep the seam player-only for now.

### 3. [MAJOR] The 'wrecked canoe' site sits 11 m up a dry jungle hillside, nowhere near water — contradicting its own clue
_Effort: S_

**Root cause.** worldConfig.ts:118 anchors the canoe at x=-29,z=57. At that point `distToRiver` (terrain.ts:312) ≈16.3 > RIVER.bankHalfWidth (14), so the river carve (terrain.ts:139-144) never touches it and heightAt returns the raw highland-shaped terrain ≈11.4 m on a 5 m/6u slope. The canoe archetype is modelled as a flat beached hull, so it floats/clips on the slope, and clue 1 (expedition.json:12) — 'dragged the CANOE out of the water on the WEST BANK… keep the water on your right and you will walk straight into it' — is simply false for the location.

**Solution.** Relocate the anchor to a genuine west-bank waterline point and pin the invariant with a test so it can never regress. The waterline on a carved bank is where the blended channel height crosses seaLevel: solving carved = bed + (h_terrain - bed)·smooth(t) = 0 with bed = seaLevel - RIVER.depth (-2.6) gives smooth(t)=2.6/(h+2.6), i.e. a dr between bedHalfWidth (5) and bankHalfWidth (14) depending on surrounding terrain. Pick a stretch where the surrounding terrain is LOW so the bank is gentle (avoids the slope-clip): the river section between point (4,88) and the lagoon, on the WEST side. Procedure: for a candidate z in [~60,~105], compute the channel-centre x by interpolating RIVER.points, then step west until `|heightAt| ≤ 0.4` AND `distToRiver ≤ bankHalfWidth`; that x,z is the beaching point. A candidate to validate is approximately (x≈-4, z≈95) — north of the lagoon, west bank, 'water on your right' when walking north from camp exactly as the clue says. Lock the chosen value with a worldConfig test asserting the invariant. Secondarily (optional M add-on) give buildSite('canoe') a light ground-conform (sample heightAt at bow/stern and lerp the hull's pitch) so it always beaches flush even on a gentle bank.

**Files.**
- `src/world/worldConfig.ts:118 (POI_ANCHORS 'site-wrecked-canoe' x/z)`
- `src/world/worldConfig.test.ts (add canoe-on-shoreline invariant)`
- `src/world/landmarks.ts buildSite (optional canoe ground-conform)`

**Steps.**
1. Using the existing scratch terrain sampler (scratch terrain.mjs referenced in the finding), scan the west bank z∈[60,105] for a point with |heightAt| ≤ 0.4 and distToRiver ≤ RIVER.bankHalfWidth; confirm gentle local relief (<1.5 m over the ~6u footprint).
2. Set the canoe anchor x/z to that point in worldConfig.ts:118.
3. Add to worldConfig.test.ts: import terrain heightAt + distToRiver, assert for 'site-wrecked-canoe' that `distToRiver(x,z) <= RIVER.bankHalfWidth` and `Math.abs(terrain.heightAt(x,z) - WORLD.seaLevel) <= 0.5`.
4. Verify the site still passes clearOfSites / river-channel prop exclusion (props.ts) and that its discovery trigger radius is reachable on wadeable ground (depth ≤ maxWadeDepth), not the deep bed.
5. (Optional) add the bow/stern ground-conform in buildSite so the hull sits flush; add a landmarks.test assertion on the hull tilt.

**Acceptance.** worldConfig.test.ts asserts the canoe anchor is on the carved bank at the waterline (distToRiver ≤ 14 and height within 0.5 m of seaLevel). Observable: the beached hull sits half in the water on the west bank with the lagoon/river visible, matching clue 1's imagery.

**Risk.** No perf impact. Moving the anchor shifts the discovery trigger and any prop-clearing around it — re-run props/discovery placement to confirm nothing overlaps and the site is walk-reachable (with finding 2's collision, ensure the new spot isn't ringed by trunk colliders). If the ground-conform add-on is taken, effort rises to M. Depends loosely on finding 2 (re-place the canoe's site collider after the move).

**Cross-cutting.** This also underpins the story/coherence audit (clue text vs. world). The anchor move is the single fix; the clue text in expedition.json needs no change once the site actually sits on the west-bank waterline.

### 4. [minor] The northern highland is a large bare dirt plateau, not the 'rockier jungle' biome the spec promises
_Effort: M_

**Root cause.** A banding gap plus a low bare-rock threshold. Canopy valley placement rejects y>12 (props.ts:287) while the highland top-up rejects y<14 (props.ts:314), leaving the entire y12-14 band (17.2% of interior) with zero canopy trees. Highland trees are additionally scaled ·0.6 and sparse (props.ts:318). Terrain colour turns bare highland rock at y≥20 (terrain.ts:357-358, 0x6e6557), so 22.3% of the north land reads as tan dirt. Combined, 66.6% of the north sits above the canopy treeline as bare/near-bare ground.

**Solution.** Close the gap by redistribution (NOT by adding net instances — the high tier has ~0 triangle headroom). (1) Make canopy cover continuous: change the highland top-up threshold from `y<14` (props.ts:314) to `y<12` so it seams onto the valley band with no gap; the two passes already share one instance budget (canopyValleyBudget = 0.82·canopyBudget, highland tops it up), so this shifts placements upward for free with zero triangle delta. (2) Give the highland ground cover: bias a slice of the EXISTING understory budget (shrubs) and the EXISTING rock/boulder highland top-up (props.ts ~437+) toward y>14 so the floor has scrub and rock rather than dirt — again redistribution within the current counts, not new instances. (3) Fix the colour read: in colorForHeight (terrain.ts:344-359) add a scrub/scree band (e.g. y in [20,24] → a mottled olive-grey 0x5a5c46) and push the pure bare-rock 0x6e6557 up to only the true peaks (y≥24 or ~maxHeight+highlandBoost·0.6), so the plateau reads as thinning, rocky jungle. Colour changes are vertex-attribute only — zero perf cost.

**Files.**
- `src/world/props.ts:314 (highland canopy threshold 14→12)`
- `src/world/props.ts (understory general pass ~409-420 and boulder highland pass ~437+: add a highland-biased share)`
- `src/world/terrain.ts:344-359 colorForHeight (add scrub band, raise bare-rock threshold)`
- `src/world/terrain.test.ts (colour band assertions)`
- `src/world/props.test.ts (highland-band coverage assertion)`

**Steps.**
1. Lower the highland canopy top-up threshold in props.ts:314 from `if (y < 14) continue;` to `if (y < 12) continue;` so canopy cover is continuous across the old treeline gap.
2. Redirect a deterministic share of the understory general pass and the boulder highland top-up into the y>14 band (bias the candidate sampling), keeping total budgets unchanged so triangle count is flat.
3. In terrain.ts colorForHeight add a `y < 24` scrub/scree band (mottled olive-grey) between the deep-jungle green and the bare-rock hex, and move the bare-rock case to `else` above ~24.
4. Add terrain.test.ts assertions pinning the new colour thresholds; add a props.test.ts assertion (or a scratch biome-coverage check mirroring scratch wld-biome2.mjs) that canopy/understory instances now exist in the y12-20 band and the treeline gap coverage is >0.
5. Run npm run build and a frame-cost measurement (scripts/measure-frame-cost.mjs) to confirm the high-tier triangle count is unchanged (redistribution, not addition).

**Acceptance.** props.test.ts / a biome-coverage scratch check shows the y12-14 treeline gap is now populated (coverage > 0) and terrain.test.ts pins the scrub band + raised bare-rock threshold. Observable: the northern highland reads as thinning, rockier jungle with scrub and boulders instead of a tan dirt cap (compare against wld-highland.png / wld-aerial-top.png).

**Risk.** PERF is the live constraint — high tier is at ~97% of the triangle budget with ~0 draw-call headroom, so the fix MUST be redistribution (lower thresholds move existing instances higher; bias existing understory/rock budgets) with NO net instance increase. Verify with scripts/measure-frame-cost.mjs after the change per the frame-cost memory (renderer.info is unreliable on compositor tiers). Watch gentleSlope (props.ts) still rejects steep highland faces so trees don't float on cliffs. Colour changes are free. World-only; no dependency on other findings.

**Cross-cutting.** Minor and self-contained to world; not shared with other areas.

### 5. [minor] The world boundary turns the player back on a dry sloping beach, short of the water
_Effort: M_

**Root cause.** worldConfig.ts:49 sets a single fixed `boundaryRadius = 178`, inside the coastline in most directions (coastRadius 165, islandRadius 200). boundaries.ts:236-245 clamps every position to that constant radius `r` regardless of angle. Because the shore ramps down between coastRadius and islandRadius unevenly, r=178 lands on +5.6 m dry land due north (ang0), +2.6 m at ang180, and only reaches water at the south lagoon mouth (ang90). So the turn-back is an invisible wall on dry sloping ground almost everywhere.

**Solution.** Replace the fixed-radius clamp with a depth-based (angular) boundary baked from the height/water field. buildBoundaries already receives `heightAt`; also pass `waterDepthAt` (or compute depth = seaLevel - heightAt for the open-sea ring). At build time, bake a small 1-D LUT of the boundary radius per angle (e.g. 128 buckets): for each angle, march outward from coastRadius until the still-water depth reaches ~maxWadeDepth (1.2 m) — that is the true 'you're at the sea's edge' point — capped at islandRadius so the LUT is always finite. clampToBounds(pos) then computes `theta = atan2(z,x)`, looks up the bucket radius (lerp between neighbours), and clamps only if beyond it. This makes the turn-back read as the waterline in every direction, while the explorer's existing deep-water step refusal (explorer.ts:297, depth>maxWadeDepth) already prevents wading out into deep sea, so the two agree at the edge instead of fighting.

**Files.**
- `src/world/worldConfig.ts (retire the fixed boundaryRadius or keep only as the LUT cap)`
- `src/world/boundaries.ts buildBoundaries (bake the angular boundary LUT; rewrite isInBounds/clampToBounds to use it) — signature gains waterDepthAt/heightAt already present`
- `src/world/boundaries.test.ts (angular waterline assertions)`
- `src/world/buildWorld.boundaries.test.ts (wiring)`

**Steps.**
1. Extend buildBoundaries to accept the depth source (reuse the injected heightAt: depth = WORLD.seaLevel - heightAt(x,z)).
2. Bake `boundaryR[angleBucket]` (128 buckets): from r=coastRadius step outward (~1u) until depth ≥ TUNE.maxWadeDepth, else cap at islandRadius; store the radius.
3. Rewrite isInBounds/clampToBounds to bucket theta = atan2(z,x), lerp neighbouring LUT radii, and clamp x/z to that radius.
4. Add boundaries.test.ts: for several angles (N/E/S/W), assert the clamp radius lands where water depth ≈ maxWadeDepth (i.e. the player is stopped in shallow water, not on +5 m dry land), and that every LUT radius ≥ coastRadius so all sites stay in bounds.
5. Confirm buildWorld passes heightAt to buildBoundaries and the LUT default (no heightAt in unit tests) falls back to the old fixed radius so existing boundary tests stay green.

**Acceptance.** boundaries.test.ts proves the per-angle clamp radius sits at the waterline (water depth ≈ maxWadeDepth) rather than on dry ground for N/E/S/W, and never inside coastRadius. Observable: walking to the edge in any compass direction ends standing in shallow water at the sea's edge, not against an invisible wall on a dry slope.

**Risk.** PERF: the LUT is a one-time build-time bake (~128 short marches of heightAt), zero per-frame cost, no geometry/draws/passes; clampToBounds stays O(1) (one atan2 + array lerp). Watch: (a) sites all lie within coastRadius (165) so the outward-only LUT never clamps a site out; (b) the south lagoon mouth already reaches water — ensure the LUT there caps sensibly and doesn't let the player walk onto the open water plane; (c) keep the fixed-radius fallback for the heightAt-less unit tests so boundaries.test.ts/boundaries.sourceOfTruth.test.ts don't break. Mild interaction with the swim zones (lagoon) — the LUT should stop at wade depth so it hands off to the existing swim/step-refusal logic rather than overriding it.

**Cross-cutting.** Minor and world-owned; the 'sea's edge should feel like the sea' reading also touches ux polish, but the fix lives entirely in boundaries.ts.

---

## Correctness & Bugs  
_7 solutions_

### 1. [MAJOR] Enter used on a modal button leaks an interact edge — auto-opens and discovers the base-camp clue on onboarding-dismiss and on respawn
_Effort: S_

**Root cause.** input.ts:107-109 arms interactQueued=true on ANY non-repeat Enter/'e' keydown at the window level, with no check on focus or modal state. When a modal button is activated with Enter (Onboarding 'Got it', DeathOverlay 'Wake at camp'), the native button-activation ALSO arms the world interact edge. The dismiss/respawn synchronously clears the pause (SurvivalSystem.respawn SurvivalSystem.ts:124-136 clears the 'death' reason; Onboarding.tsx:56-59 never paused), and on the next unpaused tick DiscoverySystem runs first (registered before survival) and consumes the edge at DiscoverySystem.ts:91 — opening AND persisting whatever site is in range. At camp the base-camp POI is always in INTERACT_RADIUS, so it pops + credits an unearned discovery. SurvivalSystem's own per-frame drain (SurvivalSystem.ts:143) can't help because DiscoverySystem runs earlier in the frame.

**Solution.** Fix at the source so Enter never double-arms world-interact when it is activating a control. In input.ts onKeyDown, when the key is 'enter' (keep 'e' as-is, it isn't a native button activator), inspect e.target and skip arming interactQueued if the target is inside an interactive/modal element — reusing the exact selector the pointerup guard already trusts (input.ts:151): "button, a, input, select, textarea, [role='dialog'], [role='menu']". This single guard covers onboarding dismiss, respawn, and every future modal + assistive-tech path in one place, mirroring the intent of the existing journal->reveal drain (GameCanvas.tsx:517). Add defense-in-depth by also draining the edge in the two transitions that resume the sim: call the input's consumeInteract() inside the respawn closure (buildGame.ts:317-322) and on onboarding dismiss.

**Files.**
- `src/player/input.ts (onKeyDown, ~line 107-112)`
- `src/buildGame.ts (survival.respawn closure, ~line 317-322 — expose/reach player.input.consumeInteract)`
- `src/ui/Onboarding.tsx (dismiss handler, ~line 56-59, optional if input guard lands) OR rely on GameCanvas onboarding pause (see finding 2)`

**Steps.**
1. In input.ts onKeyDown, compute k=e.key.toLowerCase(); for the interact arm change the condition to: if(!e.repeat && (k==='e' || (k==='enter' && !(e.target as HTMLElement|null)?.closest?.("button, a, input, select, textarea, [role='dialog'], [role='menu']")))) interactQueued=true;
2. In buildGame.ts respawn closure, call player.input.consumeInteract() (drain) after discovery.store.closePoi() and before/after survivalSystem.respawn() so any queued edge from the death-overlay button is discarded regardless of source (gamepad A etc.).
3. Confirm DeathOverlay and Onboarding buttons receive focus (they do — Onboarding.tsx:45-47) so their Enter target is the button and the guard applies.
4. Leave the SurvivalSystem per-frame drain as-is; it is still correct as a backstop.

**Acceptance.** Extend src/player/input.test.ts: dispatch a keydown{key:'Enter', target: a <button>} and assert consumeInteract() returns false; dispatch keydown{key:'Enter', target: document.body} and assert true. Add an integration assertion (src/discovery/discovery.test.ts pattern or buildGame.test.ts): after respawn(), tick one frame with the player at camp and assert describe().discovered does NOT increment and store.open stays null. In the running build: dying and pressing Enter to respawn, and dismissing onboarding with Enter, must leave discovered count unchanged and no base-camp panel.

**Risk.** Very low. No perf impact (event-time only). Regression to watch: ensure Enter still arms interact when the canvas/world has focus (target is body/canvas, not a control) — covered by the second unit test. The 'e' key path is untouched so keyboard drink/read still works.

**Cross-cutting.** Overlaps finding 2 (both are onboarding-modal correctness). If finding 2's session pause for onboarding lands, the onboarding dismiss leak is additionally covered because the sim stays paused across the dismiss frame and SurvivalSystem drains the edge; the input.ts guard is still the durable root fix for all modals.

### 2. [minor] "Dig-locked" hint claims the key is never pressable, but at the dig patch the interact key actually reads the fig's page (and the touch button is disabled there)
_Effort: M_

**Root cause.** actionPriority.ts:49-57 returns kind:'dig-locked' (disabled:true) whenever missingPages>0, BEFORE the siteInRange->'read' branch at :58. At the dig patch the fig POI is always within DiscoverySystem's INTERACT_RADIUS (buildTreasure.ts:125-128 derives digPoint from DIG_LOCAL on the fig group), so siteInRange is true. On desktop the E key still reads the fig because DiscoverySystem.ts:91 opens any in-range site independent of the hint ladder; but on touch the only edge source is TouchActionButton, which renders disabled when priority.disabled (TouchActionButton.tsx:66-77) — so a touch player is told 'Tap Read' by RevealPanel yet has a dead lock button and cannot read the in-range fig page while on the patch.

**Solution.** Make 'read' outrank 'dig-locked' ONLY when the in-range site is actually unread (reading it is the productive step toward unlocking the dig); keep the informational dig-locked hint when the in-range site is already read (a distant page is the blocker). Thread a new siteUnread flag into ActionPriorityInput, computed by both ActionHint and TouchActionButton from discovery.getSnapshot(): nearby && nearby.inRange && !discoveredIds.includes(nearby.id). Reorder the ladder: dig-progress > dig > (siteInRange && siteUnread -> read) > dig-locked > (siteInRange -> read) > forage > drink. This unblocks the touch button for the unread fig while preserving the 'why can't I dig' cue once the fig is read.

**Files.**
- `src/ui/actionPriority.ts (ActionPriorityInput + resolveActionPriority ladder)`
- `src/ui/TouchActionButton.tsx (pass siteUnread from discovery snapshot)`
- `src/ui/ActionHint.tsx (pass siteUnread symmetrically so the two surfaces still agree)`

**Steps.**
1. Add siteUnread:boolean to ActionPriorityInput.
2. In resolveActionPriority insert, right after the digOwnsKey branch: if (input.siteInRange && input.siteUnread) return read; then keep the existing missingPages dig-locked branch; keep the existing siteInRange read branch below it as the already-read fallback.
3. In TouchActionButton and ActionHint compute siteUnread = (d.nearby?.inRange ?? false) && !d.discoveredIds.includes(d.nearby?.id ?? '') and pass it in.
4. Confirm reading the fig's final page flips missingPages to 0 -> next frame digOwnsKey true -> button shows Dig.

**Acceptance.** Extend src/ui/actionPriority.test.ts: with {missingPages:3, siteInRange:true, siteUnread:true} expect kind:'read'; with {missingPages:3, siteInRange:true, siteUnread:false} expect kind:'dig-locked'. Extend src/ui/TouchActionButton.test.tsx: at the dig patch with the fig unread, assert the button is enabled with label 'Read' and firing onPress; when read, assert dig-locked disabled. Observable: on a touch device standing on the dig patch with the fig unread, tapping the action button opens the fig page.

**Risk.** Low. No perf/geometry impact. Watch that siteUnread is derived from the same discoveredIds the store already exposes (no new store reads per frame beyond the snapshot React already subscribes to). Regression: ensure ActionHint desktop text stays consistent with the touch button (both now read the same input).

**Cross-cutting.** Touches the same actionPriority ladder that any UX/HUD audit finding about the touch action button would; fix once here and both ActionHint and TouchActionButton inherit it.

### 3. [minor] "Reset progress" only clears clue discovery — leaving the game unwinnable after a win
_Effort: L_

**Root cause.** GameCanvas.tsx:419 resetProgress = () => game?.discovery.reset(), which only clears the discovered set + persistence (DiscoverySystem.ts:106-112). QuestSystem has no reset, so treasureFound stays true and digLive is gated false forever (QuestSystem.ts:133-135) — the dig is permanently spent and the revealed chest stays in the world. Meanwhile the journal shows 0/6 and NavSystem re-shows a marker per now-undiscovered POI (NavSystem.ts:52), presenting a fresh but unwinnable quest. Only 'Replay' (GameCanvas.tsx:424-427) is an honest reset, via reload.

**Solution.** Make 'Reset progress' an honest in-place full reset that re-arms every session system so the reset world is genuinely replayable without a reload. Add QuestSystem.reset() (treasureFound=false, finaleRemaining=null, digProgress=null, lastCluesFound=0, playSeconds=0, push()), a buildTreasure rebury() seam (group.visible=false; idolMat.emissiveIntensity=0), and SurvivalSystem.reset() (meters to FULL, alive=true, deaths=0, explorer.respawn(respawnPoint), push()). Compose them in a single reset() on the buildGame handle that calls discovery.reset() + quest.reset() + survival.reset() + treasure.rebury() + wildlife.monkeys.reset(); wire resetProgress to it. NavSystem then recomputes markers correctly against a genuinely winnable quest. (Cheaper alternative if scope must stay tiny: relabel the button 'Reset journal' and remove it from the menu entirely since 'Replay' is the honest reset — but that leaves the desynced-nav trap unless nav is also gated; the in-place reset is the root fix.)

**Files.**
- `src/quest/QuestSystem.ts (add reset())`
- `src/quest/buildTreasure.ts (return a rebury() alongside reveal()/setIdolEmissive())`
- `src/survival/SurvivalSystem.ts (add reset())`
- `src/buildGame.ts (expose reset() on the handle composing the above; already owns respawn wiring at 317-322)`
- `src/engine/GameCanvas.tsx:419 (resetProgress -> game.reset())`
- `src/engine/GameCanvas.tsx GameHandle type (add reset to the discovery/handle shape or a top-level reset)`

**Steps.**
1. Add QuestSystem.reset() clearing all quest state and calling push().
2. Add buildTreasure rebury(){ group.visible=false; idolMat.emissiveIntensity=0; } to the returned object; type it.
3. Add SurvivalSystem.reset() restoring meters to FULL, alive=true, deaths=0, breath/stamina FULL, submerged=false, explorer.respawn(respawnPoint), push().
4. In buildGame, add reset() on the returned handle that calls discovery.reset(), quest reset, survival reset, treasure.rebury(), wildlife.monkeys.reset(); keep 'Replay' (reload) as-is.
5. Point GameCanvas resetProgress at game.reset(); update the GameHandle type + the code comment at 419-427.
6. Confirm NavSystem re-shows markers for all POIs and the dig is live again after reset (digLive true because treasureFound=false, finaleRemaining=null).

**Acceptance.** Add src/quest/QuestSystem.test.ts case: after a full win (treasureFound true), call reset() and assert digOwnsKey can become true again at the dig patch with all clues cleared, and treasureFound false. Add buildGame.test.ts assertion that game.reset() clears discovered count to 0 AND quest.store.treasureFound false AND the treasure group is hidden. Observable: after winning, 'Reset progress' yields a world you can re-explore and win again without reloading.

**Risk.** Medium. Touches quest + survival + treasure teardown state; watch that reset() does not double-dispose treasure geometry (rebury only toggles visibility/emissive, never dispose). No per-frame perf cost (reset is user-triggered). Regression: ensure playSeconds/deaths reset don't corrupt an in-flight win panel (reset only reachable from the pause menu, not during finale).

**Cross-cutting.** The NavSystem 're-shows a marker for every undiscovered POI' symptom is the same GPS-marker-vs-'read the world' tension that likely appears under world/ux/story audits (design pillar: navigate by reading the world, not GPS markers). Any decision to reduce/remove persistent nav markers there also removes half of this finding's 'fresh-looking but unwinnable' trap; coordinate so the reset fix and the nav-marker direction don't conflict.

### 4. [minor] First-run onboarding does not pause the sim — meters drain, wildlife stays live, and the win-screen time inflates while the player reads the tutorial
_Effort: S_

**Root cause.** Onboarding.tsx:24-29 deliberately does not pause ('It does NOT pause the sim'). GameCanvas mounts <Onboarding onOpenChange={setOnboardingOpen}/> (GameCanvas.tsx:511) and already tracks onboardingOpen for the Escape/J precedence guards, but never maps that state to a session pause reason. Every other modal does (menu -> GameCanvas.tsx:329-331; journal -> 337-339; reveal -> DiscoverySystem.ts:56; treasure -> QuestSystem). So thirst/hunger decay (SurvivalSystem.update), wildlife, and QuestSystem.playSeconds (QuestSystem.ts:107) all run while the tutorial is up — baking reading time into the win-screen 'Expedition time'.

**Solution.** Add the missing session reason exactly like the menu/journal effects. In GameCanvas, add a useEffect keyed on [game, onboardingOpen] that calls game?.session.setPaused('onboarding', onboardingOpen). No change to the Onboarding component itself, and its doc comment should be updated to reflect that the shell now pauses while it is up. Because QuestSystem, SurvivalSystem and the wildlife/hands systems all early-return on session.paused, this one line holds the play clock, meter decay and wildlife until dismiss.

**Files.**
- `src/engine/GameCanvas.tsx (new effect beside the menu/journal pause effects, ~line 329-339)`
- `src/ui/Onboarding.tsx (doc comment at 24-29 — correct the 'does NOT pause' note)`

**Steps.**
1. Add: useEffect(() => { game?.session.setPaused('onboarding', onboardingOpen); }, [game, onboardingOpen]); mirroring the menu effect.
2. Update Onboarding.tsx header comment to state the shell pauses the sim under the 'onboarding' reason while it is open.
3. Verify dismiss clears it: onOpenChange(false) flips onboardingOpen -> the effect clears the reason; other reasons (none at spawn) keep it running only if present.

**Acceptance.** Add to src/engine/GameCanvas.test.tsx (or a dedicated onboarding pause test): render with onboarding shown (fresh persistence), call window.advanceTime(120000), then assert quest.store.playSeconds===0 and survival thirst/hunger unchanged from FULL; after dismiss, advanceTime advances them again. This mirrors the Playwright contrast already noted (pause menu holds meters).

**Risk.** Minimal, zero perf cost. Watch the tiny window between first render and the effect firing/engine start — negligible (sub-frame) and does not affect the win clock materially. Ensure no deadlock: dismiss always clears the reason.

**Cross-cutting.** Shares the onboarding-modal surface with finding 1; landing both makes onboarding a first-class modal (pauses + drains the interact edge) like every other overlay.

### 5. [minor] No WebGL context-loss handling — canvas freezes with no feedback and the fps read-out corrupts to ~120
_Effort: M_

**Root cause.** Neither createRenderer.ts, Engine.ts, nor GameCanvas.tsx registers 'webglcontextlost'/'webglcontextrestored' on the canvas (grep: the only loseContext use is the deviceCapability.ts:118 probe). On loss the rAF loop keeps calling Engine.tick; render() becomes a cheap no-op/throw-free path so frames arrive faster and Engine's emaFrameMs (Engine.ts:219) skews toward a bogus ~120fps while running stays true (Engine.ts:249). Without preventDefault on the lost event the browser will not attempt an automatic restore, so on constrained devices the canvas can stay frozen indefinitely.

**Solution.** Register canvas context-loss handlers in the GameCanvas mount effect (alongside the visibilitychange handler, GameCanvas.tsx:261-263). On 'webglcontextlost': call e.preventDefault() (required to enable auto-restore), eng.stop(), and set a React state flag contextLost=true that renders a small non-interactive 'Rendering paused — restoring…' notice overlay (pure DOM, no draws). On 'webglcontextrestored': call a new Engine.resetFrameStats() (resets emaFrameMs to 1000/60 and lastTimeMs=null so the fps EMA doesn't carry the bogus value), eng.start(), and clear contextLost. Add resetFrameStats() to Engine so the fps read-out is honest post-restore.

**Files.**
- `src/engine/Engine.ts (add resetFrameStats(): this.emaFrameMs = 1000/60; this.lastTimeMs = null)`
- `src/engine/GameCanvas.tsx (add onContextLost/onContextRestored listeners in the mount effect + cleanup; add contextLost state + a notice overlay in the render tree; canvasRef is the target)`

**Steps.**
1. Add Engine.resetFrameStats().
2. In the GameCanvas mount effect, const onLost=(e:Event)=>{e.preventDefault(); eng.stop(); setContextLost(true);}; const onRestored=()=>{eng.resetFrameStats(); eng.start(); setContextLost(false);}; canvas.addEventListener('webglcontextlost', onLost, false); canvas.addEventListener('webglcontextrestored', onRestored, false);
3. Remove both listeners in the effect cleanup.
4. Add a contextLost useState and render a fixed, aria-live polite notice when true (styled like the other overlays; pointer-events none so it never blocks input).
5. Ensure onVisibility (line 262) does not fight the loss handler: guard onVisibility to not eng.start() while contextLost is true (check the flag via a ref).

**Acceptance.** Add a test to src/engine/GameCanvas.test.tsx: dispatch new Event('webglcontextlost',{cancelable:true}) on the canvas; assert engine state running becomes false and the notice renders; dispatch 'webglcontextrestored' and assert running true and getState().fps is back near 60 (resetFrameStats). Add an Engine.test.ts unit test that resetFrameStats restores emaFrameMs so getState().fps ~= 60. Observable: forcing gl.getExtension('WEBGL_lose_context').loseContext() shows the notice and stops the bogus fps.

**Risk.** Low, and budget-safe: listeners fire only on loss/restore (zero per-frame cost); the notice is a CSS overlay (zero draw calls, zero triangles). Watch the interaction with the visibilitychange auto start/stop so a restore while hidden doesn't start the loop — gate with the contextLost/hidden flags.

**Cross-cutting.** None — isolated engine/renderer robustness.

### 6. [minor] Phantom drink animation on respawn when death happens with mid-range thirst
_Effort: S_

**Root cause.** HandsSystem infers a drink from any thirst rise <= DRINK_RISE_MAX=35 (hands.ts:136,188-190). Respawn sets thirst to respawnLevel=75 (SurvivalSystem.ts:57,128), so for a death with thirst in (40,75) the refill rise is in (0,35] and mis-fires start('drink'). The magic-delta guard only catches large refills (e.g. starvation 0->75=+75). Additionally, because death sets session.paused and HandsSystem.update early-returns while paused (hands.ts:184), the alive flag transition is currently invisible to the system.

**Solution.** Detect the refill by the alive rising edge (dead->alive) rather than a delta threshold, and resync the thirst/eaten baselines on that edge so no action is inferred. Add `alive` to HandsSystem's survival source, track lastAlive, and move the alive-edge check ABOVE the session.paused early-return so the death->paused->respawn transition is captured even while paused. On a respawn edge: set lastThirst = current thirst, lastEaten = current eaten, force action='idle' and hide the group (cancel any pre-death in-flight pose). Keep DRINK_RISE_MAX as a harmless secondary guard or remove it — the alive edge is now the authoritative refill signal.

**Files.**
- `src/player/hands.ts (DrinkSource interface -> add alive:boolean; HandsSystem: add lastAlive field; restructure update() to read snapshot and handle the respawn edge before the paused early-return)`

**Steps.**
1. Extend DrinkSource: getSnapshot(): { thirst: number; alive: boolean } (survivalStore snapshot already carries alive).
2. In HandsSystem constructor init this.lastAlive = this.survival.getSnapshot().alive.
3. At the top of update(): const snap=this.survival.getSnapshot(); const justRespawned = snap.alive && !this.lastAlive; this.lastAlive = snap.alive; if(justRespawned){ this.lastThirst = snap.thirst; this.lastEaten = this.forage.getSnapshot().eaten; this.action='idle'; this.group.visible=false; }
4. Then keep: if(this.session?.paused) return; and the existing drink detection now using snap.thirst.
5. Because update runs while dead? No — it early-returns when paused; but the alive tracking above the return still records the false state on the first paused frame, so the later true edge is detected on the respawn frame.

**Acceptance.** Extend src/player/hands.test.ts (it already has a respawn-refill test at :105-126): set survival.alive=false then alive=true with thirst jumping 60->75, tick, and assert describe().action==='idle' (no phantom drink) across the full (40,75) range. Keep the existing large-refill case passing. A real gulp (+30 while alive) must still start 'drink'.

**Risk.** Low. No perf/geometry impact (reads one extra boolean from a snapshot already fetched). Watch that a genuine drink immediately after respawn (player drinks on the wake frame) is not swallowed — only the exact respawn edge resyncs; subsequent frames detect drinks normally.

**Cross-cutting.** None, but it depends on the same survivalStore.alive flag finding 7's hysteresis and finding 1's respawn drain also key off — a coherent 'respawn edge' concept.

### 7. [minor] Sprint has no re-engage hysteresis — it chatters on/off at the stamina floor
_Effort: S_

**Root cause.** SurvivalSystem.ts:100 canSprint = alive && stamina > sprintMinStamina(=10), a single threshold read every frame by the explorer (explorer.ts:233). Drain FULL/6≈16.7/s exceeds regen FULL/10=10/s, so holding sprint at the floor makes stamina oscillate across 10 and the sprinting flag flip each frame — flickering the HUD SPRINT badge (Hud.tsx:34) and re-firing the AudioSystem breathe() pant on every rising edge (AudioSystem.ts:301).

**Solution.** Add exhaustion hysteresis with two thresholds: keep the drop-out at sprintMinStamina=10, but once sprint is cut for exhaustion latch a sprintLocked flag that only releases when stamina recovers above a higher sprintReengageStamina (~25). Implement the latch inside the canSprint closure (it is called exactly once per frame by the explorer): if locked and stamina>=reengage -> unlock; if stamina<=min -> lock and return false; else return alive && !locked. Because regen (not drain) applies while locked, stamina climbs from 10 to 25 in ~1.5s and sprint settles instead of chattering.

**Files.**
- `src/survival/SurvivalSystem.ts (TUNE.sprintReengageStamina=25; add private sprintLocked; rewrite canSprint with the latch; reset sprintLocked=false in respawn() and reset())`

**Steps.**
1. Add TUNE.sprintReengageStamina: 25.
2. Add private sprintLocked = false.
3. Rewrite canSprint: if(!this.alive) return false; if(this.sprintLocked){ if(this.stamina>=TUNE.sprintReengageStamina) this.sprintLocked=false; else return false; } if(this.stamina<=TUNE.sprintMinStamina){ this.sprintLocked=true; return false; } return true;
4. Clear sprintLocked=false inside respawn() (and reset() from finding 6) so a fresh body can sprint.
5. Update the existing SurvivalSystem.test.ts recovery test (lines 77-82): after stopping sprint from empty, canSprint stays false at ~20 stamina and only returns true once >=25 (~3s), replacing the current 2s expectation.

**Acceptance.** Update/extend src/survival/SurvivalSystem.test.ts: sprint to the floor (canSprint false at ~0), stop; at 2s (~20 stamina) assert canSprint()===false (locked), at 3s (~30) assert true; then re-hold sprint and step several frames asserting canSprint does not oscillate frame-to-frame around 10. Observable: HUD SPRINT badge no longer flickers and the pant cue no longer stutters at exhaustion.

**Risk.** Low, zero perf cost (pure arithmetic in an existing once-per-frame call). Note: the existing recovery test at SurvivalSystem.test.ts:79-80 asserts canSprint true after 2s and WILL need updating — that is expected, it encodes the old single-threshold behavior. Tune reengage=25 so recovery still feels responsive (~1.5s of locked regen from the floor).

**Cross-cutting.** The pant re-fire and HUD badge flicker are downstream symptoms in audio/ux; fixing the sprint flag stability here removes both without touching AudioSystem.ts:301 or Hud.tsx.

---

## Persistence & The Returning Player  
_8 solutions_

### 1. [MAJOR] 'Continue' respawns at camp with full meters — it does not resume the run
_Effort: L_

**Root cause.** A raw reload restores nothing but discovered ids (persistence.ts), yet TitleScreen.tsx:64,85-87 labels the CTA 'Continue' whenever `discovered>0`, promising a resume. buildGame.ts:107 builds `createSurvivalStore()` at FULL (survivalStore.ts:37-47) and SurvivalSystem.ts:77-82 initialises its private meters to FULL; buildPlayer.ts:41 hard-codes ExplorerSystem's spawn to `SPAWN` (worldConfig.ts:101). SPAWN=(-34,124) while e.g. the fig is (108,-46) (worldConfig.ts:122). So Continue mounts a brand-new body at camp with full meters regardless of prior state.

**Solution.** Introduce the unified atomic RunSave and make 'Continue' an honest resume of position + meters. Create `src/persistence/runSave.ts` exporting `createRunSave(storage = safeLocalStorage())` returning `{ load(): RunState|null, patch(p: Partial<RunState>): void, clear(): void, flush(): void }`. It hydrates one in-memory `RunState` from a single versioned key `aboutmegame.run.v1` on construction and writes it back on `patch`/`flush`. Shape: `{ v:1, discovered:string[], position:{x,z,yaw}, meters:{health,stamina,hunger,thirst,breath}, playSeconds, deaths, fruitEaten, won }`. A version/parse mismatch → treat as null (fresh). Reimplement the existing `DiscoveryPersistence` seam as an adapter over RunSave (`save(ids)`→`patch({discovered:[...ids]})`, `load()`→`new Set(runSave.load()?.discovered ?? [])`) with a one-time migration importing the legacy `aboutmegame.discovered.v2` array, so DiscoverySystem is untouched. In buildGame: `const saved = runSave.load()`; pass `saved?.position ?? SPAWN` through buildPlayer to ExplorerSystem's `spawn` param (explorer.ts:167, already accepts `{x,z,yaw}`; y is recomputed from terrain), and add optional `initialMeters` to SurvivalSystem to seed health/stamina/hunger/thirst/breath. Add a `game.saveRun()` on the Game handle that snapshots `explorer.state.position/yaw`, the survivalStore meters, questStore playSeconds/deaths/fruitEaten and calls `runSave.patch(...)`. GameCanvas calls it on `pagehide` and `visibilitychange===hidden`, plus a 5s `setInterval` — all off the render loop.

**Files.**
- `src/persistence/runSave.ts (new)`
- `src/discovery/persistence.ts (reimplement DiscoveryPersistence over RunSave + legacy migration)`
- `src/player/buildPlayer.ts:24-46 (accept + forward saved position to ExplorerSystem spawn)`
- `src/survival/SurvivalSystem.ts:77-95 (optional `initialMeters` ctor param)`
- `src/buildGame.ts:97-149,303-337 (load runSave, thread seeds, expose `saveRun()` on Game)`
- `src/engine/GameCanvas.tsx (register pagehide/visibility/interval autosave, cleared on unmount)`
- `src/persistence/runSave.test.ts, src/buildGame.test.ts (acceptance)`

**Steps.**
1. Write runSave.ts with in-memory hydrate + single-key write + version guard; unit-test round-trip against an injected in-memory Storage (mirror settingsStore.test.ts's `mem()` shim).
2. Reimplement persistence.ts's createPersistence as an adapter over a RunSave instance, keeping the load/save/clear signatures and adding legacy-key migration.
3. Add `initialMeters` to SurvivalSystem (default = all FULL) assigning to the private fields; add saved-position forwarding through buildPlayer.
4. In buildGame, load once, thread seeds, and return `saveRun()` on the handle.
5. In GameCanvas, add an effect that calls `game.saveRun()` on `pagehide`/hidden `visibilitychange` and every 5s; remove listeners + clear interval in the existing cleanup.
6. Verify a reload lands the player at the saved XZ/yaw with the saved (not FULL) meters.

**Acceptance.** runSave.test.ts: patch then reload a fresh instance from the same fake Storage → identical RunState; bad JSON / wrong version → null. buildGame.test.ts: seed RunSave with position=(108,-46) and meters {health:20,thirst:5,…}; build; assert `explorer.state.position` ≈(108,·,-46) and survivalStore snapshot shows health 20, thirst 5 (not 100). Observable: trek out, drop meters, reload → wake at that spot, weakened.

**Risk.** No render-loop cost: reads once at build, writes only on discrete events/pagehide/5s timer — zero triangles/draws/passes, HIGH tier budget untouched. Edge: a save taken mid-swim restores y from terrain (snaps to land near shore) — acceptable, note it. Migration must not double-count legacy ids. This is the anchor other findings build on.

**Cross-cutting.** This RunSave module is the single shared remediation for all six 'nothing but discovered ids persists' findings (win stats, idol re-burial, finale-window loss, free survival reset, self-contradictory state). Build it once here; the others consume it. Also unblocks the title's completion state (finding 'Completion is not a persisted state').

### 2. [MAJOR] Reload after a win re-buries the idol — 'Continue' drops you into a solved world with the treasure gone
_Effort: M_

**Root cause.** `treasureFound` is never persisted: QuestSystem.ts:71 always starts it false and buildTreasure.ts:45 builds `group.visible=false`, revealed only by a completed dig (QuestSystem.ts:148 → treasure.reveal). Because only discovered ids persist, a post-win reload rebuilds a world where all 6 pages read (so QuestSystem's `digLive` logic and NavSystem.ts:52 hide every marker) but the idol is re-buried and the dig can't restart (dig is spent only in-session). The winner is dropped at camp in an unsolvable, pointerless world.

**Solution.** Persist the win in RunSave (`won:boolean`) and, on restore, reconstruct a coherent post-win world instead of re-burying. In buildGame, when `saved?.won` is true: (1) construct QuestSystem with a new `initialTreasureFound=true` seed so `treasureFound` starts true — this makes `digLive=false` (QuestSystem.ts:133), so the dig never re-arms and never publishes a stale 'press E to dig'; (2) call `treasure.reveal()` immediately after building so `group.visible=true` and the idol/chest stand in the world (no new geometry — it is already built, we only flip visibility). The returning winner thus free-roams a solved world with the idol present. The recap itself is surfaced on the title's completion state (see finding 'Completion is not a persisted state'), not by re-popping the panel on reload — TreasurePanel's baseline guard (TreasurePanel.tsx:52) correctly keeps it suppressed when the first snapshot already says treasureFound.

**Files.**
- `src/persistence/runSave.ts (the `won` field)`
- `src/quest/QuestSystem.ts:71,74-91 (add `initialTreasureFound` ctor param → `this.treasureFound`)`
- `src/buildGame.ts:135-150 (pass seed; call `treasure.reveal()` when `saved.won`)`
- `src/quest/QuestSystem.test.ts, src/buildGame.test.ts (acceptance)`

**Steps.**
1. Add `won` to RunState and an `initialTreasureFound` param to QuestSystem (default false).
2. In buildGame, compute `const won = !!saved?.won`; pass it as the seed and, if won, call `treasure.reveal()` after `buildTreasure` returns.
3. Confirm with won-restore that QuestSystem publishes `treasureFound:true`, `digOwnsKey:false`, `missingPages:0` and never re-arms the dig.
4. Confirm the idol group is visible (reveal called) so the world reads as solved.

**Acceptance.** QuestSystem.test.ts: construct with `initialTreasureFound=true`, stand at dig point with all clues, press interact, advance — assert no dig starts and snapshot stays `treasureFound:true, digOwnsKey:false`. buildGame.test.ts: seed RunSave `{won:true, discovered:[all 6]}`, build, assert quest snapshot `treasureFound:true` and that `treasure.reveal` was invoked (spy) so the idol is visible. Observable: win, reload, Continue → idol still standing at the fig, no phantom dig prompt.

**Risk.** Depends on RunSave (finding 'Continue respawns…'). Zero perf impact — reveal() flips an existing group's visibility (no geometry/draw added; the chest is already in the scene graph, just hidden). Watch: ensure NavSystem's all-discovered marker suppression still reads coherent (it does — winner has read all pages); the coherent destination is the title recap + free-roam.

**Cross-cutting.** Same RunSave fix as the other persistence findings. The 'coherent returning-winner destination' overlaps the title-UX finding 'Completion is not a persisted state' — the unified answer is: persist `won`, restore a visible-idol free-roam world, and route the recap to a title completion card (built once there).

### 3. [MAJOR] Win-screen stats reset on any reload — completion numbers are a lie
_Effort: M_

**Root cause.** buildGame.ts:107-109 create fresh survival/forage/quest stores on every mount and QuestSystem.ts:67 starts `playSeconds=0`; QuestSystem.push (QuestSystem.ts:175-176) mirrors `deaths` from the fresh survivalStore (survivalStore.ts:45, deaths=0) and `fruitEaten` from the fresh ForageSystem counter (ForageSystem.ts:81 `eaten=0`). Nothing but the discovered-id array is persisted (persistence.ts KEY `aboutmegame.discovered.v2`). So after a reload the win panel (TreasurePanel.tsx:97,107,111) reports only the post-reload slice.

**Solution.** Adopt the unified RunSave store (see finding 'Continue respawns at camp…' for its full spec) and seed the three counters from it at build time. Add optional constructor seeds: `QuestSystem` takes `initialPlaySeconds` (assign to `this.playSeconds`), `SurvivalSystem` takes `initialDeaths` (assign to `this.deaths`), `ForageSystem` takes `initialEaten` (assign to `this.eaten`). buildGame reads `runSave.load()` once and threads the saved values in; the periodic/`pagehide` autosave (added in the RunSave slice) captures the live values of these counters so a subsequent reload continues them. Because playSeconds/deaths/fruitEaten are already published every frame into questStore, no new per-frame work is added — only the seed at construction and an off-render-loop write.

**Files.**
- `src/persistence/runSave.ts (new — shared RunSave, spec in the 'Continue respawns' finding)`
- `src/quest/QuestSystem.ts (add `initialPlaySeconds` ctor param → `this.playSeconds`)`
- `src/survival/SurvivalSystem.ts (add `initialDeaths` ctor param → `this.deaths`)`
- `src/forage/ForageSystem.ts (add `initialEaten` ctor param → `this.eaten`)`
- `src/buildGame.ts:107-149 (load runSave, pass seeds; wire autosave)`
- `src/quest/QuestSystem.test.ts, src/survival/SurvivalSystem.test.ts, src/forage/ForageSystem.test.ts (acceptance)`

**Steps.**
1. Land the RunSave module first (shared dependency).
2. Add the three optional integer seed params to QuestSystem, SurvivalSystem, ForageSystem constructors, defaulting to 0 so all existing call-sites/tests are unaffected.
3. In buildGame call `const saved = runSave.load()` once and pass `saved?.playSeconds`, `saved?.deaths`, `saved?.fruitEaten` to the respective constructors.
4. Wire the autosave (defined in the RunSave finding) to serialize playSeconds/deaths/fruitEaten alongside position+meters.
5. Verify: seed a RunSave with playSeconds=200, deaths=2, fruitEaten=5; build; advance 2s; assert questStore snapshot reads playSeconds≈202, deaths=2, fruitEaten=5.

**Acceptance.** Unit: in QuestSystem.test.ts add a case constructing with `initialPlaySeconds=200`, run one `update(dt=2)`, assert `describe().playSeconds` ≈202. In SurvivalSystem.test.ts assert `initialDeaths` surfaces in the store snapshot. Integration in buildGame.test.ts: seed a fake-storage RunSave, build, `advanceTime`, assert `render_game_to_text` quest stats continue prior totals rather than starting at 0.

**Risk.** Depends on the RunSave module. No perf-budget impact: seeds are set once at construction; the counters were already pushed each frame. Regression to watch: ensure seeds default to 0 so the 30+ existing headless tests that construct these systems keep passing.

**Cross-cutting.** Same root cause and same fix as findings 'Continue respawns at camp…', 'Reload after a win re-buries the idol', 'A reload during the finale window…', 'Reload is a free survival reset', and 'Mid-run reload yields a self-contradictory play state'. All six are one gap: only discovered ids persist. The single remediation is the atomic RunSave; each finding is one field of it. Implement RunSave once (specced under 'Continue respawns at camp').

### 4. [minor] A reload during the ~4.5s finale window silently voids a completed dig
_Effort: S_

**Root cause.** QuestSystem.ts:143-149 completes the dig, calls `revealTreasure()` and `onFinaleStart()`, and sets `finaleRemaining=4.5`, but only flips `treasureFound` after that clock elapses (QuestSystem.ts:113-119). None of `finaleRemaining`/`treasureFound` is persisted, and on reload QuestSystem re-inits with `finaleRemaining=null, treasureFound=false` (QuestSystem.ts:69-71). A reload during the finale re-buries the chest and voids the visibly-completed dig.

**Solution.** Persist the win the instant the dig completes, not after the spectacle. buildGame already wires `onFinaleStart` (buildGame.ts:134,211) to startle birds — extend that same callback to also call `runSave.patch({ won:true })` and immediately `runSave.flush()`. So the win is durable the moment the chest rises. A reload mid-finale then restores `won:true` → the solved free-roam world (finding 'Reload after a win re-buries the idol') and the title's completion recap (finding 'Completion is not a persisted state'). The full stats (playSeconds/deaths/fruitEaten) are also snapshotted into the patch at that moment so an interrupted finale still yields accurate numbers.

**Files.**
- `src/buildGame.ts:134,211 (extend the `onFinaleStart` closure to patch+flush `won:true` and the current stats)`
- `src/persistence/runSave.ts (flush support)`
- `src/buildGame.test.ts (acceptance)`

**Steps.**
1. Ensure runSave.flush() writes synchronously to storage.
2. In buildGame, wrap the existing `onFinaleStart` so it also does `runSave.patch({won:true, playSeconds:…, deaths:…, fruitEaten:…}); runSave.flush();` alongside `wildlife.birds.startle()`.
3. Verify a build → drive the dig to completion via advanceTime → assert RunSave storage now holds `won:true` even though `treasureFound` in the store is still false (finale still running).
4. Confirm rebuilding from that storage yields a solved world (treasureFound seeded true, idol revealed).

**Acceptance.** buildGame.test.ts: build with a fake-storage RunSave, seed all 6 discovered, position at dig point, advance ~3s to complete the dig, assert the fake storage's run key now has `won:true` while quest snapshot `finaleActive:true, treasureFound:false`. Then build a second game from the same storage and assert `treasureFound:true` + reveal called. Observable: win the dig, reload during the golden spectacle → title says 'Expedition complete', no re-dig required.

**Risk.** Depends on RunSave + the `won` restore path. No perf impact (one localStorage write on a once-per-game event). Watch: don't also flip in-store `treasureFound` early — the finale spectacle timing must stay owned by QuestSystem; only the persisted `won` moves earlier.

**Cross-cutting.** A timing corollary of the win-persistence fix. Same RunSave, just written on the finale-start edge rather than the finale-end edge. Overlaps 'Reload after a win re-buries the idol' and 'TreasurePanel's reload guard'.

### 5. [minor] Completion is not a persisted state — the title can't tell a winner from someone who only read every page
_Effort: M_

**Root cause.** TitleScreen.tsx:41-47 `readProgress()` derives everything from the persisted discovered-id count and TitleScreen.tsx:79-87 shows 'N of total pages found' + 'Continue' on any `discovered>0`. `treasureFound` is absent from persistence, so a winner and a page-completionist are indistinguishable, and the model can't represent 'you won'.

**Solution.** Once RunSave carries `won`, extend the title to a distinct completion state and give the returning winner a coherent recap. Add `won:boolean` (and the recap stats) to `TitleProgress`; `readProgress()` reads `runSave.load()` for `won`, `playSeconds`, `deaths`, `fruitEaten`. When `won`, render a completion card: heading 'Expedition complete', the recap stats reusing `formatPlayTime` from TreasurePanel.tsx:21 (extract it to a small shared util `src/ui/formatPlayTime.ts` so both screens import it), and CTAs — 'Revisit' (dispatch `start`, which resumes the solved free-roam world) and 'New expedition' (wipe RunSave via `runSave.clear()` then `start`). This makes the title the honest home for the recap and removes the ambiguous 'Continue' for winners.

**Files.**
- `src/ui/formatPlayTime.ts (new — extracted from TreasurePanel.tsx)`
- `src/ui/TitleScreen.tsx:7-12,41-47,57-98 (extend TitleProgress; read `won`+stats; render completion card + New-expedition CTA)`
- `src/ui/TreasurePanel.tsx:21 (import the extracted formatPlayTime)`
- `src/App.tsx:22-28 (wire a 'new expedition' handler that clears RunSave before dispatching start)`
- `src/ui/TitleScreen.test.tsx (acceptance)`

**Steps.**
1. Extract `formatPlayTime` to a shared util and re-import it in TreasurePanel.
2. Add `won` + optional recap stats to TitleProgress and readProgress (reading RunSave).
3. Render the completion variant (heading, recap dl, Revisit + New-expedition CTAs) when `won`.
4. Thread a `onNewExpedition` prop from App that calls `runSave.clear()` then dispatches `start`; keep the plain `onStart` for Revisit.
5. Test the three title states: fresh (Begin), mid-run (Continue + N pages), won (Expedition complete + recap).

**Acceptance.** TitleScreen.test.tsx (already exists): add a case passing `progress={{discovered:6,total:6,won:true,playSeconds:600,deaths:1,fruitEaten:3}}` and assert 'Expedition complete', the formatted time '10:00', and a 'New expedition' button distinct from a mere Continue. Observable: after winning, the title reads 'Expedition complete' with real stats, not 'Continue'.

**Risk.** Depends on RunSave carrying `won` + stats. Pure UI/state, no engine or perf impact. Watch focus-on-mount (existing headingRef effect) still targets the heading in the new variant. Extracting formatPlayTime is a trivial refactor — keep TreasurePanel's existing tests green.

**Cross-cutting.** UX/story-facing half of the same win-persistence gap as 'Reload after a win re-buries the idol' (systems half). One decision: persist `won`, restore a visible-idol free-roam, and surface the recap here on the title. Overlaps the UX audit area (returning-player journey) — the unified fix is this completion card.

### 6. [minor] Mid-run reload yields a self-contradictory play state (read pages, brand-new body)
_Effort: S_

**Root cause.** Persistence is partial: DiscoverySystem loads discovered ids from persistence.ts while buildGame.ts:107-109 rebuild every other store fresh and buildPlayer.ts:41 pins position to SPAWN. So the journal/page counter reflect prior exploration while meters, timer, deaths and position all read as a just-woke player at camp — the live state contradicts itself.

**Solution.** Resolve by making persistence atomic across all run-state systems via the single RunSave object (spec in 'Continue respawns at camp…'). Because discovered ids, position, meters, playSeconds, deaths, fruitEaten and won all live in ONE versioned record written together (event-driven + pagehide + a 5s autosave through a single `game.saveRun()`), a restore is internally consistent by construction: there is no longer a 'discovered persists but the rest resets' split. The DiscoveryPersistence adapter reads/writes the same record, so discovery can never diverge from the rest. This is the direct implementation of the finding's 'make persistence atomic across all run-state systems' direction (chosen over 'persist nothing' because the design leans on survival stakes and an honest resume).

**Files.**
- `src/persistence/runSave.ts (the single-record store — the atomicity guarantee)`
- `src/discovery/persistence.ts (adapter over the same record)`
- `src/buildGame.ts (single load + single `saveRun()` snapshotting all systems)`
- `src/engine/GameCanvas.tsx (one autosave trigger for the whole record)`
- `src/buildGame.test.ts (acceptance — consistency assertion)`

**Steps.**
1. Ensure all writers (DiscoverySystem via the adapter, finale-start, autosave) funnel into the one RunSave record.
2. Ensure buildGame performs exactly one `load()` and seeds every system from it.
3. Add a consistency test: a save produced by playing then reloading yields a state where discovered count, playSeconds>0, meters and position all agree.

**Acceptance.** buildGame.test.ts: build game A, seed 3 discoveries + advance time + move the player + drop meters, call `saveRun()`, then build game B from the same fake storage and assert ALL of {discovered:3, playSeconds>0, position≠SPAWN, meters not FULL} simultaneously — no field reads as 'minute zero'. Observable: mid-run reload wakes you where you were, as tired as you were, with your pages — no contradiction.

**Risk.** Depends on the whole RunSave landing; this finding is the consistency invariant that the earlier findings' fields must jointly satisfy. No perf impact. Watch the multi-writer merge: patches must read-modify-write the in-memory record so one writer never clobbers another's field (the RunSave holds a single mutable record and patches merge into it).

**Cross-cutting.** This is the umbrella finding: it is fully satisfied by the unified RunSave that resolves the other five persistence findings. No independent work beyond guaranteeing single-record atomicity and a single load/save path.

### 7. [minor] Reload is a free survival reset that keeps clue progress
_Effort: S_

**Root cause.** buildGame.ts:107 builds survival at FULL (survivalStore.ts:37-47, SurvivalSystem.ts:77-82) with no load path, while discovered pages persist (persistence.ts). A player near death can reload and click Continue to wake fully restored with all clue progress intact — reload launders a near-death situation into full health, undercutting the survival stakes.

**Solution.** Closed directly by the RunSave meter persistence (specced in 'Continue respawns at camp…'): seed SurvivalSystem's private health/stamina/hunger/thirst/breath from `saved.meters` at build, and autosave the live meters on pagehide/visibility/interval. Once meters round-trip, a reload preserves the near-death state — the reload is no longer a reset. Critically, meters must be captured by the same autosave that captures position, so the window between the last event-save and the reload is bounded (≤5s) and cannot be gamed into a heal. No separate mechanism is needed beyond the RunSave `meters` field.

**Files.**
- `src/persistence/runSave.ts (the `meters` field)`
- `src/survival/SurvivalSystem.ts:77-95 (`initialMeters` seed)`
- `src/buildGame.ts (pass `saved?.meters`; include meters in `saveRun()`)`
- `src/survival/SurvivalSystem.test.ts, src/buildGame.test.ts (acceptance)`

**Steps.**
1. Add `meters` to RunState and `initialMeters` to SurvivalSystem (default all FULL).
2. Thread `saved?.meters` in buildGame and include the live meters in the `saveRun()` snapshot.
3. Test that seeding low meters and rebuilding preserves them (no snap-to-FULL).

**Acceptance.** SurvivalSystem.test.ts: construct with `initialMeters:{health:8,thirst:2,…}`, assert the first store snapshot reflects them (not FULL) and that decay proceeds from there. buildGame.test.ts: seed RunSave meters low, build, assert survivalStore snapshot low. Observable: near-death, reload, Continue → still near death.

**Risk.** Depends on RunSave + the SurvivalSystem seed (shared with the win-stats finding). No perf impact (off-loop writes). Watch: respawn (SurvivalSystem.ts:124-136) still correctly overrides to respawnLevel — persistence must not fight the death→respawn path (it doesn't; respawn writes live state which the next autosave captures).

**Cross-cutting.** Not a separate fix — the `meters` field of the unified RunSave from 'Continue respawns at camp…'. It also underpins the accuracy of 'Mid-run reload yields a self-contradictory play state'.

### 8. [minor] TreasurePanel's reload guard defends a state that can never be restored
_Effort: S_

**Root cause.** TreasurePanel.tsx:47-52 captures the first `treasureFound` snapshot as `baselineRef` with the comment 'if the very first snapshot already says treasureFound, that is restored state' — but persistence.ts saves only discovered ids and QuestSystem.ts:71 always starts `treasureFound=false`, so no reload path ever hands the panel a first snapshot of true. The guard's named scenario is currently unreachable, masking the missing win-persistence.

**Solution.** This becomes a genuine, load-bearing guard the moment win persistence lands (finding 'Reload after a win re-buries the idol'): with `initialTreasureFound=true` seeded from RunSave, a post-win reload does produce a first snapshot of `treasureFound=true`, and the baseline correctly suppresses re-popping the win panel (the recap now lives on the title). So the fix is: implement the win persistence (making the guard real) and update the comment from a hypothetical to a fact — cite that on a restored win the seed is true and the recap is shown on the title, so the panel intentionally stays closed. No behavioural change to the panel is needed; only the underlying seed and the comment.

**Files.**
- `src/quest/QuestSystem.ts (the `initialTreasureFound` seed from the idol-reburial finding)`
- `src/buildGame.ts (pass the seed)`
- `src/ui/TreasurePanel.tsx:50-52 (update the comment to reflect that restored-win is now real and routed to the title recap)`

**Steps.**
1. Ship the `initialTreasureFound` seed (finding 'Reload after a win re-buries the idol').
2. Update TreasurePanel's baseline comment to state the concrete restored-win path and that recap is handled by the title completion card.
3. Add a test proving the panel stays closed when the first snapshot is already treasureFound.

**Acceptance.** TreasurePanel test (co-locate with existing UI tests): render with a quest store whose initial snapshot has `treasureFound:true` → panel renders null (never pops). Then flip a fresh store false→true at runtime → panel opens. Proves the guard now defends a reachable state.

**Risk.** Purely dependent on the win-persistence seed; no perf impact. Do not weaken the guard — if win persistence were reverted, the guard must still hold (baseline captures first snapshot regardless).

**Cross-cutting.** Not an independent bug — it is the documentation/consistency tail of the win-persistence gap ('Reload after a win re-buries the idol' + 'Completion is not a persisted state'). Fixing those makes this guard meaningful; this item is just the comment truthing-up and a confirming test.

---

## Share Flow  
_7 solutions_

### 1. [MAJOR] Fixed-seed world makes expedition time a real cross-player challenge, and share throws it away
_Effort: S_

**Root cause.** The world is deterministic — `seed: 20260708` is a hard-coded constant 'fixed so the world is identical every load' (worldConfig.ts:34-35) — so `q.playSeconds` is a fair, leaderboard-grade metric across all players. But the share payload is the bare origin+base (shareCapabilities.ts:58) and the rendered time at TreasurePanel.tsx:96-98 is never routed into it. The design-native competitive hook ('beat my time on the same map') exists in the world model but is absent from the one feature meant to exploit it.

**Solution.** This is a framing/copy decision layered onto the finding-1 composer, not separate code. In buildShareMessage, phrase the text as a same-map time challenge that names the fixity explicitly: e.g. 'I found the Lost Idol in 12:34 — same island, same start. Can you beat my time?'. The 'same island' claim is load-bearing and only true because the seed is constant, so add a one-line comment in shareMessage.ts citing worldConfig.ts:34-35 as the guarantee, so a future move to a randomized seed forces this copy to change. No separate seed value needs to enter the payload (every build ships the same seed); if seeds ever vary per build, thread WORLD.seed into the payload then.

**Files.**
- `src/ui/shareMessage.ts (text template + a comment tying the 'same island' claim to worldConfig.ts:34-35)`
- `src/ui/shareMessage.test.ts (assert the challenge framing wording)`

**Steps.**
1. In buildShareMessage, use the time-attack sentence including a same-map claim.
2. Add a comment referencing worldConfig.ts seed fixity as the correctness precondition for the 'same island' wording.
3. Assert in shareMessage.test.ts that the text contains both the formatted time and a beat-my-time challenge phrase.

**Acceptance.** shareMessage.test.ts asserts buildShareMessage output text matches /can you beat/i and contains '12:34' for playSeconds 754. Observable in build: winning and tapping Share on a device with a share sheet surfaces a message naming your time and inviting a beat-it attempt.

**Risk.** No perf-budget impact. Purely the copy inside the finding-1 composer — do not build a second composer. Regression to watch: the 'same island' claim becomes false if the seed is ever randomized; the cited comment is the guard.

**Cross-cutting.** Same unified change as findings 1, 2, 6 — this is the wording layer of the shared shareMessage composer. Ships together, not as its own slice.

### 2. [MAJOR] Share sends the bare homepage URL, wasting the one natural completion-brag moment
_Effort: M_

**Root cause.** TreasurePanel has every frozen stat in scope (`q.playSeconds`, `q.cluesFound`, `q.deaths`, `q.fruitEaten` at TreasurePanel.tsx:94-113) but the share path carries none of them. `shareUrl` defaults to `realShareUrl` (TreasurePanel.tsx:41), `useShare(shareCapabilities, shareUrl)` binds only that URL (TreasurePanel.tsx:48), `handleShare` calls `share()` with no argument (TreasurePanel.tsx:80-83), and the seam ultimately invokes `capabilities.share({ url })` (useShare.ts:112) — where `url` is `socialUrlHref(import.meta.env.BASE_URL)`, the bare origin+base (shareCapabilities.ts:58). The payload is structurally decoupled from the stats rendered two inches above the button.

**Solution.** Introduce a pure composer `buildShareMessage(stats, url): SharePayload` in a new `src/ui/shareMessage.ts` (house pattern: pure, DI-friendly, mirrors shareAnnouncement.ts). It reuses `formatPlayTime` and returns `{ title: 'The Lost Idol', text: 'I found the Lost Idol in 12:34 on the same island — can you beat my run?', url }`. TreasurePanel builds the payload from the current snapshot `q` and passes it through the widened useShare seam (see the finding 2 solution — that seam widening is the prerequisite). This turns the victory screen's share into an actual completion brag with the expedition time baked in. Zero WebGL/geometry/draw-call/per-frame cost — this is React shell + a string builder run once per click.

**Files.**
- `src/ui/shareMessage.ts (new — buildShareMessage(stats:{playSeconds:number;deaths:number;cluesFound:number;cluesTotal:number}, url:string): SharePayload)`
- `src/ui/TreasurePanel.tsx (handleShare / useShare call site, lines 41-48, 80-83)`
- `src/ui/shareMessage.test.ts (new)`

**Steps.**
1. Land the finding-2 seam widening first (SharePayload type through performShare/useShare).
2. Create src/ui/shareMessage.ts exporting buildShareMessage; import formatPlayTime from TreasurePanel (or move formatPlayTime into a shared util if a circular import appears — prefer keeping it in TreasurePanel and importing it).
3. Compose the text template with formatPlayTime(playSeconds); keep it one sentence, no emoji.
4. In TreasurePanel, replace `const { share } = useShare(shareCapabilities, shareUrl)` with a payload built via useMemo over [shareUrl, q.playSeconds, q.deaths, q.cluesFound, q.cluesTotal], and pass it to useShare.
5. Keep shareUrl prop as the injected URL input (default realShareUrl) so tests still control it.

**Acceptance.** New src/ui/shareMessage.test.ts asserts buildShareMessage({playSeconds:754,...}, 'https://x/') returns text containing '12:34' and url 'https://x/'. Extend TreasurePanel.test.tsx: mount with a spy `share: vi.fn().mockResolvedValue(undefined)` capability, click Share, assert the spy was called with an object whose `text` contains '12:34' and whose `url` is the injected shareUrl.

**Risk.** Depends on finding 2 (seam must carry text first). No perf-budget impact (no geometry/passes/per-frame CPU). Watch: keep formatPlayTime the single source of the mm:ss format so the stat row and the brag text never diverge; avoid a circular import between shareMessage.ts and TreasurePanel.tsx.

**Cross-cutting.** This, finding 2 (seam widening), finding 3 (time-attack framing), and finding 6 (copied string carries context) are ONE unified change: widen the seam once, add one shareMessage composer, and all four are satisfied. The composer's text IS the time-attack framing (finding 3) and IS the context the clipboard copies (finding 6). Ship as a single slice.

### 3. [minor] Desktop fallback silently copies a contextless URL and the panel never shows what was shared
_Effort: S_

**Root cause.** On desktop (no native share sheet), performShare falls to `clipboard.writeText(url)` and resolves 'copied' (useShare.ts:126-132), which the panel announces only as 'Link copied' (shareAnnouncement.ts:27). The copied string is the bare URL (contextless) and the card never renders the URL/text anywhere — the only feedback is the transient live-region line (TreasurePanel.tsx:125-127), so the user cannot inspect or verify what landed on their clipboard. Desktop is the primary platform for a keyboard+mouse first-person game, so this is the most common path.

**Solution.** Two parts. (1) Context: the clipboard now copies `${text} ${url}` via the finding-2 copyText composition, so the copied string already carries the brag. (2) Inspectability: render the shared message on the card as a read-only, selectable element that appears after a 'copied' or 'failed' outcome. Add a `<p className="treasure-panel__shared">` (or a read-only input for easy re-copy) showing the composed text + URL, driven by a new `sharedText` state set in handleShare from the same payload. Keep it visually quiet, aria-hidden from the live region (the status line already announces). This makes the copied content visible and verifiable, resolving the 'you have no idea what just hit your clipboard' problem.

**Files.**
- `src/ui/useShare.ts (copyText composition — shared with finding 2)`
- `src/ui/TreasurePanel.tsx (sharedText state, render read-only shared line after copied/failed)`
- `src/tokens.css (.treasure-panel__shared styling)`
- `src/ui/TreasurePanel.test.tsx (assertion)`

**Steps.**
1. Ensure finding-2's clipboard copyText builds `${text} ${url}` when text is present.
2. In handleShare, after the outcome resolves, if outcome is 'copied' or 'failed', set a sharedText state to the composed payload string.
3. Render sharedText in a quiet, user-selectable element (read-only input or <p> with user-select:text) so it is inspectable and re-copyable.
4. Style .treasure-panel__shared to be subordinate to the CTAs; do not put it in the live region (avoid double announcement).

**Acceptance.** TreasurePanel.test.tsx: mount with a clipboard-only capability (`{ clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } }`), click Share, assert writeText received a string containing both '12:34' and the URL, and assert the card now renders an element containing that URL text (queryable via screen.getByDisplayValue or getByText).

**Risk.** No perf-budget impact. Depends on finding-2 copyText composition (do not re-implement the string join). Regression to watch: don't surface the shared line inside the aria-live region or screen readers will double-speak; keep the existing role=status line as the only announcer.

**Cross-cutting.** The 'copied string carries context' half of this is the same edit as finding 2's copyText composition — implement once in performShare. Only the on-card inspectable element is unique to this finding.

### 4. [minor] Share CTA is never disabled while a share is pending — violates the useShare contract and allows concurrent shares
_Effort: S_

**Root cause.** useShare's documented caller obligation is 'Disable the CTA while a share() call is pending' because the hook has no re-entrancy latch — double-tap protection is delegated to the button's disabled state (useShare.ts:158-163, and the concurrent-calls test at useShare.test.tsx:399-434 proves both invocations reach the capability). TreasurePanel renders `<button ... onClick={handleShare}>` with no pending tracking and no `disabled` (TreasurePanel.tsx:118-120); handleShare (:80-83) tracks no in-flight state. A rapid double-click fires two concurrent share() calls — on the native path this can open two sheets or produce out-of-order announcements.

**Solution.** Add a `pending` boolean state in TreasurePanel. In handleShare, guard re-entry (`if (pending) return;`), set `pending=true` before `await share()`, and reset it in a `finally` (share() never rejects, so finally is safe). Bind `disabled={pending}` on the Share button. Optionally clear focus-drop concern by leaving focus where it is (jsdom never blurs on disable — the #131 run log already flags this as untestable dead code, so do not add a focus-restore branch). Apply the identical pattern to the finding-4 title-screen invite button.

**Files.**
- `src/ui/TreasurePanel.tsx (pending state, handleShare guard/finally, Share button disabled — lines 44-45 area, 80-83, 118-120)`
- `src/ui/TreasurePanel.test.tsx (pending/disabled test)`

**Steps.**
1. Add `const [pending, setPending] = useState(false);`.
2. Rewrite handleShare: early-return if pending; setPending(true); try { outcome = await share(); setAnnouncement(...) } finally { setPending(false) }.
3. Add `disabled={pending}` to the Share button.
4. Reuse the same latch in the finding-4 TitleScreen invite button.

**Acceptance.** TreasurePanel.test.tsx: use a deferred `share` fake (manual settler, as in useShare.test.tsx:399-411). Click Share, assert the button is `disabled` while the promise is unsettled and that a second click does not increment the share spy's call count; resolve the settler, assert the button re-enables and the announcement lands. The existing 'share announces its outcome' test (TreasurePanel.test.tsx:91-98) must stay green.

**Risk.** No perf-budget impact. The .cta:disabled style already exists (tokens.css:174-177), so no CSS work. Regression to watch: ensure setPending(false) runs even when share() classifies to 'failed' (it never rejects, so finally is reliable); do not add a jsdom-untestable focus-restore branch (flagged as dead code in the #131 run log).

**Cross-cutting.** The same pending-latch pattern is required by finding 4's title-screen invite button — implement the pattern once and apply it in both components.

### 5. [minor] Share button carries primary-CTA weight equal to Replay while producing the least-valuable outcome
_Effort: S_

**Root cause.** On the win card both Replay and Share render as full-weight filled primaries (`className="cta"`, TreasurePanel.tsx:115-120), while Keep exploring is the quiet outlined variant (`cta cta--quiet`, :121-123). `.cta` is a filled accent, 700-weight button (tokens.css:156-167) and `.cta--quiet` is transparent/outlined (tokens.css:601-604). There is no middle tier, so Share reads as co-equal to the real action while (pre-fix) delivering the least.

**Solution.** Establish a three-tier visual hierarchy on the card: Replay = primary filled (`.cta`), Share = secondary, Keep exploring = quiet/tertiary. Add a `.cta--secondary` token (filled-but-muted: e.g. `background: color-mix(in srgb, var(--color-accent) 22%, transparent); border: 1px solid var(--color-accent); color: var(--color-fg); font-weight: 600`) and apply it to Share. This keeps Share a legitimate, tappable action (justified because findings 1-3 give it a real brag payload) without letting it shout as loud as Replay. If the seam-widening slice slips, the fallback is to demote Share to `.cta--quiet` until the payload lands.

**Files.**
- `src/tokens.css (new .cta--secondary rule near :601)`
- `src/ui/TreasurePanel.tsx (Share button className, line 118)`

**Steps.**
1. Add .cta--secondary to tokens.css with muted fill/outline and 600 weight, plus a reduced-motion/hover-safe treatment consistent with the existing .cta rules.
2. Change the Share button to `className="cta cta--secondary"`.
3. Leave Replay as `.cta` and Keep exploring as `.cta cta--quiet`.

**Acceptance.** TreasurePanel.test.tsx: assert the Replay button's className contains 'cta' without a modifier, Share contains 'cta--secondary', and Keep exploring contains 'cta--quiet' — proving three distinct tiers. Observable: on the win card the three buttons read as primary / secondary / quiet at a glance.

**Risk.** No perf-budget impact (CSS only). Soft dependency on findings 1-3: keeping Share visually meaningful is only honest once it carries a real payload; if this ships before the seam widening, use `.cta--quiet` instead. Regression to watch: the flex-wrap CTA row (tokens.css:594-599) layout across the three weights; verify focus-visible outline still reads on the new tier.

**Cross-cutting.** Standalone CSS/JSX tweak; only sequencing depends on the seam-widening slice.

### 6. [minor] Share is reachable only after winning — no title-screen invite despite the 'just a shared link' premise
_Effort: M_

**Root cause.** The only non-test importer of the share seam is TreasurePanel (TreasurePanel.tsx:4-6), gating every share affordance behind completing the hunt. TitleScreen (TitleScreen.tsx) is purely presentational with a single Start CTA and a text-view link — no share control. The #131 run log deliberately omitted the title-screen CTA to avoid adding a dialog/live-region host in that slice; that scope decision was never revisited, leaving the natural distribution entry point empty.

**Solution.** Add a lightweight, quiet 'Invite a friend' button on TitleScreen wired to the existing seam with a bare-URL payload `{ title: 'The Lost Idol', url: shareUrl }` (no stats — there is no run to brag about yet). Mirror TreasurePanel's DI pattern: add optional props `shareCapabilities = realShareCapabilities` and `shareUrl = realShareUrl`, a local `announcement` state, a `role=status aria-live=polite` region, and a pending latch (finding 7's pattern). Render it as `.cta--quiet` so it never competes with the primary Start CTA. This restores the 'no installs, just a shared link' distribution gesture at the actual entry point.

**Files.**
- `src/ui/TitleScreen.tsx (new props, useShare wiring, Invite button + live region)`
- `src/ui/TitleScreen.test.tsx (new tests)`
- `src/ui/shareMessage.ts (optional: an inviteMessage() helper or just inline the bare payload)`

**Steps.**
1. Import useShare, realShareCapabilities, realShareUrl, shareAnnouncementFor into TitleScreen.
2. Add optional shareCapabilities/shareUrl props (defaults to real) for test injection, mirroring TreasurePanel props 14-18.
3. Add pending + announcement state; handleInvite awaits share and sets the announcement.
4. Render a quiet 'Invite a friend' button (className 'cta cta--quiet') and a single polite status region, disabled while pending.
5. Keep the payload bare (title + url only) — no stats exist at the title.

**Acceptance.** TitleScreen.test.tsx: mount with a `share` spy capability, click 'Invite a friend', assert the spy received `{ url }` (bare, no text/time) and that a status live region updates on the copied/failed path (mirror TreasurePanel.test.tsx:91-98). Assert the invite button carries the quiet class, not primary weight.

**Risk.** No perf-budget impact (title screen, no WebGL). The shareCta.runlog.test.ts asserts the #131 run log records the TitleScreen CTA as 'omitted' — that is a historical fact about slice #131 and stays true; this new slice does not edit that log, so the lint stays green (note this explicitly in the new slice's own run log). Regression to watch: focus-on-mount currently targets the heading (TitleScreen.tsx:68-69); do not let the new button steal initial focus.

**Cross-cutting.** Reuses the finding-7 pending-latch pattern and the shareAnnouncement copy. Shares no payload code with the win-screen brag (bare URL here by design), so it can ship as its own small slice after the seam widening lands.

### 7. [minor] The share seam is structurally url-only and cannot carry a title or text
_Effort: M_

**Root cause.** The seam type only models a URL end-to-end: `ShareCapabilities.share?: (data: { url: string }) => Promise<void>` (useShare.ts:53), performShare invokes `capabilities.share({ url })` and `clipboard.writeText(url)` (useShare.ts:112, 131), and the navigator adapter mirrors the same `{ url }` shape (shareCapabilities.ts:19, 38-39). The Web Share API's supported `title`/`text` fields have no representation anywhere, so no call site can express a brag even if it wanted to.

**Solution.** Widen the contract to a `SharePayload` interface `{ title?: string; text?: string; url: string }` (named SharePayload, NOT ShareData, to avoid clashing with lib.dom's global ShareData). Change `ShareCapabilities.share?: (data: SharePayload) => Promise<void>` and `ShareNavigatorLike.share` to match. Change `performShare(capabilities, payload: SharePayload)` and thread `payload` to `capabilities.share(payload)`. For the clipboard fallback, compose a context-carrying string: `const copyText = payload.text ? `${payload.text} ${payload.url}` : payload.url;` then `clipboard.writeText(copyText)` — this is also the finding-6 fix. Update `useShare(capabilities, payload)` and re-key its useCallback on the primitive fields `[capabilities, payload.title, payload.text, payload.url]` so callers need not memoize the object to keep referential stability (preserves the existing identity contract).

**Files.**
- `src/ui/useShare.ts (SharePayload interface, ShareCapabilities.share, performShare signature+body lines 97-148, useShare signature+useCallback lines 171-180, JSDoc)`
- `src/ui/shareCapabilities.ts (ShareNavigatorLike.share line 19, shareCapabilitiesFrom line 38-39)`
- `src/ui/useShare.test.tsx (all performShare/useShare call sites)`
- `src/ui/shareCapabilities.test.ts (share fake signatures)`

**Steps.**
1. Add `export interface SharePayload { title?: string; text?: string; url: string }` to useShare.ts.
2. Change ShareCapabilities.share and ShareNavigatorLike.share to accept SharePayload; keep clipboard unchanged.
3. Change performShare's second param to `payload: SharePayload`; pass payload to share(); compute copyText for the clipboard branch.
4. Change useShare's second param to SharePayload and re-key useCallback on the four primitives.
5. Update the JSDoc caller-obligation block: the canonical-URL obligation must still name socialUrlHref exactly once and the four 'Announcement:' rules must remain (the JSDoc-lint in useShare.test.tsx counts them); reword the 'url' language to 'payload' without dropping those pinned strings.
6. Mechanically update the ~30 call sites in useShare.test.tsx and shareCapabilities.test.ts from `url` string to `{ url }` (or `{ text, url }` for a copy-context assertion).

**Acceptance.** useShare.test.tsx: add a test that a resolving `share` fake receives the full payload `{ title, text, url }`, and a test that the clipboard fallback receives `${text} ${url}` when text is present (proves copyText composition). Existing never-rejects matrix must stay green after the mechanical `{ url }` conversion. `npm run build` (tsc --noEmit) must pass — the JSDoc-lint and source-scan tests in useShare.test.tsx must remain green.

**Risk.** Highest test-churn item: ~30 call sites in useShare.test.tsx plus the JSDoc handoff-contract lint (useShare.test.tsx:484-543) that pins exact strings ('socialUrlHref' once, 'Link copied' once, 4 'Announcement:' markers, 4 caller obligations) and the comment-stripped global-isolation scan (:442-460 — do not introduce navigator/window tokens). No perf-budget impact. Regression to watch: the useCallback re-key must stay keyed on primitives, or a rebuilt payload object every render will bust identity and re-render memoized buttons.

**Cross-cutting.** Prerequisite for findings 1, 3, and 6. The clipboard copyText composition here IS the finding-6 'copied string carries the completion context' fix — do not duplicate it there.

---

## Performance & Loading  
_9 solutions_

### 1. [MAJOR] High tier sits at 97% triangles and spikes to 148/150 draw calls — effectively zero headroom, above the doc's own worst case
_Effort: L_

**Root cause.** Measured spawn camp-vista: ~123 draws/~486k tris avg with maxima ~145-148 draws/~488k tris (docs/perf-budget.md:673-684). The per-frame draw maxima above the average correlate with the ~2s PMREM env rebake (finding 6) landing on an already-97%-full frame — the bake renders a mini-scene through 6 cubemap faces, adding draws to that single frame. Steady draws come from the chunked flora meshes (floraUpgrade.ts) + camp/ruin site meshes that are not all merged. There is no ceiling preventing the bake frame tipping past 150.

**Solution.** Attack both the spike and the steady floor. (1) Remove the spike by amortizing/rescheduling the env bake (see finding 6) AND by never baking on a frame that is already near budget: gate EnvLightSystem's shouldRebake behind a cheap 'not this frame' deferral so the bake waits for the next frame if the previous frame's draw count (from finding 2's getFrameStats) was within N of 150 — bake one frame later rather than on the peak. (2) Reclaim steady headroom: audit src/world/landmarks.ts and the camp/canoe/ruin object meshes (objectDetail 'full') for sibling meshes that share a material and could mergeGeometries into one draw, and re-check floraUpgrade.ts chunk-cell granularity so fewer chunk meshes fall in the spawn frustum (coarser cells near shore = fewer draws, at a small culling-precision cost). Re-measure each change with scripts/measure-frame-cost.mjs and record against the 97.1% baseline.

**Files.**
- `src/world/envLightSystem.ts:141-170 (defer bake off near-budget frames)`
- `src/world/landmarks.ts / src/world/landmarksUpgrade.ts (merge same-material site meshes)`
- `src/world/floraUpgrade.ts (chunk-cell count/size review)`
- `scripts/measure-frame-cost.mjs (re-measure)`

**Steps.**
1. Land finding 2 first so true per-frame draws are readable.
2. Amortize/reschedule env bake per finding 6 (raise interval on medium, stagger).
3. Add a one-frame bake deferral in EnvLightSystem when the prior frame was within ~10 draws of 150.
4. Profile with measure-frame-cost.mjs, then merge the highest-count same-material site meshes via BufferGeometryUtils.mergeGeometries.
5. Tune floraUpgrade chunk cells to shave a few spawn-frustum draws; re-measure.
6. Record new spawn max draws/tris in docs/perf-budget.md.

**Acceptance.** scripts/measure-frame-cost.mjs high spawn reports max draws ≤ ~135 and avg tris ≤ ~470k (a real headroom margin below 150/500k), with no per-frame spike crossing 150. Add the accounting test from finding 4 to pin it in CI.

**Risk.** Merging site meshes loses per-object frustum culling — only merge small, always-visible camp props, not island-spanning geometry. Coarser flora chunks reduce cull precision (a few extra tris drawn) — net-positive only if draws drop more than tris rise; measure both. Depends on finding 2 (readable draws) and finding 6 (bake amortization).

**Cross-cutting.** Tightly coupled to finding 6 (the draw SPIKE is the env bake) and finding 4 (the guard that keeps this reclaimed headroom from silently eroding). Also relieved by findings 8 and 9 which cut composited-tier fill/passes.

### 2. [MAJOR] Live perf guard (StatsOverlay/getState) is blind on the compositor tiers — always reports 1 draw / 1 triangle
_Effort: M_

**Root cause.** Engine.getState() (src/engine/Engine.ts:247-255) reads renderer.info.render.calls/triangles. On medium/high the EffectComposer (src/engine/createCompositor.ts:407-420) calls renderer.render() several times per frame (RenderPass, N8AOPostPass, EffectPass); three's WebGLRenderer.info has autoReset=true, so it zeroes at the start of every render() and ends the frame reflecting only the final fullscreen-triangle EffectPass. checkFrame in StatsOverlay.tsx:26-29 therefore evaluates 1/1 and can never turn red on exactly the tiers running at ~97% of budget.

**Solution.** Have the compositor expose true cumulative per-frame totals and prefer them in getState. In createBloomCompositor: after configureCompositorColor, set renderer.info.autoReset=false. In the returned delegate's render(): call renderer.info.reset() once at the very start, then composer.render(), then snapshot {drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles} into a closure field. Add an optional getFrameStats?():{drawCalls:number;triangles:number} to the RenderDelegate interface (src/engine/types.ts) — a plain numeric shape, no postprocessing types leak. Engine.getState() reads this.compositor?.getFrameStats?.() when present, else falls back to renderer.info (the bare/low path, already correct). Restore autoReset=true in the delegate's dispose() so a torn-down compositor doesn't leave the renderer with manual-reset semantics.

**Files.**
- `src/engine/types.ts (RenderDelegate.getFrameStats?)`
- `src/engine/createCompositor.ts:405-446 (autoReset=false; reset()+snapshot in render(); expose getFrameStats; restore in dispose)`
- `src/engine/Engine.ts:242-256 (getState prefers compositor.getFrameStats())`
- `src/engine/Engine.test.ts (headless: fake RenderDelegate with getFrameStats)`

**Steps.**
1. Add getFrameStats?() to RenderDelegate in types.ts.
2. In Engine.getState, prefer compositor.getFrameStats() over renderer.info when the method exists.
3. In createBloomCompositor set renderer.info.autoReset=false; in render() call renderer.info.reset() before composer.render(), then snapshot totals into a field returned by getFrameStats.
4. Restore renderer.info.autoReset=true in dispose().
5. Add a headless Engine test: a RenderDelegate stub returning {drawCalls:121,triangles:485000} makes getState report those, and StatsOverlay's checkFrame would flag a stub returning >150 draws.

**Acceptance.** New Engine.test.ts case: an Engine with a compositor stub exposing getFrameStats()={drawCalls:151,triangles:600000} yields getState().drawCalls===151/triangles===600000 and checkFrame(that).withinBudget===false. Observable: on a high-tier running build the overlay shows realistic ~120 draws / ~485k tris, not '1 draws 0k tris'.

**Risk.** autoReset=false means EVERY caller of renderer.info must be reset-aware — only the compositor render loop touches it, so keep the reset there; restore-on-dispose prevents leakage if quality is toggled. No GPU cost added (a snapshot of counters). Enables finding 4's CI assertion to read true numbers.

**Cross-cutting.** Prerequisite for finding 4 (a whole-scene guard is meaningless while getState lies) and validates findings 3/6 spikes live.

### 3. [MAJOR] No automated whole-scene budget guard — a total-scene regression over 500k tris / 150 draws ships silently
_Effort: M_

**Root cause.** The suite asserts only per-component budgets (src/wildlife/jaguar.test.ts:381 tris<2000; wildlife aggregate ≤40k). No test references PERF_BUDGET.maxTriangles/maxDrawCalls against an assembled scene. The only whole-scene check is scripts/measure-frame-cost.mjs, which is manual and not in any CI-gated npm script (package.json:10-20 gates only check:bundle via CI). Vitest is headless/no-WebGL so it cannot render the real scene.

**Solution.** Two complementary guards. (1) A headless BUDGET-ACCOUNTING test: create src/perf/sceneBudget.test.ts that imports the pure per-category triangle/draw contributors already exported (CANOPY_TREE_COUNT/PALM_COUNT/UNDERSTORY_COUNT/ROCK_COUNT from props.ts, per-model tri counts, landmark/wildlife budgets) and sums the high-tier worst-case, asserting it stays under a HEADROOM threshold (e.g. 0.92*500k tris and 140 draws, below the hard 500k/150). This models the assembled scene from the same constants production reads, so a density/count bump that would blow budget fails in npm test. (2) Wire scripts/measure-frame-cost.mjs into a --assert mode (exit 1 when draws>threshold||tris>threshold) and add an npm script check:frame; run it in the build-machine CI job where a real GPU exists (the render-gate runner is software-GL/low, so this is a separate optional gate documented as GPU-required).

**Files.**
- `src/perf/sceneBudget.test.ts (new — headless accounting)`
- `scripts/measure-frame-cost.mjs (add --assert threshold mode + exit code)`
- `package.json:10-20 (add check:frame script)`
- `docs/perf-budget.md (document the guard + thresholds)`

**Steps.**
1. Enumerate the per-category tri/draw contributors already exported as constants/pure fns; where a contributor is only measured (not derived), add a pure exported estimator.
2. Write sceneBudget.test.ts summing the high-tier worst case and asserting < headroom thresholds (0.92*maxTriangles, 140 draws).
3. Add --assert to measure-frame-cost.mjs returning non-zero on breach.
4. Add package.json check:frame and document it as the GPU-required optional CI gate; keep the accounting test as the always-on Vitest gate.
5. Set thresholds from the current 97.1% baseline reduced by finding 3's reclaimed headroom.

**Acceptance.** npm test fails when a contributor constant is bumped past the headroom threshold (verify by temporarily raising CANOPY_TREE_COUNT in the test's arithmetic). measure-frame-cost.mjs --assert exits 1 when a real high-tier spawn frame exceeds the threshold.

**Risk.** The accounting test is a MODEL, not a real render — it can drift from GPU truth if a new feature isn't added to the sum; mitigate by asserting the model total tracks the last measure-frame-cost baseline within a tolerance and by requiring new tri-adding features to register their contribution. Depends on finding 2 for the live-measured half to read true numbers.

**Cross-cutting.** Depends on finding 2 (true getFrameStats) for any live-measured assertion; protects the headroom reclaimed in finding 3.

### 4. [MAJOR] The mid-range phone the budget targets runs the MEDIUM tier — which has never been fps-measured on mobile-class hardware
_Effort: L_

**Root cause.** detectTier (src/perf/deviceCapability.ts:65-88) only drops to low at cores<=2||mem<=2 (line 79) or (isTouch&&mem<=3&&dpr>=2) (line 80); every other touch device — a 4GB+ iPhone SE / typical Android — falls through to the medium return at line 87. QUALITY_TIERS.medium (src/perf/quality.ts:205-227) then carries the full fill stack: shadows on, waterDisplacement on, bloom+N8AO+SMAA+vignette+godrays-less merged pass, terrainDetail/waterDetail 'full', envDynamic on (~2s PMREM rebake). The only mobile-representative measurement in the repo is the software-GL LOW render gate; docs/perf-budget.md:694-698 concedes the headless ~120fps is not a mobile figure. So the ≥30fps bar is unverified for the tier real phones get.

**Solution.** Two parts. (A) MEASURE: extend scripts/measure-frame-cost.mjs to also emulate mobile-class throughput via Playwright CDP — session.send('Emulation.setCPUThrottlingRate',{rate:4}) plus launching with a throttled/software GL, and sample real wall-clock frame time (rAF timestamps already wrapped in that script) not renderer.info, to get a medium-tier ms/frame number. Because medium is auto-detect-only, spoof navigator.hardwareConcurrency/deviceMemory=4 via addInitScript (the script already forces settings) so detectTier lands on medium. (B) If medium misses 30fps throttled, add a touch-aware medium config: introduce a fourth entry MOBILE_MEDIUM (or a pure adjustTierForTouch(config,isTouch) in quality.ts) that clones medium but drops the three named fill-heavy knobs — shadows:false, waterDisplacement:false, and a new ao.enabled:false gate (add `enabled` to AOQualityConfig, honored in buildAOPass caller so the N8AO pass is not added when false) — while keeping medium's propDensity/terrainDetail. Thread isTouch (from isTouchEnv, already exported deviceCapability.ts:61) into resolveQuality as a third arg, applied only when the resolved tier is medium via auto.

**Files.**
- `scripts/measure-frame-cost.mjs (add CPU-throttle + medium spoof + ms/frame sampling)`
- `src/perf/quality.ts (resolveQuality signature; MOBILE_MEDIUM or adjustTierForTouch; AOQualityConfig.enabled)`
- `src/engine/GameCanvas.tsx:157 (pass isTouchEnv(readEnv-equivalent) into resolveQuality)`
- `src/engine/createCompositor.ts:408-412 (only addPass(aoPass) when quality.ao.enabled)`
- `src/perf/quality.test.ts (assert touch-medium drops shadows/waterDisplacement/ao)`

**Steps.**
1. Extend measure-frame-cost.mjs with a CPU-throttle flag and medium-spoof init script; sample rAF delta ms, print avg fps.
2. Run it against a preview build to get a throttled medium ms/frame figure; record in docs/perf-budget.md.
3. If ≥30fps holds, stop (document the measurement). If not: add AOQualityConfig.enabled and gate the N8AO addPass on it.
4. Add adjustTierForTouch(config,isTouch) in quality.ts returning a lightened medium (shadows/waterDisplacement/ao off) only for medium; keep low/high untouched.
5. Thread isTouch into resolveQuality and its GameCanvas call site.
6. Add quality.test.ts cases pinning the touch-medium knobs and that non-touch medium is unchanged.

**Acceptance.** quality.test.ts: resolveQuality('auto','medium',{touch:true}) has shadows===false && waterDisplacement===false && ao.enabled===false, while {touch:false} keeps the full medium stack. Observable: measure-frame-cost.mjs --throttle reports ≥30 fps for the (possibly lightened) medium config.

**Risk.** Touch-medium is a visual downgrade for capable tablets; gate strictly to auto-detected medium so a player who forces 'high' is unaffected (resolveQuality already forces low/high directly). No draw/triangle add — this REMOVES fill work. CPU-throttle emulation is an approximation, not a real device; document that limit. Cross-cuts finding 3 (headroom) and finding 6 (env rebake) which also lighten medium/high.

**Cross-cutting.** Shares the fill-reduction goal with findings 3, 6, 8, 9 — all reclaim fill/draw budget on the composited tiers; the AOQualityConfig.enabled gate added here is also the cleanest lever if finding 3 needs to shed a pass.

### 5. [minor] JS-gzip bundle headroom is thin (406.9 / 432 KB) after a recent cap raise
_Effort: M_

**Root cause.** npm run check:bundle reports 406.9/432 KB (25.1 KB free). The eager entry chunk grew to ~114.4 KB gz because buildGame (src/buildGame.ts → buildWorld) statically pulls medium/high-only behaviour into the eager graph that even low tier and the TTI path download and parse. The postfx/n8ao library is already lazy; the remaining fat is game-logic systems that are tier-gated at runtime but eager at load.

**Solution.** Audit the entry chunk and move tier-gated systems behind the existing dynamic-import seam (the floraUpgrade/loadCompositor idiom). First, produce a chunk breakdown: build with a rollup visualizer (or `vite build` + manual analysis of the entry chunk's module list) to rank contributors. Then, for systems only ever constructed on medium/high (candidates: CloudSystem/clouds.ts, AmbientMotesSystem/fx, grass.ts, rain detail, and any wildlife/quest FX that low never runs), extract their construction behind a dynamic import keyed on the quality knob (cloudDetail/ambientParticles/rainDetail/floraDetail 'full'), exactly like GameCanvas.loadCompositor gates postfx. Keep pure math modules (skyAtmosphere, envBakeScheduler) eager (they're tiny); target the systems that carry three-object construction and content.

**Files.**
- `src/buildGame.ts / src/world/buildWorld.ts (defer tier-gated system registration behind dynamic imports)`
- `src/world/clouds.ts, src/fx/AmbientMotesSystem.ts, src/world/grass.ts (become lazy-loaded on their 'full' knob)`
- `vite.config.ts:41-56 (add manualChunks buckets if needed so the deferred code lands in its own chunk, not the entry)`
- `docs/perf-budget.md (record the new entry-chunk figure)`

**Steps.**
1. Add a one-off bundle-analysis step (visualizer or vite build --mode with module listing) and rank entry-chunk contributors.
2. Identify systems constructed only when a quality knob is 'full' (cloud/motes/grass/rain).
3. Wrap each behind a dynamic import in buildWorld/buildGame, gated on the knob, mirroring loadCompositor's guarded-attach pattern.
4. Add manualChunks buckets so the deferred modules don't re-merge into the entry chunk.
5. Re-run check:bundle; confirm entry chunk and summed JS gz both dropped and record.

**Acceptance.** npm run check:bundle shows summed JS gz meaningfully below 406.9 KB (target ≥40 KB headroom) AND the entry chunk shrinks (measure eager JS gz before/after). A test/assertion that low-tier never fetches the deferred chunks (spy on the loader, mirroring GameCanvas.compositor.test.tsx).

**Risk.** Lazy systems attach a few frames late (same progressive-enhancement shape as the compositor) — ensure a late CloudSystem/motes attach cleanly and dispose on unmount. Don't defer anything low actually runs (would break low). Bundle analysis is exploratory; scope the extraction to the top 2-3 confirmed tier-gated contributors.

**Cross-cutting.** Same dynamic-import-behind-a-quality-knob idiom as findings 1's ao gate and the existing floraDetail/loadCompositor seams — one pattern, applied to shed eager bytes.

### 6. [minor] PMREM environment rebake runs a full fromScene blur chain every ~2s for the entire session on medium/high
_Effort: S_

**Root cause.** envBakeScheduler.ts:47-50 defaults minIntervalSeconds:2, deltaThreshold:0.05. The day cycle is always moving (dayCycleSystem), so paletteDelta clears 0.05 at nearly every 2s slot (~88 rebakes/180s loop). envLightSystem.ts:167-168 calls bake→pmrem.fromScene(size 96) (line 186), a cubemap capture + equirect/blur mip chain — a burst of extra draws in that one frame, correlating with the measured 144-148 draw spikes on high.

**Solution.** Make the bake cadence a tier-driven knob and slow it where it hurts. Add envBakeIntervalSeconds to QualityConfig (medium: 5, high: 3 — high stays more responsive since it has more GPU, medium backs off hardest since it's the phone-representative tier). Thread it from GameCanvas into EnvLightSystem, which passes an EnvBakeConfig override to shouldRebake instead of the hardcoded DEFAULT_ENV_BAKE_CONFIG (envLightSystem.ts:167). Because scene.environmentIntensity already updates every frame (envLightSystem.ts:161-163), brightness still tracks smoothly between the coarser texture rebakes — only the palette-hue refresh slows, which is imperceptible at this 96px ambient resolution. Optionally also drop ENV_CUBE_SIZE consideration, but interval is the cheaper, lower-risk lever. Combine with finding 3's one-frame deferral so a due bake never lands on a near-budget frame.

**Files.**
- `src/perf/quality.ts (QualityConfig.envBakeIntervalSeconds; set per tier)`
- `src/engine/GameCanvas.tsx:241-251 (pass interval into EnvLightSystem)`
- `src/world/envLightSystem.ts:107-170 (accept interval; build EnvBakeConfig override)`
- `src/world/envBakeScheduler.test.ts (assert cadence at the new interval)`

**Steps.**
1. Add envBakeIntervalSeconds to QualityConfig and the three tier entries (medium:5, high:3, low inert).
2. Extend EnvLightQuality with the interval and pass it from GameCanvas.
3. In EnvLightSystem.update, build { minIntervalSeconds: interval, deltaThreshold: 0.05 } and pass to shouldRebake instead of the default.
4. Add finding-3's near-budget deferral guard around the bake call.
5. Update envBakeScheduler.test.ts's swept measurement to assert ~1 rebake per interval and ~36 rebakes/180s at 5s.

**Acceptance.** envBakeScheduler.test.ts: sweeping a full 180s day loop at the medium interval yields ≈36 rebakes (down from ~88). Observable: measure-frame-cost.mjs high spawn shows no recurring ~2s draw spike above the average after the interval raise + deferral.

**Risk.** Slower hue refresh could show a faint stepping in reflections at dawn/dusk transitions — mitigated because environmentIntensity is still per-frame and the source is only 96px ambient; verify visually at a fast dawn transition. Directly removes the draw spike behind finding 3.

**Cross-cutting.** The env-bake spike IS finding 3's per-frame draw maximum — this fix and finding 3's deferral are the same underlying mechanism; also lightens finding 1's medium tier.

### 7. [minor] three (532 KB raw / 134 KB gz) is eagerly modulepreloaded and parsed before the title screen, which never uses it
_Effort: S_

**Root cause.** src/App.tsx:4 statically imports GameCanvas, which at src/engine/GameCanvas.tsx:2 statically imports * as THREE. So the entry graph pulls the three chunk and index.html emits rel=modulepreload for it; three must download+parse before React paints TitleScreen (src/ui/TitleScreen.tsx imports no three). ~532 KB raw parse runs up front on the main thread even though the first interactive surface needs none of it.

**Solution.** Code-split GameCanvas behind React.lazy so three lands only when the player enters the 'playing' phase. In App.tsx replace the static import with const GameCanvas = lazy(() => import('./engine/GameCanvas.tsx')) and wrap the 'playing' case in <Suspense fallback={<div className="loading-expedition"/>}>. The title/text phases then render from the React+entry chunks only; three (and its dynamic children) download on 'start'. Optionally prefetch on TitleScreen's 'Begin the expedition' hover/pointerdown via a bare import('./engine/GameCanvas.tsx') to hide the fetch behind the click.

**Files.**
- `src/App.tsx:4,30-31 (lazy + Suspense)`
- `src/ui/TitleScreen.tsx (optional: prefetch on CTA hover/pointerdown)`
- `a build-assertion test (see acceptance)`

**Steps.**
1. Change App.tsx to import { lazy, Suspense } and define GameCanvas via lazy().
2. Wrap the 'playing' render branch in Suspense with a lightweight fallback.
3. Optionally add onPointerDown prefetch of the GameCanvas chunk in TitleScreen.
4. Rebuild and confirm dist/index.html no longer modulepreloads the three chunk.

**Acceptance.** Build assertion (extend scripts/check-bundle-size.mjs or a new scripts/*.test.mjs): dist/index.html contains no modulepreload href matching /three-.*\.js/. Observable: TitleScreen first paint no longer waits on the three parse (measure with a throttled Lighthouse/Playwright FCP before vs after).

**Risk.** Suspense fallback flashes on entry — keep it minimal/branded. TTI already within budget so this is first-paint polish, not a breach fix. Verify the automation hooks (window.advanceTime etc.) still register after the lazy mount — they attach in GameCanvas's effect, unaffected by lazy loading.

**Cross-cutting.** None — isolated to the App/title seam owned with senior-eng-frontend; the split point (App.tsx) is the React shell, the three payload inside is ours.

### 8. [polish] God-rays internal pass runs every frame on high tier even at noon when its contribution is 0
_Effort: M_

**Root cause.** On high, GodRaysEffect is merged into the single EffectPass (createCompositor.ts:360-362). EffectPass.render (node_modules/postprocessing/build/index.js:15645-15648) unconditionally calls effect.update() on every effect each frame — and GodRaysEffect.update() does the internal light-scattering raymarch into its own render target regardless of blend opacity. godRaysStrength (createCompositor.ts:162-166) returns 0 at a high sun and buildGodRays.update (line 241) only sets blendMode.opacity.value=0 — so midday spends the full shaft raymarch fill for an invisible result. Setting BlendFunction.SKIP would drop it from the compiled shader but NOT skip effect.update().

**Solution.** Give god rays its OWN EffectPass and toggle that pass's .enabled per frame — EffectComposer.render skips disabled passes entirely (index.js:1273), which is the only way to stop GodRaysEffect.update()'s internal render. In buildPasses, when high tier, build a dedicated godRaysPass = new EffectPass(camera, godRays.effect) inserted AFTER aoPass and BEFORE the merged bloom/SMAA/vignette/tonemap EffectPass (so bloom still picks up the shafts, preserving the original merge intent). In the delegate's render() (createCompositor.ts:414-421), compute base=godRaysStrength(dir.y) (plus finale glow) and set godRaysPass.enabled = (opacity > ~0.001) BEFORE composer.render(). At noon the pass is disabled → zero shaft fill; at dawn/dusk it's enabled, costing one extra fullscreen pass only while actually visible (high-tier only, low-sun frames which are the cheaper-fill part of the day).

**Files.**
- `src/engine/createCompositor.ts:343-364 (buildPasses returns a separate godRaysPass; effectPass no longer includes godRays.effect)`
- `src/engine/createCompositor.ts:408-421 (addPass order: render→AO→godRaysPass→merged; toggle godRaysPass.enabled in render())`
- `src/engine/createCompositor.ts dispose (composer.dispose covers the extra pass)`
- `src/engine/createCompositor.test.ts (pure: assert enabled toggles with sun Y)`

**Steps.**
1. In buildPasses, when high tier, create godRaysPass=new EffectPass(camera, godRays.effect) and drop godRays.effect from the merged effectPass.
2. Return godRaysPass; addPass it between aoPass and effectPass in createBloomCompositor.
3. In render(), compute the god-rays opacity (reuse godRays.update's value) and set godRaysPass.enabled = opacity>0.001 before composer.render().
4. Keep godRays.update writing the effect's own blend opacity for the ramp within the enabled range.
5. Add a headless test asserting a pure helper (e.g. godRaysEnabledForSun(dirY,glow)) is false at noon (dirY high) and true at low sun.

**Acceptance.** createCompositor.test.ts: godRaysEnabledForSun(1,0)===false and godRaysEnabledForSun(0.05,0)===true (and any glow>0 forces true). Observable via measure-frame-cost.mjs high at noon vs dawn: noon shows one fewer fullscreen pass than dawn (no god-rays raymarch), and shafts still render at dawn/dusk tracking the sun.

**Risk.** When enabled, god rays is now a SEPARATE fullscreen pass instead of merged — a small extra blit at dawn/dusk (high tier only, low-fill time of day) vs zero at noon; net win since most of the day is midday. Preserve pass order so bloom still catches shafts. GodRaysEffect must NOT also live in the merged pass (avoid double render/double dispose). No change to low/medium (god rays high-only).

**Cross-cutting.** Same composited-tier fill reclamation as findings 3, 6, 8; the freed noon fill also widens finding 3's high-tier headroom.

### 9. [polish] antialias:true allocates an MSAA backbuffer that is unused on the composited (medium/high) tiers
_Effort: S_

**Root cause.** createRenderer (src/engine/createRenderer.ts:25-29) always builds WebGLRenderer with antialias: config.antialias ?? true, and GameCanvas (src/engine/GameCanvas.tsx:163-167) passes no antialias, so it defaults true on every tier. On medium/high the scene renders into the EffectComposer's own HalfFloat targets and SMAAEffect (createCompositor.ts:316) does the AA; the multisampled default framebuffer is only touched by the final present, where MSAA adds nothing — so an MSAA backbuffer (extra GPU memory + a resolve on present) is allocated for nothing on the tiers with the tightest fill budget.

**Solution.** Pass antialias:false whenever a compositor will be built. GameCanvas already knows quality.bloom (the compositor gate) at renderer-construction time — pass antialias: !quality.bloom into createRenderer. Low (bloom:false, no compositor) keeps hardware MSAA; medium/high get antialias:false and rely on SMAA. The only visible gap is the brief window on medium/high where bare frames render before the postfx chunk attaches — those few frames are un-antialiased, an acceptable, momentary trade already accepted for progressive enhancement.

**Files.**
- `src/engine/GameCanvas.tsx:163-167 (add antialias: !quality.bloom to createRenderer config)`
- `src/engine/createRenderer.ts:24-29 (no change needed; config.antialias already honored)`
- `a GameCanvas/renderer-config test asserting the derived antialias value`

**Steps.**
1. In GameCanvas's createRenderer call, add antialias: !quality.bloom.
2. Confirm createRenderer forwards it (it already does at line 27).
3. Add a small unit that computes the intended antialias flag from a QualityConfig (pure helper deriveAntialias(quality)=!quality.bloom) and assert low=true, medium/high=false — keeps the logic headless-testable without WebGL.
4. Manually verify medium/high still look antialiased once the compositor attaches (SMAA active).

**Acceptance.** Unit: deriveAntialias(QUALITY_TIERS.low)===true, deriveAntialias(QUALITY_TIERS.medium/high)===false. Observable: medium/high edges stay smooth (SMAA) after compositor attach; GPU memory for the default framebuffer drops (no MSAA resolve) — spot-check in a real session.

**Risk.** During the pre-attach window medium/high show aliased edges for a few frames; if the postfx chunk fails to load entirely (the documented degrade path) the scene stays non-AA — acceptable but note it. No draw/triangle change; pure fill/memory win on the tightest tiers.

**Cross-cutting.** Same 'stop paying for composited-tier fill you don't use' theme as findings 1, 3, 6, 9.

---

## Graphics & Rendering  
_8 solutions_

### 1. [MAJOR] Shoreline and river foam edge is a hard geometric zigzag sawtooth
_Effort: M_

**Root cause.** Foam is `1 - smoothstep(uFoamStart, uFoamEnd, depth)` where `depth = uSeaLevel - groundHeight` and `groundHeight` is sampled from the baked ground-height DataTexture (waterPatch.ts:294-296, foamBlock:327/329). That texture is 128² with `NearestFilter` + no mipmaps (groundHeightTexture.ts:60-61), so the depth field the smoothstep runs against is a piecewise-constant ~3u block grid that also snaps to the 2u/vertex terrain triangulation — the foam contour follows those steps as a regular sawtooth. The detail-tier breakup (`FOAM_BREAKUP_STRENGTH = 0.4`, waterSurface.ts:490) shifts both edges by a single ripple.x scalar (waterPatch.ts:326) — a uniform 1D nudge, not an organic 2D warp, so it cannot hide the underlying stair pattern.

**Solution.** Three layers, cheapest first. (a) Switch the ground-height texture to `LinearFilter` (groundHeightTexture.ts:60-61) — this bilinearly interpolates the depth field so the foam contour and the depth-absorption bands stop reading as ~3u blocks. Safe because this texture drives ONLY shader visuals; gameplay depth (waterZones/waterDepthAt) reads terrain.heightAt directly, not this texture. This is the single biggest win and one line. (b) Replace the 1D breakup with a 2D domain warp: raise `FOAM_BREAKUP_STRENGTH` to ~0.7 and jitter the sampled foam coordinate by BOTH ripple samples on both axes — compute a warp `vec2 foamWarp = (micro1 + micro2) * FOAM_BREAKUP_STRENGTH` (micro1/micro2 already computed in detailNormalBody) and offset the groundUV used for the foam depth read by `foamWarp * (uGroundExtent-relative scale)`, so the edge meanders organically. (c) Optional surf: modulate foam intensity by a scrolling analytic noise band (reuse streamLane-style hash) so the band has internal texture rather than a clean gradient.

**Files.**
- `src/world/groundHeightTexture.ts (magFilter/minFilter Nearest→Linear)`
- `src/world/waterPatch.ts (foamBlock: warp the foam-depth UV with the 2D ripple warp; bump detail cache key)`
- `src/world/waterSurface.ts (FOAM_BREAKUP_STRENGTH 0.4→~0.7)`
- `src/world/boundaries.textures.test.ts or groundHeightTexture.test.ts (assert LinearFilter)`
- `src/world/waterPatch.test.ts (cache-key + foam-warp coverage)`

**Steps.**
1. Change groundHeightTexture.ts filters to THREE.LinearFilter (both min and mag).
2. Raise FOAM_BREAKUP_STRENGTH in waterSurface.ts and add a 2D warp of the foam depth-sample coordinate in waterPatch.ts foamBlock using the existing micro1/micro2 slope (no extra texture fetch).
3. Bump the detail cache key to -detail-v3 (shared with finding 1's bump; do these together).
4. Add/adjust tests: LinearFilter assertion; foam warp present in detail fragment.
5. Build and visually confirm from the aerial river vantage that the bank foam is a meandering surf line, not triangular teeth.

**Acceptance.** Vitest: groundHeightTexture.test.ts asserts texture.minFilter===THREE.LinearFilter && magFilter===LinearFilter; waterPatch.test.ts asserts the foam depth read is offset by a 2D warp term in the detail variant. Observable: aerial/top-down view of the river (noon-aerial) shows an organic foam edge with no regular sawtooth; shoreline foam meanders.

**Risk.** LinearFilter slightly softens the depth-absorption tone transition too (a benefit here). No draw/triangle change; the warp adds only arithmetic (micro1/micro2 already sampled). Cache-key bump mandatory. Watch that the warp amplitude doesn't push foam onto dry land — clamp depth read to >=0.

**Cross-cutting.** The LinearFilter change (a) is the SAME fix required by 'Low-tier river/shore water mask edge is blocky and stair-stepped from above' — that finding's cited co-cause is this exact 128² NearestFilter texture. One filter change resolves the mask-band blockiness for all tiers; do it once here and reference it in finding 8.

### 2. [MAJOR] Terrain planar-XZ UV stretches ground textures into vertical smears on riverbanks, the waterfall gorge and steep slopes
_Effort: L_

**Root cause.** The splat samples both albedo and normal at a pure world-XZ planar UV: `vWorldXZ = (modelMatrix*position).xz` (terrainMaterialPatch.ts:68) and `uvSplat = vWorldXZ / TERRAIN_TILE_SIZE` (:109, in ALBEDO_BODY:107-116 and NORMAL_BODY:118-130). On a near-vertical face the XZ coordinate is nearly constant along the height axis, so one texel is stretched over the whole vertical span → long vertical smears reading as green mossy curtains on gorge walls, river cliffs and steep slopes.

**Solution.** Replace the single XZ projection with a triplanar (or the cheaper IQ biplanar) blend so vertical faces get correct texel density from the XY/YZ planes. Add a `varying vec3 vWorldPos` and `varying vec3 vWorldNormal` (world normal = normalize(mat3(modelMatrix)*objectNormal), computed in the vertex stage). In the fragment, compute blend weights `vec3 w = pow(abs(vWorldNormal), vec3(4.0)); w /= (w.x+w.y+w.z);` and for each of the 4 splat textures sample three planes — `texXZ = tex(uv=vWorldPos.xz/T)`, `texXY = tex(vWorldPos.xy/T)`, `texYZ = tex(vWorldPos.zy/T)` — combined as `w.y*texXZ + w.z*texXY + w.x*texYZ`, then apply the existing splat-weight blend across the 4 materials. For normal maps use the whiteout triplanar normal blend (swizzle each plane's tangent normal into world space and sum by weight) so the perturbation is correct on walls too. Fill-rate control: (i) prefer biplanar (sample only the two dominant axes → 2x cost, not 3x), and/or (ii) wrap the vertical planes in a coherent branch `if (w.y < 0.985)` so the majority-flat terrain fragments pay the single XZ sample and only slopes pay extra. Gate the full triplanar to high tier (add a `terrainTriplanar` bool to QualityConfig defaulting on for high, off/biplanar for medium) if a medium-tier measurement shows fill-rate stress.

**Files.**
- `src/world/terrainMaterialPatch.ts (VERTEX_DECL add vWorldPos/vWorldNormal + their vertex bodies; ALBEDO_BODY/NORMAL_BODY triplanar/biplanar; cache key terrain-full-v1→v2)`
- `src/perf/quality.ts (optional new terrainTriplanar knob if gating medium down to biplanar)`
- `src/world/terrainMaterialPatch.test.ts (assert the three-plane sampling and new varyings)`
- `scripts/measure-frame-cost.mjs (used to measure, no edit)`

**Steps.**
1. Add vWorldPos (vec3) and vWorldNormal varyings to terrainMaterialPatch.ts vertex decl/bodies (world normal via mat3(modelMatrix)*objectNormal, normalized in fragment).
2. Rewrite ALBEDO_BODY and NORMAL_BODY to sample per-plane and blend by pow(abs(normal),4) weights; use the whiteout normal-blend for the tangent normals.
3. Start with biplanar (2 dominant axes) + a coherent flat-ground branch to bound cost; bump cache key to terrain-full-v2.
4. Measure medium and high with scripts/measure-frame-cost.mjs at the camp-vista (max) vantage; if medium regresses fill-rate, gate full triplanar behind a high-only terrainTriplanar knob and keep biplanar on medium.
5. Update terrainMaterialPatch.test.ts for the new varyings/samples and cache key; run npm test + npm run build.
6. Verify gorge/riverbank walls now show correct rock texel density, not vertical green smears.

**Acceptance.** Vitest: terrainMaterialPatch.test.ts asserts vWorldPos/vWorldNormal varyings exist, that albedo/normal bodies sample three (or two, for biplanar) plane projections, and cache key is terrain-full-v2. Observable: in a high preview at the waterfall gorge (noon-waterfall2/3) the canyon walls read as rock with even texel density; no vertical smearing on the river cliff.

**Risk.** Fill-rate is the constraint (0 triangle/draw impact — still one terrain mesh, one material). Triplanar triples the 8 samples worst-case; biplanar + coherent branch keeps flat ground (the majority) at ~1x. MUST measure on medium against the mobile fill budget; gate to high if needed. Cache-key bump mandatory. Watch tangent-frame correctness for normals on walls.

**Cross-cutting.** None directly, but it shares the 'patch the one MeshStandardMaterial in place, fill-rate-only, cache-key-bump' discipline with the water findings; sequence after the water work so only one shader-recompile review pass is needed per area.

### 3. [MAJOR] Water ripple-normal tiles at a 5-unit repeat with no distance fade; all open water reads as a woven grid
_Effort: M_

**Root cause.** Two coupled causes. (1) The base ripple repeat is tiny: `RIPPLE_TILE_1 = 5`, `RIPPLE_TILE_2 = RIPPLE_TILE_1/2.7 ≈ 1.85` (waterSurface.ts:323-326). Two near-harmonic sub-6u repeats produce a fixed cross-hatch/basketweave that never breaks over a hundreds-of-units sheet. (2) The detail-normal perturbation is applied at full strength at every distance: `microGrad = (micro1+micro2)*RIPPLE_NORMAL_STRENGTH` then `normal = normalize(normal + faceDirection*(normalMatrix*vec3(-microGrad.x,0,-microGrad.y)))` (waterPatch.ts:281-282). With no attenuation, per-pixel high-frequency normal variation compresses below one texel/pixel toward the horizon → moiré/shimmer feeding the specular BRDF.

**Solution.** Raise the base tile and add a real distance fade on the perturbation, keeping the two-sample fill-rate cost unchanged. (a) In waterSurface.ts set `RIPPLE_TILE_1 = 18` (keep `RIPPLE_TILE_2 = RIPPLE_TILE_1/2.7 ≈ 6.7`) so the weave stretches to a natural macro scale; re-derive RIPPLE_SPEED_1/2 automatically (they divide by WRAP_PERIOD, unaffected by tile). (b) Add exported `RIPPLE_FADE_START = 40`, `RIPPLE_FADE_END = 160` and a pure `rippleDistanceFade(dist)` = `1 - smoothstep(START,END,dist)` (unit-testable). (c) In waterPatch.ts detailNormalBody multiply `microGrad` by `rippleFade`, computed from `length(vViewPosition)` (already in scope): `float rippleFade = 1.0 - smoothstep(RIPPLE_FADE_START, RIPPLE_FADE_END, length(vViewPosition)); microGrad *= rippleFade;`. This drives the perturbation smoothly to zero before it aliases, so the horizon relaxes to the smooth analytic wave normal. (d) To break the residual repeat without a third fetch, offset sample 2's heading further from sample 1 (already (0.8,0.6) vs (1,0)) and rely on the larger disparate tiles; only if still gridded, add ONE low-strength large-tile (~55u) reuse of the same sampler as a third octave (an extra texture fetch — gate to high only).

**Files.**
- `src/world/waterSurface.ts (RIPPLE_TILE_1, new RIPPLE_FADE_START/END consts, new rippleDistanceFade() + its GLSL emitter or inline in rippleGlsl)`
- `src/world/waterPatch.ts (detailNormalBody: apply rippleFade; bump detail customProgramCacheKey to -detail-v3)`
- `src/world/waterSurface.test.ts (assert new tile/fade constants and rippleDistanceFade monotonic 1→0)`
- `src/world/waterPatch.test.ts (update the regression-locked detail cache key string)`

**Steps.**
1. Edit waterSurface.ts: RIPPLE_TILE_1 5→18; add RIPPLE_FADE_START/END exports and a pure rippleDistanceFade(dist) helper mirroring smoothstep semantics.
2. Add the fade term to waterPatch.ts detailNormalBody, reading length(vViewPosition); declare the two fade consts in fragDecl from glslFloat().
3. Bump the detail cache key wantDetail branch (waterPatch.ts:421) from -detail-v2 to -detail-v3 so the recompiled program is not served a stale cached variant.
4. Update waterPatch.test.ts's pinned detail cache-key string and add a coverage assert that detailNormalBody contains the fade multiply.
5. Run npm test, then npm run build; verify in a medium/high preview at the sea-horizon vantage that the weave is gone near the horizon.

**Acceptance.** Vitest: extend waterSurface.test.ts to assert RIPPLE_TILE_1===18 and rippleDistanceFade(0)===1, rippleDistanceFade(200)===0, monotonic between; waterPatch.test.ts asserts the fade smoothstep appears in the detail fragment and the cache key is -detail-v3. Observable: in a high-tier preview looking out to open sea (noon-sea-horizon vantage), the horizon no longer shimmers and no basketweave cross-hatch is visible past ~150u.

**Risk.** Fill-rate neutral if kept to two samples (only a scalar multiply added); the optional third octave adds one texture fetch and MUST be high-only. Cache-key bump is mandatory or the GPU serves the old program. Regressions: verify the near-field glitter still reads (fade start at 40u keeps foreground sparkle). No triangle/draw-call change.

**Cross-cutting.** The distance fade is the shared mechanism behind finding 'High-tier water sun-glint is an intense concentrated white sparkle blob' (the un-faded ripple normal is that finding's cited co-cause) and contributes to 'Open sea... all render the same bright turquoise' (the tiling weave is the visual that reads as 'flat tiled sheet'). Do this fix first; the other two build on it.

### 4. [minor] High-tier water sun-glint is an intense concentrated white sparkle blob
_Effort: S_

**Root cause.** The finding's cited evidence is partly STALE: WATER_ROUGHNESS_DETAIL is now 0.28 (boundaries.ts:61, already raised from 0.12 by the 2026-07-19 jungle-water fix) and WATER_ENV_INTENSITY_DETAIL 0.35 already dims the sky reflection. The remaining hot-cluster comes from the un-attenuated ripple-normal perturbation (RIPPLE_NORMAL_STRENGTH = 0.4, waterPatch.ts:98) driving tight per-pixel specular from the two small-tile samples (waterSurface.ts:323-326) — the same un-faded normal cited in finding 1. A tight normal + low roughness concentrates the specular lobe into a dense sparkle that blooms.

**Solution.** Verify the current build first (roughness is already 0.28, not 0.12). Then couple the remaining fix to finding 1's distance fade: with the ripple perturbation faded toward the horizon, the glint spreads into a believable streak instead of a hot cluster. If a post-fade preview still shows a hot blob on the sun side, (a) reduce RIPPLE_NORMAL_STRENGTH from 0.4 to ~0.28 so the micro-normal lobe is softer, and/or (b) nudge WATER_ROUGHNESS_DETAIL from 0.28 to ~0.30-0.32. These are plain material/shader scalars — no recompile risk for roughness, and the ripple strength change rides finding 1's cache-key bump.

**Files.**
- `src/world/waterPatch.ts (RIPPLE_NORMAL_STRENGTH, if reduced — rides finding 1's -detail-v3 cache key)`
- `src/world/boundaries.ts (WATER_ROUGHNESS_DETAIL, if nudged)`
- `src/world/waterPatch.test.ts / boundaries tests (constant assertions if changed)`

**Steps.**
1. Confirm live values in the build (roughness 0.28, env 0.35 already applied) before changing anything.
2. Apply finding 1's ripple distance fade and re-check the sun-side glint in a high preview.
3. If still hot, lower RIPPLE_NORMAL_STRENGTH toward 0.28 and/or raise WATER_ROUGHNESS_DETAIL toward 0.30-0.32.
4. Update any pinned constant tests; run npm test + build; verify the glint reads as a spread streak.

**Acceptance.** Observable: in a high preview on the sun side (noon-riverMid, dawn-sun-sea glint path) the specular reads as a soft spread streak/glitter, not a dense blown-out white cluster. Vitest: if constants change, assert their new values in the relevant test.

**Risk.** Minimal — scalar tuning only, no draw/triangle/fill change of note. Do NOT lower roughness (finding cites 0.12 as the problem; code already fixed that). Depends on finding 1 landing first (shared cache-key bump and the fade that does most of the work).

**Cross-cutting.** This is largely the SAME fix as 'Water ripple-normal tiles... with no distance fade' — the un-faded ripple normal is the shared root cause. Implement finding 1 first; this becomes a small tuning follow-up. The evidence line (0.12 roughness) is stale — record that the jungle-water fix already addressed it.

### 5. [minor] Low-tier procedural foliage reads as flat intersecting green cardboard cards
_Effort: M_

**Root cause.** Low tier never upgrades to GLB (floraDetail 'none'), so it keeps the procedural cross-planes: `makeCrossGeometry` builds exactly two crossed quads (props.ts:531-540); the foliage material is a flat-shaded alpha-cutout of the leaf CanvasTexture (buildFoliageMaterial:656-668); per-instance tint only varies lightness via `offsetHSL(0,0,lightness)` (props.ts:275,371,405) so there is no hue variety. From oblique angles the two-plane structure reads flat. Palms use radial flat fronds (buildPalmFrondCrown:591-609), not cross-planes.

**Solution.** Improve silhouette and colour variety without breaching low's pinned triangle floor. Primary (zero-triangle): (a) enrich `makeLeafTexture` (props.ts:619-647) to draw a softer, denser, edge-feathered alpha blob mask (more blobs, gaussian-ish falloff via radial gradient fill) so the cutout silhouette reads as a leaf cluster from any angle rather than a hard card; (b) add small per-instance HUE variation — change the tint calls to `offsetHSL(h,±0.02, lightness)` with a small hue jitter so crowns aren't a uniform green wall (the finding notes the current h=0,s=0). Optional silhouette upgrade (small triangle cost, must be re-baselined): (c) make the canopy/understory crown a 3-plane 'asterisk' (three quads at 60°) instead of two — one extra quad per instance, still one merged geometry and one instanced draw call, giving a volumetric read from oblique angles. If (c) is taken, deliberately re-baseline the low-tier triangle pin in quality.test.ts and record the new floor in perf-budget.md (it currently pins 156,559).

**Files.**
- `src/world/props.ts (makeLeafTexture blob mask; makeCrossGeometry optional 3-plane; tint offsetHSL hue jitter at :275/:371/:405)`
- `src/world/props.test.ts (cross geometry face count if changed; tint hue variety)`
- `src/perf/quality.test.ts + docs/perf-budget.md (ONLY if the 3-plane option is taken — re-baseline the low triangle floor)`

**Steps.**
1. Enrich makeLeafTexture: more/softer blobs with feathered alpha (radial-gradient fill) for a leaf-cluster silhouette; keep the jsdom null fallback.
2. Add a small hue jitter to the three offsetHSL tint calls so crowns vary in tone.
3. Decide on the 3-plane crown: if included, update makeCrossGeometry and re-baseline the low triangle pin in quality.test.ts and perf-budget.md with a measured number.
4. Run npm test; build and inspect low-tier camp/jungle vantages for improved foliage read.

**Acceptance.** Vitest: props.test.ts asserts the tint path applies non-zero hue variation and (if 3-plane) the crown geometry has the expected face count; quality.test.ts still passes (unchanged, or re-baselined intentionally). Observable: low-tier screenshots (low-jungle, low-camp) show foliage with organic silhouettes and tonal variety, not uniform flat cards.

**Risk.** The texture+tint route is zero budget impact. The 3-plane route raises low's triangle count — low's floor is contractually 'never slower than today' and pinned in quality.test.ts, so it MUST be re-measured and re-baselined deliberately, not silently. Prefer the zero-triangle route unless the volumetric read is judged necessary.

**Cross-cutting.** None — this is low-tier-only and isolated to props.ts. It does not touch the GLB upgrade path (floraUpgrade) used by medium/high.

### 6. [minor] Open sea, lagoon and river all render the same bright turquoise; deep water never darkens
_Effort: M_

**Root cause.** Depth-based absorption drives colour from `depth = uSeaLevel - groundHeight` sampled from the ground-height texture, whose extent is `GROUND_TEXTURE_EXTENT = WORLD.islandRadius` (=200) with ClampToEdge (groundHeightTexture.ts, waterPatch.ts:294-296). Past the island the sampled ground clamps to the edge value, so the entire open sea (the size*3 plane, boundaries.ts:155) sits at one near-constant absorption → a uniform turquoise sheet. Grazing-angle sky specular + fog wash out what depth darkening exists, and the tiling weave (finding 1) reinforces the flat read. DEPTH_ABSORPTION_RATE is already raised to 0.62 (waterSurface.ts:428), so the ramp itself works near shore — the failure is offshore where depth stops varying.

**Solution.** Add a radial deep-water term so water beyond the shore drop resolves to a distinctly darker deep-ocean tone. In waterSurface.ts add `deepWaterByRadius(r)` = `smoothstep(coastRadius, boundaryRadius, r)` (pure, tested) and export a distinct deep-ocean palette endpoint (a darker blue than WATER_DEEP_DETAIL, or reuse it). In waterPatch.ts rampBody, compute `float openSea = smoothstep(COAST_R, BOUNDARY_R, length(vWorldXZ));` (vWorldXZ already a varying) and fold it into the ramp: `waterRamp = clamp(max(max(fresnel, depthAbs), openSea), 0.0, 1.0);` so far-from-island water is pushed to the deep endpoint regardless of the clamped depth texture. Pass WORLD.coastRadius/boundaryRadius as GLSL consts (single-sourced from worldConfig). Optionally bias fog/env slightly lower offshore, but the radial ramp is the core fix.

**Files.**
- `src/world/waterSurface.ts (deepWaterByRadius() + its GLSL emitter; optional deeper open-ocean palette const)`
- `src/world/waterPatch.ts (rampBody: radial openSea term; COAST_R/BOUNDARY_R consts from worldConfig; detail cache-key bump)`
- `src/world/worldConfig.ts (read coastRadius/boundaryRadius — already present)`
- `src/world/waterSurface.test.ts + waterPatch.test.ts`

**Steps.**
1. Add deepWaterByRadius(r) to waterSurface.ts and export the radii-derived GLSL, plus (optional) a darker open-ocean palette endpoint.
2. In waterPatch.ts rampBody, add the radial openSea term folded via max into waterRamp; declare COAST_R/BOUNDARY_R consts from WORLD via glslFloat.
3. Bump the detail cache key (share finding 1/2's -detail-v3 bump).
4. Add tests: deepWaterByRadius(150)≈0, deepWaterByRadius(190)≈1; waterPatch detail fragment contains the radial term.
5. Build and compare open-sea vs lagoon in a high preview — open sea should read distinctly darker.

**Acceptance.** Vitest: waterSurface.test.ts asserts deepWaterByRadius crosses 0→1 between coastRadius and boundaryRadius; waterPatch.test.ts asserts the radial darkening term is present in the detail ramp. Observable: high preview (noon-sea-horizon) shows the open sea as a distinctly darker deep-blue than the lagoon (noon-lagoon), not identical turquoise.

**Risk.** Fill-rate: one extra length()+smoothstep in the fragment, negligible. Cache-key bump mandatory. Watch that the transition band (coast→boundary) doesn't create a visible ring — tune the smoothstep edges against real screenshots. No draw/triangle change.

**Cross-cutting.** Partially shares root cause with finding 1 (the tiling weave is what makes the flat sheet read as 'fake turquoise') and depends on finding 2's LinearFilter for a smooth depth field. Bundle the -detail-v3 cache-key bump across findings 1, 2 and 7 into a single water-shader slice.

### 7. [minor] Waterfall curtain is a flat hard-edged scrolling plane in a very dark gorge
_Effort: M_

**Root cause.** The curtain is a single rectangular PlaneGeometry(FALL_WIDTH, FALL_TOP, 4, 8) bowed outward at the base (waterfall.ts:115-124); its side edges are straight vertical lines and its base terminates abruptly at the pool. The supporting elements (crest lip :139, rock cap :151, two splash discs :159-183, mist puffs) already give it body, so the real weakness is the rectangular silhouette and the hard base seam, not the effect being lost in darkness.

**Solution.** Break the silhouette and soften the base, all inside the single curtain mesh so the ≤6-draw budget holds. (a) In the existing bow loop (waterfall.ts:117-124), taper and irregularize the sides: scale each row's x by a slight top-narrow/base-widen factor plus a small per-row `hash2`-driven jitter so the outline is an irregular sheet, not a rectangle. (b) Add 1-2 extra thin strand quads MERGED into the same curtain BufferGeometry (via mergeGeometries) at small x offsets and depth offsets so overlapping strands read as volume — still ONE mesh/one draw call. (c) Widen the base transition: raise the larger splash disc radius (waterfall.ts:161, 4.2→~5.5) and add a low soft foam apron ring at the curtain foot so water visibly meets the pool rather than clipping. (d) Ambient: the finding notes the dark gorge actually helps contrast, so skip lifting ambient unless a preview shows the base too dark.

**Files.**
- `src/world/waterfall.ts (buildWaterfall: curtain geo taper/jitter + merged strands; splash disc radius/apron)`
- `src/world/waterfall.test.ts (curtain vertex count / strand merge; splash radius)`

**Steps.**
1. Edit the curtain bow loop to taper x by row and add a small hash2 per-row jitter for an irregular edge.
2. Merge 1-2 offset strand planes into the curtain geometry (mergeGeometries) to keep one draw call; keep them within the existing curtain material.
3. Widen the base splash disc and add a soft foam apron mesh at the foot (or reuse a splash disc scaled/positioned at the base).
4. Update waterfall.test.ts for the new geometry shape; run npm test + build; verify front-on and gorge views.

**Acceptance.** Vitest: waterfall.test.ts asserts the curtain geometry has the merged-strand vertex count (still one mesh) and the widened splash radius constant. Observable: in a high preview at the falls (noon-waterfall2), the curtain has an irregular tapered silhouette with visible overlapping strands and a soft base where it meets the pool, and total waterfall draw calls remain ≤6.

**Risk.** Draw-call budget: the waterfall module doc caps itself at ≤6 draws and the falls is occluded/culled from the zero-headroom spawn vantage — keep strands MERGED into the curtain mesh so no new draw call is added. Triangle add is tiny and local to a culled group. minor severity.

**Cross-cutting.** None — self-contained in the waterfall module (living-water epic). Does not interact with the open-water findings.

### 8. [polish] Low-tier river/shore water mask edge is blocky and stair-stepped from above
_Effort: S_

**Root cause.** Two contributors, both cited: (1) the terrain heightfield is a fixed 260-segment mesh over size 520 (worldConfig.ts:37,40) ≈ 2u/vertex where it intersects the flat water plane, so the geometric waterline follows the coarse triangulation; (2) the foam/depth-absorption bands are driven by the 128² NearestFilter ground-height texture (groundHeightTexture.ts:60-61) producing ~3u blocks. This reads on ALL tiers from elevated views (the water-mesh segs=1 on low is NOT the cause); it is rarely seen in normal first-person play, hence polish.

**Solution.** Fix the cheap, high-impact contributor and stop there. Switch the ground-height texture to LinearFilter (groundHeightTexture.ts:60-61) — this is the SAME change finding 2 needs and it smooths the ~3u foam/depth mask bands across every tier, removing the blocky colour stair-step at the waterline. The geometric-triangulation edge (2u/vertex) is intrinsic to the terrain mesh; raising WORLD.segments near water would cost triangles against a budget with ~0 headroom on high, and the artifact is rarely visible in first-person, so do NOT pursue mesh refinement. Optionally widen the shore foam band slightly so the blended band masks the geometric step, but the LinearFilter change alone resolves the reported blockiness of the mask.

**Files.**
- `src/world/groundHeightTexture.ts (Nearest→Linear filters — shared with finding 2)`
- `src/world/groundHeightTexture.test.ts (assert LinearFilter)`

**Steps.**
1. Change groundHeightTexture.ts min/mag filters to THREE.LinearFilter (single change, shared with finding 2).
2. Add/confirm a test asserting the filter.
3. Build and check the low-tier aerial river edge (low-aerial): the mask band should be smooth, not stair-stepped.
4. Do NOT change WORLD.segments — record that the residual geometric edge is accepted polish given the triangle budget and first-person rarity.

**Acceptance.** Vitest: groundHeightTexture.test.ts asserts minFilter===LinearFilter && magFilter===LinearFilter. Observable: low-aerial view shows a smoothly-blended blue waterline band rather than ~3u colour blocks; residual geometric triangulation edge is accepted and documented.

**Risk.** None meaningful — bilinear filtering of a 128² data texture is free. Gameplay depth is unaffected (uses heightAt, not this texture). The geometric edge remains by design; note it in the run log so it isn't re-reported.

**Cross-cutting.** This is the SAME LinearFilter change as finding 2 ('Shoreline and river foam edge is a hard geometric zigzag'). Implement once in groundHeightTexture.ts; it resolves both the foam-band blockiness (finding 2's texture co-cause) and this mask-edge polish item. Do not double-count the effort.

---

## Game Feel & Juice  
_12 solutions_

### 1. [MAJOR] Taking damage has no visual feedback at all
_Effort: M_

**Root cause.** SurvivalSystem.hurt() (src/survival/SurvivalSystem.ts:111-120) and the update() drain loop (lines 196-208) only mutate this.health and push it into the store; nothing screen-space reacts. The store (src/survival/survivalStore.ts:55-87) carries only rounded values, no event. The compositor's VignetteEffect is finale-only (src/engine/createCompositor.ts:123, vignetteDarknessForFinale) and takes no health input, and fpCamera.ts writes camera orientation straight from explorer yaw/pitch (fpCamera.ts:40-41) with no impulse channel. So a 45-HP jaguar pounce produces only AudioSystem.hurtThud (AudioSystem.ts:323).

**Solution.** Two cheap, zero-draw-call responses driven off the same health-drop edge the audio already detects (HURT_DROP_THRESHOLD=5, AudioSystem.ts:130,323). (1) A DOM DamageVignette overlay: a fixed full-screen div with a red inset box-shadow / radial-gradient edge, mounted always, whose opacity is pulsed by a CSS keyframe fired when React detects health fell by >=5. Scale the peak opacity by the drop magnitude (clamp(drop/45, 0.25, 1) * 0.6). (2) A camera kick in FirstPersonCameraSystem: inject the survival store as an optional HealthSource, track lastHealth, and on a drop add a decaying pitch+roll impulse (e.g. kick = drop/45 * 0.06 rad, decayed each frame by damp(kick,0,18,dt)) added into the euler before quaternion.setFromEuler. Both gated by reduced motion (the vignette via the existing data-reduced-motion / prefers-reduced-motion CSS gates, showing a brief static tint instead of a pulse; the camera kick suppressed entirely). Directional indicator is out of scope — hurt() carries no attacker vector.

**Files.**
- `src/ui/DamageVignette.tsx (new) — subscribes survivalStore, tracks prev health in a ref, toggles a keyed flash`
- `src/tokens.css — .damage-vignette + @keyframes damage-flash + both reduced-motion gates`
- `src/engine/GameCanvas.tsx — mount <DamageVignette survival={game.survival.store}/> inside the game.survival block (near UnderwaterOverlay, line 476)`
- `src/player/fpCamera.ts — FirstPersonCameraSystem: add optional HealthSource ctor param, lastHealth + kick state, apply decaying impulse in update()`
- `src/buildGame.ts — pass survivalStore into FirstPersonCameraSystem construction`

**Steps.**
1. Add a HealthSource interface {getSnapshot():{health:number; alive:boolean}} to fpCamera.ts and an optional constructor arg; capture lastHealth at construction.
2. In fpCamera update(): read health; if health < lastHealth - 5 (and not a respawn rise) set kick = Math.min(1, (lastHealth-health)/45); decay kick each frame with THREE.MathUtils.damp; add kick*0.06 to euler.x and a small roll to a z-offset; zero it under reducedMotion.
3. Wire the survival store into the camera system in buildGame.ts.
4. Create DamageVignette.tsx: useSyncExternalStore on survival; useRef prevHealth; on render compute drop, when drop>=5 bump a state counter used as the element key so the CSS animation restarts, and set a CSS var --dmg for peak opacity.
5. Add .damage-vignette (position:fixed; inset:0; pointer-events:none; z-index between underwater(8) and HUD(12)) with an inset red box-shadow, and @keyframes damage-flash from opacity var(--dmg)->0; add both reduced-motion gates that swap the pulse for a 150ms static tint.
6. Mount it in GameCanvas.

**Acceptance.** Vitest: extend src/player/fpCamera.test.ts to feed a fake HealthSource that drops 100->55, advance one frame, assert camera.rotation.x is offset from the plain euler value, then advance ~0.5s and assert it decays back; assert zero offset when reducedMotion=true. New src/ui/DamageVignette.test.tsx (mirror UnderwaterOverlay.test.tsx): drop health via a fake store and assert the element re-keys / carries the --dmg var scaled by amount, and that it is present at reduced motion without the animation class. Observable: a jaguar hit flashes a red edge and kicks the view.

**Risk.** No triangle/draw/pass cost — DOM overlay + one extra euler write per frame (negligible CPU, no projection change). Watch: don't fire the flash on the respawn refill (health rises) or on gradual starve drain (deltas <5); reuse the exact HURT_DROP_THRESHOLD so audio and visual agree. Camera kick must not fight the head-bob (add, don't overwrite).

**Cross-cutting.** Same DamageVignette component should own finding 'No critical-health screen state' — the transient hit flash and the sustained low-health tint are two states of one overlay. Build it once here with both behaviours.

### 2. [minor] Death arrives with no transition
_Effort: S_

**Root cause.** DeathOverlay.tsx:27-42 conditionally renders on !s.alive with no entry animation, and .death-overlay/.death-overlay__card (tokens.css:474-501) carry none (unlike .menu's overlay-rise). The design spec (lines 83-84) explicitly calls for death -> fade to black before the message; the deathSting audio (AudioSystem.ts:324) fires but the screen just pops.

**Solution.** Add a two-stage CSS entry to DeathOverlay honouring the spec's 'fade to black': (1) the overlay background fades from transparent to near-opaque black over ~0.6s (a @keyframes on .death-overlay), optionally with a filter:grayscale ramp applied to the container so the world desaturates as it darkens; (2) the card fades/rises in after a short delay (reuse the overlay-rise pattern the menu already has). Because the overlay only mounts when !alive, the animation runs on mount automatically. Reduced motion: instant (animation:none) — the card appears immediately on a solid backdrop, the existing behaviour, which is the safe fallback.

**Files.**
- `src/tokens.css — @keyframes death-fade (bg alpha 0->0.82) + card entry, both reduced-motion gates`
- `src/ui/DeathOverlay.tsx — no logic change (add a class hook if the card needs a delayed animation); optionally add a class to the game container for the grayscale ramp`

**Steps.**
1. Add @keyframes death-fade animating .death-overlay background from rgba(5,8,6,0) to rgba(5,8,6,0.82) over ~0.6s and apply it.
2. Add a delayed fade/rise to .death-overlay__card (animation-delay ~0.4s) reusing the overlay-rise easing.
3. Optionally add a .game-canvas-container[data-dying] grayscale/darken transition toggled from DeathOverlay via a prop or effect for the fade-to-black-of-the-world feel.
4. Add both reduced-motion gates setting animation:none (instant card on solid bg).
5. Confirm focus-to-button (DeathOverlay.tsx:23-25) still fires after the animation (it fires on mount, unaffected).

**Acceptance.** Vitest can assert the overlay mounts on !alive (existing pattern) and that under reduced motion no animation class is applied; the visual fade itself is verified in the running build / Playwright death screenshot. Observable: on death the screen fades to black then the card rises, matching design lines 83-84.

**Risk.** Zero draw cost (DOM/CSS; grayscale filter on the container is a compositor filter, cheap and only during the death moment). Watch: don't delay the button focus long enough to trap a keyboard user; keep the reduced-motion path instant. The world keeps rendering behind (session paused) so a grayscale filter on the canvas element is acceptable — confirm it doesn't hurt the paused frame.

**Cross-cutting.** The deathSting already exists, so this is the visual half of one moment; pairs naturally with the damage flash (finding 1) if a killing blow also flashes — order them so the flash reads before the fade.

### 3. [minor] Head-bob cadence is far faster than a stride and decoupled from footstep audio
_Effort: M_

**Root cause.** fpCamera.ts:13 BOB_FREQ=1.6 with phase=bobDistance*BOB_FREQ*PI and bobY=abs(sin(phase)) (lines 52-54) dips every 1/1.6=0.625 m -> ~6.7 dips/s at walk, and only ever raises the eye. Footsteps run on an independent wall-clock timer (AudioSystem.ts:184,290-294) at FOOTSTEP_WALK_INTERVAL=0.46 (~2.17/s) / SPRINT 0.3, so the audible step and the visual dip never share a clock and never align.

**Solution.** Make stride a distance clock shared by both systems. (1) Introduce a single STRIDE_METERS constant (~1.9 m, = walkSpeed*0.46) and set BOB_FREQ = 1/STRIDE_METERS (~0.53) so exactly one dip per stride, and flip the bob so the eye DIPS on footfall (baseline + (abs(sin)-1)*amp, or bobY = -abs(sin)*amp) instead of only rising. (2) Convert AudioSystem footsteps from a time timer to a distance accumulator: add speed*dt to a strideDistance accumulator and fire engine.footstep() each time it crosses STRIDE_METERS, resetting the remainder — cadence then tracks speed automatically (sprint fires proportionally faster with no separate SPRINT interval) and matches the bob's dip spacing exactly. Choose the accumulator's initial phase so the fire lands at the bob's low point. Keep FOOTSTEP_MIN_SPEED gate.

**Files.**
- `src/player/strideClock.ts (new, optional) — export STRIDE_METERS + bobPhase helper shared by camera and audio`
- `src/player/fpCamera.ts — BOB_FREQ derived from STRIDE_METERS; dip-on-footfall sign`
- `src/audio/AudioSystem.ts — replace footstepTimer time-countdown with a distance accumulator keyed to STRIDE_METERS`
- `src/player/fpCamera.test.ts, src/audio/AudioSystem.test.ts — coverage`

**Steps.**
1. Add STRIDE_METERS = 1.9 (documented as walkSpeed*FOOTSTEP_WALK_INTERVAL) in a shared module.
2. fpCamera: set BOB_FREQ = 1/(STRIDE_METERS) so one abs(sin) lobe per stride; change bob so the low point sits at footfall (subtract instead of add, keeping eye at/under base).
3. AudioSystem: replace footstepTimer with strideDistance += state.speed*ctx.dt while speed>FOOTSTEP_MIN_SPEED; while strideDistance>=STRIDE_METERS: footstep(); strideDistance-=STRIDE_METERS. Reset to a phase offset when movement stops so the first step after moving fires promptly.
4. Delete FOOTSTEP_WALK_INTERVAL/FOOTSTEP_SPRINT_INTERVAL (grep confirms only used here) — cadence now emerges from distance.
5. Retune STRIDE_METERS by ear so it still feels brisk enough.

**Acceptance.** Vitest AudioSystem.test.ts: drive the fake explorer at speed=4.2 for 1 s of dt and assert ~2 footstep() calls (was 2.17), then at 7.0 assert the rate scales up ~1.67x automatically (was a fixed 0.3 interval); assert no step below FOOTSTEP_MIN_SPEED. fpCamera.test.ts: assert bob completes one full lobe per STRIDE_METERS travelled and that the extremum is a dip (eye <= base) at multiples of STRIDE_METERS. Observable: the step you hear lands as the view dips.

**Risk.** Zero rendering cost. Behaviour change: footstep count per second drops noticeably (6.7->~2 dips) — verify it doesn't feel sluggish; STRIDE_METERS is the single tuning knob. Watch the wading/mode paths (no bob while swimming, fpCamera.ts:50) stay unaffected. Sharing a constant across player+audio is fine; avoid importing THREE into audio.

**Cross-cutting.** This is the unified fix for both the visual-bob complaint and the audio-decoupling complaint — one stride clock resolves both; do not fix them separately.

### 4. [minor] No critical-health screen state — the only low cue is a bar flash
_Effort: S_

**Root cause.** SurvivalMeters.tsx:16 LOW_METER=25 turns the fill red and adds meter-flash, which both reduced-motion gates strip (tokens.css:446-455), leaving only a small bottom-left bar. There is no peripheral/health-driven post-fx: createCompositor.ts:123 vignette is finale-only. A center-focused first-person player misses the corner entirely.

**Solution.** Fold a sustained red edge-vignette into the same DamageVignette overlay from finding 1. Below a danger threshold (health <= 25) ramp a persistent red inset glow whose opacity = smoothstep over (25 -> 0) of health, e.g. opacity 0 at 25 rising to ~0.45 at 0, layered under the transient hit flash. Add an optional slow heartbeat pulse (2-3s ease) that both reduced-motion gates replace with a static-but-clearly-visible tint (keep the sustained glow, drop only the pulse) — the accessible fallback the meter-flash never had.

**Files.**
- `src/ui/DamageVignette.tsx — add a sustained low-health layer keyed on health<=DANGER`
- `src/tokens.css — .damage-vignette--critical sustained style + @keyframes heartbeat + reduced-motion gates keeping the static glow`

**Steps.**
1. In DamageVignette, derive danger = health <= 25 and criticalOpacity from a smoothstep(0..25).
2. Render a second layer (or a CSS var --crit) for the sustained glow, independent of the transient --dmg flash.
3. Add @keyframes heartbeat (opacity oscillates around --crit); under both reduced-motion gates set animation:none but keep the base --crit opacity so the state stays visible.
4. Reuse LOW_METER (export from SurvivalMeters or a shared const) so the vignette threshold and the meter red never diverge.

**Acceptance.** Vitest DamageVignette.test.tsx: set health=10 and assert the critical layer is present with a nonzero --crit; set health=60 and assert it is absent; with reducedMotion=true assert the critical layer still renders (nonzero opacity) but without the heartbeat animation class. Observable: dropping under 25 HP darkens the screen edges red even for reduced-motion users.

**Risk.** Zero draw/triangle cost (DOM). Watch layering z-index so it sits under the HUD (z12) and never blocks pointer events. Keep it subtle enough not to obscure gameplay at 10-25 HP.

**Cross-cutting.** Same component and same file as finding 1 — implement 1 and 4 together as one DamageVignette PR (transient flash + sustained critical tint). Threshold shared with SurvivalMeters.LOW_METER.

### 5. [minor] Sprint has no sense of speed (no FOV kick or motion cue)
_Effort: S_

**Root cause.** The PerspectiveCamera is constructed once at 60deg (GameCanvas.tsx:196) and its .fov is never reassigned anywhere; FirstPersonCameraSystem (fpCamera.ts) only writes position + quaternion, never touches fov/projection. So sprint (explorer.ts:41-42, 4.2->7.0 m/s) changes head-bob amplitude/cadence but never the lens.

**Solution.** Ease camera.fov in FirstPersonCameraSystem toward a sprint target and back on release. Add SPRINT_FOV_BOOST (~6deg) and a damp: targetFov = BASE_FOV + (explorer.state.sprinting ? BOOST : 0); this.fov = damp(this.fov, targetFov, ~6, dt); if it changed beyond an epsilon, write engine.camera.fov and call updateProjectionMatrix(). Read BASE_FOV from the camera at construction (don't hardcode 60 in two places). Fully suppressed under reduced motion (target stays BASE_FOV) since an FOV swell is vestibular motion.

**Files.**
- `src/player/fpCamera.ts — FirstPersonCameraSystem.update(): fov easing block + captured baseFov`
- `src/player/fpCamera.test.ts — coverage`

**Steps.**
1. Capture baseFov = engine.camera.fov (a PerspectiveCamera) in the constructor; store this.fov = baseFov.
2. In update(): compute targetFov (reduced ? baseFov : baseFov + (s.sprinting?SPRINT_FOV_BOOST:0)).
3. Damp this.fov toward targetFov; if Math.abs(delta) > 0.01 assign camera.fov and call (camera as PerspectiveCamera).updateProjectionMatrix().
4. Add SPRINT_FOV_BOOST constant (~6) near BOB_* constants with a doc line tying it to explorer sprintSpeed.

**Acceptance.** Vitest in fpCamera.test.ts: with a fake explorer reporting sprinting=true, advance ~0.5s and assert camera.fov rose above baseFov but stays <= baseFov+BOOST; set sprinting=false, advance, assert it eases back to baseFov; with reducedMotion=true assert fov never leaves baseFov. Observable: sprinting subtly widens the view.

**Risk.** Zero draw/triangle cost; updateProjectionMatrix runs only on the frames fov actually changes (a handful during the ease), not every frame. Watch the reduced-motion gate — this is exactly the kind of motion the setting must kill. Guard the cast: only PerspectiveCamera has fov.

**Cross-cutting.** None — but keep the FOV ease and the damage kick (finding 1) as separate additive contributions to the same camera system so neither clobbers the other.

### 6. [minor] Swimming has no body or stroke presence
_Effort: M_

**Root cause.** HandsSystem (src/player/hands.ts:14) only knows 'idle'|'drink'|'eat'|'dig' and is driven by survival/forage/quest store edges (hands.ts:183-199); it never reads explorer mode, so entering swim (explorer.ts:326, mode==='swim') leaves action 'idle' and the group hidden. explorer.ts:138 confirms no body is added for swimming.

**Solution.** Add a looping 'swim' breaststroke pose to HandsSystem, active while explorer.state.mode==='swim' and no one-shot (drink/eat/dig) is overriding. Inject a lightweight ModeSource (the explorer, read via state.mode, or a getter) into HandsSystem. In handPose add a 'swim' branch: a two-handed forward-reach-and-pull cycle driven by a continuous clock (sin over ~1.4 s), both forearms angled inward — reuse the existing arm geometry (mirror it for a second hand by rendering the same mesh at +/-HAND_X, or accept one visible forearm sweeping). Reduced motion: a static raised reaching pose (the existing reduced idiom, hands.ts:47). Zero new geometry beyond optionally a second instance of the already-built arm mesh (still one merged geometry, negligible tris).

**Files.**
- `src/player/hands.ts — add 'swim' to HandAction, a swim branch in handPose(), a ModeSource, and mode-driven start/stop in update()`
- `src/buildGame.ts — pass the explorer (mode source) into HandsSystem`
- `src/player/hands.test.ts — coverage`

**Steps.**
1. Extend HandAction with 'swim'; add a ModeSource {getSnapshot?}/getter returning explorer.state.mode and inject it.
2. In update(): if mode==='swim' and action isn't a one-shot in progress, start('swim') (a looping action like 'dig'); when mode leaves swim, return to idle. Preserve drink/eat/dig precedence (a drink while swimming still cups).
3. Add the swim branch to handPose: progress = actionT; a breaststroke bell over a ~1.4s period reaching forward then pulling to the sides; reduced -> static reach.
4. Optionally add a second mirrored arm mesh so it reads as two hands (reuse armGeo; mirror via scale.x=-1 on a second child) — keep frustumCulled=false like the existing meshes.
5. Ensure the group hides again on returning to walk with no action.

**Acceptance.** Vitest hands.test.ts (extend the existing pose tests): call handPose('swim', t) and assert the pose is a raised reaching pose that varies with t (and is static when reduced=true); drive the system with a fake mode source flipping to 'swim' and assert action becomes 'swim' and group.visible=true, then flips back to idle/hidden on 'walk'. Observable: swimming shows sweeping forearms.

**Risk.** PERF: reuses the existing HandsSystem draw (already always present, ~60 tris, 1 draw call); a mirrored second arm at most doubles to ~120 tris / still trivial, no new pass. No draw-call growth on high if the second arm shares the group's single mesh/material (or accept one arm). Watch precedence so a mid-swim drink/eat still plays; and don't animate while session.paused (hands.ts:184 already guards).

**Cross-cutting.** Adjacent to graphics-3d only in that hands render in the WebGL scene, but this is player-owned pose logic reusing existing geometry — no new GPU budget ask. Overlaps the design pillar of embodiment.

### 7. [minor] Water contact produces no splash, ripple, or entry sound
_Effort: M_

**Root cause.** AudioEngine.footstep(wading) (AudioEngine.ts:260-280) only shifts tone/duration; there is no water-entry cue and no per-player ripple/particle. explorer.enterSwim() (explorer.ts:326-330) sets mode/pos with no side effect, and the wade edge (this.wading flips in updateWalk) emits nothing. The only splash sound, splashScatter (AudioEngine.ts:421), is wired to fleeing fish (AudioSystem.ts:363).

**Solution.** Split into the parts I own (always-on, zero draw) and the 3D part I hand off. (Mine) Expose a drained edge on the explorer — justEnteredWater(): true on the frame wading rises OR enterSwim fires — mirroring the existing justStartled/justFlushed one-shot idiom. AudioSystem polls it and calls a new AudioEngine.splash() (a short filtered noise burst + low plop, built like thunder/splashScatter, zero asset bytes). Also give wading footsteps a lighter splash variant (already tonally distinct; add a touch of noise). (Cross-cutting to graphics-3d) A splash particle burst + feet ripple is a WebGL Points/mesh effect: reuse the pooled DiscoveryBurst pattern (src/fx/LeafBurstSystem.ts) in a new WaterSplashSystem triggered off the same edge, gated by reduced motion — but it adds one Points draw call.

**Files.**
- `src/player/explorer.ts — add justEnteredWater() drained flag set in updateWalk (wading rising edge) and enterSwim()`
- `src/audio/AudioEngine.ts — add splash() one-shot; enrich the wading footstep branch`
- `src/audio/AudioSystem.ts — inject a WaterEnterSource, poll and fire splash()`
- `src/buildGame.ts — wire the explorer edge into AudioSystem (and the FX system if built)`
- `src/fx/WaterSplashSystem.ts (new, tier-gated) — graphics-3d owned; reuses DiscoveryBurst`

**Steps.**
1. Add private justEnteredWaterFlag to ExplorerSystem, set true when this.wading transitions false->true or in enterSwim(); expose justEnteredWater() that returns-and-clears.
2. Add AudioEngine.splash(): a bandpassed noise burst (~0.2s) plus a low sine plop, using the existing createBuffer LCG noise pattern.
3. Add a WaterEnterSource interface to AudioSystem and poll it each frame (alongside the justFlushed/justScattered polls, lines 361-367); call engine.splash().
4. Sweeten the wading footstep in AudioEngine.footstep by mixing a short noise tail when wading.
5. (Hand to graphics-3d) Add WaterSplashSystem gated to medium/high tier, or fold the burst into an existing water FX pass so no new draw call is added on high.

**Acceptance.** Vitest AudioEngine.test.ts (mirror existing one-shot tests): assert splash() creates the expected osc/buffer/gain graph on a fake context and is a no-op when muted. AudioSystem.test.ts: drive a fake explorer whose justEnteredWater() returns true once and assert engine.splash() is called exactly once. explorer.test.ts / explorer.swim.test.ts: step from dry into wade depth and assert justEnteredWater() latches once then clears. Observable: stepping into the lagoon plops.

**Risk.** Audio + edge are zero-draw and always-on — the safe core. PERF: the particle/ripple burst adds one Points draw call, and high tier has ~0 headroom — gate WaterSplashSystem to medium/high OR let graphics-3d fold ripples into the existing water pass. Don't double-fire against the fish splashScatter (different source). Draining edges must follow the justStartled idempotency discipline so nothing accumulates while paused.

**Cross-cutting.** The 3D splash particles/ripples belong to graphics-3d (WebGL canvas, draw-call budget); the entry sound + wade-tone + explorer edge are mine. Coordinate the shared justEnteredWater() edge so audio and FX consume separate drained flags (same split the birds use for justFlushed vs consumeFlushBurst).

### 8. [polish] Footsteps do not couple to terrain type
_Effort: M_

**Root cause.** AudioEngine.footstep(wading:boolean) (AudioEngine.ts:258-280) branches on one boolean; AudioSystem.ts:293 calls engine.footstep(state.wading) with no material argument. Sand, jungle grass and carved stone all play the identical dry click, flattening the island's deliberately varied ground.

**Solution.** Classify a coarse surface at the player's feet and pass it to footstep(). The world already has a pure classifier: computeSplatWeights(height, slope, noise) in src/world/terrainSplat.ts (channels jungleFloor/leafLitter/rock/sand). Inject a surfaceAt(x,z) closure from buildGame that samples terrain.heightAt (and estimates slope from neighbour heights), runs computeSplatWeights, and returns the dominant channel mapped to a coarse SurfaceType 'sand'|'grass'|'stone'|'water'. AudioSystem calls it only when a footstep actually fires (~2/s), so cost is trivial. AudioEngine.footstep(surface) selects filter freq/osc type/duration per surface: sand = soft high-noise scuff, grass/jungleFloor = the current muted triangle, stone/rock = a brighter, shorter tick with a tiny tail. Water stays the wading branch.

**Files.**
- `src/audio/AudioEngine.ts — footstep signature takes a SurfaceType; per-surface tone table`
- `src/audio/AudioSystem.ts — inject a SurfaceSource, resolve surface on footstep fire, pass to footstep()`
- `src/world/terrainSplat.ts — optional helper dominantSurfaceAt (or classify in buildGame)`
- `src/buildGame.ts — build the surfaceAt closure from terrain + computeSplatWeights and inject it`
- `src/audio/AudioEngine.test.ts / AudioSystem.test.ts — coverage`

**Steps.**
1. Add a SurfaceType union and a dominant-channel->SurfaceType mapping (rock->stone, sand->sand, jungleFloor/leafLitter->grass).
2. In buildGame, create surfaceAt(x,z): sample terrain height + a coarse slope (from heightAt at +/- a small epsilon), call computeSplatWeights, return the mapped dominant surface; wading/water still takes precedence via waterDepthAt.
3. Inject surfaceAt into AudioSystem; in the footstep-fire branch (AudioSystem.ts:290-295) resolve surface (water if state.wading) and call engine.footstep(surface).
4. Change AudioEngine.footstep to switch on surface for filter.frequency, osc.type, dur, and peak — keeping the wading tone as the water case.
5. Retune the four surface tones by ear.

**Acceptance.** Vitest terrainSplat / a new dominantSurface test: assert shore/low-flat -> 'sand', mid-elevation -> 'grass', high/steep -> 'stone' (reuse the bands already covered in terrainSplat.test.ts). AudioEngine.test.ts: assert footstep('stone') vs footstep('sand') set different filter.frequency/osc.type on the fake context. AudioSystem.test.ts: with a fake surfaceAt returning 'stone', assert engine.footstep is called with 'stone'. Observable: beach, jungle and ruins sound distinct underfoot.

**Risk.** Zero draw/triangle cost; a handful of extra heightAt calls per footstep (~2/s), negligible CPU. Cross-module: pulls a world classifier into the audio path via an injected closure — keep AudioSystem free of THREE/world imports (inject the closure, don't import terrainSplat there). Watch that the slope estimate is cheap and that water/wading still overrides surface. Combines cleanly with finding 3's distance-based footstep trigger — do finding 3 first so the surface lookup hangs off the same fire point.

**Cross-cutting.** Depends on and should follow finding 3 (the footstep now fires on the shared stride/distance clock; surface resolution attaches to that same fire). The classifier is world-owned (terrainSplat.ts) — coordinate with world so the audio bands stay in sync with the visual splat bands they mirror.

### 9. [polish] No haptic feedback on touch/mobile actions
_Effort: S_

**Root cause.** No call to navigator.vibrate anywhere (grep confirms zero matches). TouchActionButton.tsx:73-77 onPointerDown only calls onPress(); impactful edges (hurt, dig thud, discovery) surface only through stores with no tactile layer, despite the mobile-first share-link design.

**Solution.** Add a tiny feature-detected, preference-gated haptics utility and wire it to the touch button press plus a few key edges. util haptics.ts: vibrate(pattern) that no-ops unless 'vibrate' in navigator AND reduced motion is off AND (optionally) sound isn't muted. Call it from TouchActionButton.onPointerDown (a short 10-15ms tick). For gameplay edges (hurt, dig thud, discovery), add a small HapticsBridge hook/component (or fold into DamageVignette/DiscoveryAnnouncer which already subscribe) that fires distinct short patterns on the same store edges the audio uses. Because it is DI-free browser API, guard it centrally so tests can stub navigator.vibrate.

**Files.**
- `src/ui/haptics.ts (new) — vibrate(pattern, opts) with feature-detect + reduced-motion guard`
- `src/ui/TouchActionButton.tsx — vibrate on press`
- `src/ui/DamageVignette.tsx (or a new HapticsBridge) — vibrate on hurt edge; reuse discovery/quest subscriptions for discovery/dig`
- `src/ui/haptics.test.ts (new) — coverage with a mocked navigator.vibrate`

**Steps.**
1. Create haptics.ts exporting a pure function that reads a passed-in 'enabled' flag (reduced-motion off) and calls navigator.vibrate only when the API exists.
2. Pass the reduced-motion/settings read in from callers (don't read a global) to keep it testable.
3. Wire TouchActionButton press to a ~12ms pulse.
4. Fire a short double-pulse on the hurt edge (reuse the health-drop detection from finding 1), a light tick on dig thud, and a satisfying pulse on discovery — subscribing to the same stores the audio does.
5. Guard everything behind feature detection so desktop/no-support is a silent no-op.

**Acceptance.** Vitest haptics.test.ts: mock navigator.vibrate, assert it is called with the expected pattern when enabled and NOT called when reduced motion is on or when 'vibrate' is undefined. Component test: TouchActionButton press triggers vibrate when enabled. On-device: the actual buzz cannot be proven headless or in desktop Chromium — flag NEEDS VERIFICATION per the charter's on-device gap policy and note it in the run log.

**Risk.** Zero rendering cost. CHARTER on-device gap: headless Vitest and desktop Playwright cannot prove real vibration — must be flagged needs-verification, not claimed as done. Guard against over-buzzing (rate-limit; don't fire on every gradual health tick — reuse the >=5 drop threshold). iOS Safari has no navigator.vibrate; feature-detect so it is a clean no-op there.

**Cross-cutting.** Overlaps ux/mobile findings — the same haptics util should serve any mobile-juice item. Reuses the hurt-edge detection built for finding 1 and the discovery/quest store subscriptions that already exist (DiscoveryAnnouncer, audio).

### 10. [polish] No landing or step-down impact; verticality has no physical feel
_Effort: S_

**Root cause.** explorer.ts:240 clamps pos.y = terrain.heightAt(...) every walk frame with no vertical velocity, and fpCamera.ts applies only head-bob to camera.y (lines 64-65) — so a descent produces no dip/settle. This is the intended terrain-clamped model (design lines 64-65), leaving only an optional landing micro-motion.

**Solution.** Purely in FirstPersonCameraSystem: track lastFeetY = explorer.state.position.y between frames. Compute descentRate = (lastFeetY - feetY)/dt. When descentRate exceeds a threshold (e.g. > 2.5 m/s of drop, i.e. a ledge/steep step), inject a short damped downward camera offset (landingDip) proportional to the drop, then ease it back with damp(dip,0,~12,dt). Add it to camera.position.y alongside bobY. Skip while swimming and under reduced motion. No explorer/physics change — the settle is a camera-only cosmetic.

**Files.**
- `src/player/fpCamera.ts — lastFeetY + landingDip state and the descent-triggered damped offset`
- `src/player/fpCamera.test.ts — coverage`

**Steps.**
1. Store this.lastFeetY (init to spawn y) in the camera system.
2. In update(): compute descentRate from feetY delta / dt (guard dt>0); if !swimming && !reduced && descentRate > LANDING_THRESHOLD add to landingDip up to a cap scaled by the drop.
3. Damp landingDip toward 0 each frame; subtract it from the final camera.position.y (line 64-65).
4. Update lastFeetY at end of frame.
5. Tune LANDING_THRESHOLD and dip cap (~0.08 m) so ordinary slope walking never triggers it, only real step-downs.

**Acceptance.** Vitest fpCamera.test.ts: feed a fake explorer whose position.y drops sharply in one frame and assert camera y is pushed below (base+bob), then advance a few frames and assert it eases back to the clamped height; assert gentle slope descents (below threshold) and reducedMotion produce no dip. Observable: dropping off a ledge gives a brief settle.

**Risk.** Zero rendering cost, camera-only. Watch the threshold so continuous downhill walking or the accel-damp pinned-refusal case (explorer.ts:297-304) doesn't trigger a constant dip; and ensure it never triggers on respawn teleport (large instantaneous y change) — reset lastFeetY on a detected teleport/large jump.

**Cross-cutting.** None — self-contained camera polish. Coexists additively with the FOV kick (finding 2), damage kick (finding 1) and head-bob (finding 3); keep each as a separate summed offset.

### 11. [polish] Rain-on-lens overlay is completely static
_Effort: S_

**Root cause.** .lens-rain (tokens.css:1469-1487) is eight fixed radial-gradient droplets with only background-size set; GameCanvas.tsx:373-378 animates only el.style.opacity from weather rain01. Nothing streaks, drifts, or refreshes.

**Solution.** Animate the droplet field in pure CSS (zero draw calls). Split the single background into two stacked layers (e.g. a ::before and ::after, or two background-image groups) and give them slow, differing downward background-position drifts via @keyframes (a few px over 6-10s), plus a subtle per-layer opacity breathe so individual drops appear to run/refresh. Keep the JS opacity envelope from GameCanvas as the master intensity. Both reduced-motion gates freeze the drift (animation:none) exactly like .underwater-overlay::before / dapple-drift (tokens.css) — the field stays but stops moving.

**Files.**
- `src/tokens.css — restructure .lens-rain into layered pseudo-elements with @keyframes lens-drift + reduced-motion gates`
- `src/engine/GameCanvas.tsx — unchanged opacity driver (or move opacity to a CSS var --rain for cleanliness)`

**Steps.**
1. Move the droplet gradients into .lens-rain::before and .lens-rain::after with slightly different drop sets and background-sizes.
2. Add @keyframes lens-drift translating background-position downward and looping; different durations per layer so they never lock-step.
3. Optionally add a slow opacity flicker keyframe on one layer for the appear/refresh feel.
4. Add both reduced-motion gates (@media prefers-reduced-motion and :root[data-reduced-motion=true]) setting animation:none, mirroring the dapple-drift block.
5. Keep GameCanvas driving overall opacity (consider writing a --rain CSS var instead of style.opacity so the pseudo-elements inherit it).

**Acceptance.** No headless Vitest can assert CSS animation timelines; verify via the running build / Playwright rain-peak screenshot (scripts/verify-game.mjs) showing drops drifting, and assert in a jsdom test that .lens-rain still renders and that the reduced-motion attribute is respected (attribute presence). Observable: during a shower the droplets slide/refresh instead of a fixed speckle.

**Risk.** Zero WebGL/draw cost — CSS compositor-only, GPU-cheap. Keep the drift tiny so it reads as water, not a scrolling texture. Must add both reduced-motion gates or it regresses accessibility. On-device: fine to verify on desktop since it is not touch/audio-specific.

**Cross-cutting.** Shares the exact reduced-motion CSS idiom (freeze, don't remove) with the underwater dapple (finding 10 area) and meter-flash — reuse that pattern verbatim.

### 12. [polish] Underwater wash hard-cuts on submerge and surface
_Effort: S_

**Root cause.** UnderwaterOverlay.tsx:20 returns null when !submerged (binary mount/unmount) and .underwater-overlay (tokens.css:405-412) has a static background with no opacity transition, so crossing the waterline pops the teal wash instantly.

**Solution.** Keep the node permanently mounted and toggle a visibility class instead of unmounting: render <div className={submerged ? 'underwater-overlay underwater-overlay--on' : 'underwater-overlay'}> and drive opacity via CSS transition (base opacity:0 with transition:opacity ~0.35s, --on sets opacity:1). Breaking the surface then fades over the crossing. Because it is an opacity fade (not vestibular motion) it is reduced-motion-safe, but shorten/keep the transition consistent with the dapple idiom; the existing ::before dapple already handles its own reduced-motion freeze.

**Files.**
- `src/ui/UnderwaterOverlay.tsx — always render, class-toggle instead of null return`
- `src/tokens.css — .underwater-overlay base opacity:0 + transition; .underwater-overlay--on opacity:1`
- `src/ui/UnderwaterOverlay.test.tsx — update the null-vs-present assertion to visible-class assertion`

**Steps.**
1. Change UnderwaterOverlay to always return the div, adding the --on modifier when s.submerged.
2. In tokens.css set .underwater-overlay { opacity: 0; transition: opacity 0.35s ease; } and .underwater-overlay--on { opacity: 1; }.
3. Ensure pointer-events:none stays so the always-mounted node never eats clicks.
4. Update the existing test: it currently asserts the node is absent when not submerged — change to assert it is present without the --on class (opacity 0) and gains --on when submerged.

**Acceptance.** Vitest UnderwaterOverlay.test.tsx: assert the overlay is always in the DOM; without submerged it lacks --on, with submerged it has --on. Observable: surfacing fades the teal wash out over ~0.35s instead of snapping.

**Risk.** Zero draw cost. Regression to watch: the existing test asserts absence — it MUST be updated in the same PR or it fails. Keep pointer-events:none. The always-mounted ::before dapple animation now runs even when invisible (opacity 0) — acceptable, but consider pausing it when not --on if any perf concern (it is CSS-only, negligible).

**Cross-cutting.** Same fade-not-pop principle as the death transition (finding 9) and rain-lens (finding 8); all three are the DOM-overlay-transition family — batch them in one 'overlay polish' slice if convenient.

---

## Sound Design  
_14 solutions_

### 1. [MAJOR] Dry-land footstep ticks play while swimming
_Effort: S_

**Root cause.** AudioSystem.update() gates footsteps only on `state.speed > FOOTSTEP_MIN_SPEED` and passes `state.wading` (AudioSystem.ts:290-295). In swim mode the explorer sets `wading=false` (explorer.ts:329,390) and damps `speed` toward `TUNE.swimSwimSpeed`/`swimSpeed` 2.6 m/s (explorer.ts:360), far above the 0.5 m/s floor. The `StrideSource` interface (AudioSystem.ts:37-44) never surfaces `state.mode`, so the controller literally cannot see it is in the water and fires the dry triangle@180 tick on the walk/sprint cadence.

**Solution.** Surface `mode` (and `submerged`) on the `StrideSource` interface — `ExplorerSystem.state` already carries both (explorer.ts:206-207) so nothing new is computed. In the footstep block, skip when `state.mode === "swim"`. Rather than pure silence, route a swim-stroke: when swimming and `speed > FOOTSTEP_MIN_SPEED`, keep the same paced-timer machinery but call a new `engine.swimStroke()` on a slightly slower cadence (~0.6 s) — this dovetails with finding #13's swim-stroke work, so implement the stroke cue there and here just add the mode gate + call site.

**Files.**
- `src/audio/AudioSystem.ts (StrideSource interface ~37-44; footstep block 290-298)`
- `src/audio/AudioSystem.test.ts (explorerSource helper ~45-59 to accept mode)`

**Steps.**
1. Add `readonly mode: string` (and `readonly submerged: boolean` for #13) to `StrideSource.state` in AudioSystem.ts.
2. In the footstep block, change the outer guard to `if (state.mode !== "swim" && state.speed > FOOTSTEP_MIN_SPEED)`; add an `else if (state.mode === "swim" && state.speed > FOOTSTEP_MIN_SPEED)` branch that paces `engine.swimStroke()` (see #13) and otherwise resets `footstepTimer = 0`.
3. Extend the `explorerSource` test helper to default `mode: "walk"` and accept an override.

**Acceptance.** New Vitest in AudioSystem.test.ts modelled on the existing 'passes the wading flag' test (AudioSystem.test.ts:216-226): build `explorerSource({ speed: 4, mode: "swim" })`, run several `sys.update(CTX(0.5))`, assert `engine.footstep` is never called (and `engine.swimStroke` is, once #13 lands).

**Risk.** Low. No render/draw/triangle impact — audio thread only. `StrideSource` widening is source-compatible with `ExplorerSystem.state`. Regression to watch: the wade→swim seam (explorer.ts:291-296) flips mode mid-step; the mode gate must win over the still-truthy `wading` so a step entering deep water doesn't double-fire.

**Cross-cutting.** Shares the `StrideSource` widening and the swim-stroke cue with finding #13 (No splash/swim-stroke/underwater muffling) — do them in one slice: #13 adds `swimStroke()`/`splash()`/the submerged filter, this finding adds the mode gate that stops the dry tick and routes to the stroke.

### 2. [MAJOR] Threat warning sounds are non-positional despite being the mechanic
_Effort: L_

**Root cause.** The whole engine is a mono chain — every voice connects to a single `master` GainNode → destination (AudioEngine.ts:846,183) and `AudioContextLike` exposes no panner (AudioEngine.ts:36-44). The threat seams are booleans: `snakes.anyAlert()` (snakes.ts:311) and `jaguar.isStalking()` — no bearing or distance reaches the engine. So the rattle/growl are dead-centre and level-flat regardless of where the threat is, defeating the design's spatialised-warning mechanic (doc line 160).

**Solution.** Add StereoPanner-based positioning (cheaper than full PannerNode/HRTF — correct for the mobile-first mandate; keep `PositionalAudio` out until the graphics-3d listener seam earns it). (1) Extend `AudioContextLike` with `createStereoPanner(): StereoPannerNodeLike` and add the node type. (2) Give `blip()` and the growl an optional `pan` (-1..1) + `distanceGain` and insert a StereoPanner between the voice gain and master. (3) Expose bearing from the wildlife systems: they already know both positions and player facing (snakes read `pl.facing` at snakes.ts:295; jaguar has player + jaguar position, jaguar.ts:242,553). Add `snakes.nearestAlert(): { pan: number; dist01: number } | null` and `jaguar.stalkBearing(): number | null`, where `pan = clamp(sin(angleToThreat - playerYaw), -1, 1)` and `dist01` attenuates gain. (4) AudioSystem passes these into `snakeAlert(pan,dist01)` / `growl(pan)`.

**Files.**
- `src/audio/AudioEngine.ts (AudioContextLike 36-44; new StereoPannerNodeLike; blip() 831-849; snakeAlert() 336-343; growl() 348-368)`
- `src/wildlife/snakes.ts (add nearestAlert() near anyAlert() 311-316)`
- `src/wildlife/jaguar.ts (add stalkBearing())`
- `src/audio/AudioSystem.ts (SnakeAlertSource/JaguarStalkSource interfaces 81-93; call sites 351-357)`
- `src/audio/AudioEngine.test.ts (fakeContext createStereoPanner)`
- `src/audio/AudioSystem.test.ts (snakeSource/jaguarSource helpers)`

**Steps.**
1. Add `createStereoPanner()` to `AudioContextLike` and a `StereoPannerNodeLike { readonly pan: AudioParamLike } extends AudioNodeLike`; add it to the test `fakeContext`.
2. Insert an optional StereoPanner in `blip()` and in the growl chain; when a pan arg is given, wire osc→gain→panner→master and set `panner.pan.value`.
3. Add `nearestAlert()` to SnakesSystem computing the nearest alert/strike snake's screen-relative pan + normalised distance; add `stalkBearing()` to JaguarSystem.
4. Widen `SnakeAlertSource`/`JaguarStalkSource` and pass the pan/dist into `engine.snakeAlert(...)`/`engine.growl(...)` at AudioSystem.ts:351-357 (fall back to centre when null).
5. Tests: fake StereoPanner records `pan.value`; assert a right-side snake yields pan>0 and a left-side pan<0; assert distance scales gain.

**Acceptance.** Vitest: with a stubbed snake at bearing right-of-camera, `engine.snakeAlert` receives pan>0 and the created StereoPanner's `pan.setValueAtTime`/value is positive; a far snake yields lower peak gain than a near one. Observable: in the build, a rattle to the player's left is heard on the left; walking past pans it across.

**Risk.** Audio-thread only; StereoPanner is one cheap node per positioned one-shot (self-disposing) — negligible next to the render/triangle budget the perf doc governs. Adds a required method to `AudioContextLike`, so every fake context in tests must gain `createStereoPanner`. Regression: the growl/rattle already fire on rising edges — bearing is sampled at fire time only (fine; they are short). Coordinate the eventual `THREE.AudioListener` upgrade with graphics-3d, but do NOT reach across the seam now.

**Cross-cutting.** Same `AudioContextLike` extension + panner plumbing as #11 (stereo width) and shares the master-chain rebuild with #5 (ambient bus) and #10 (limiter). Land the interface/graph-backbone changes once as a foundation slice, then #4/#11/#5/#10 hang off it.

### 3. [minor] Ambient bird/owl accents keep firing over the death overlay and menus
_Effort: S_

**Root cause.** The critter-accent timer (AudioSystem.ts:277-284), the day/night crossfade and river proximity all run every frame in `update()` with no check on `session.paused`. Death (SurvivalSystem.ts:216) and menus pause the session, but AudioSystem never sees it — only footsteps are silenced, indirectly, because the paused explorer zeroes `state.speed`. So cheerful chirps/hoots keep playing over the 'you died' overlay and pause menu.

**Solution.** Inject a `PausedSource` seam (a `{ paused: boolean }` read — `GameSession` satisfies it via its `paused` getter, gameSession.ts:9) into AudioSystem. At the top of the critter-accent block, skip firing (and keep decrementing/reset the timer as appropriate) when `paused`. This is the same gate the heartbeat (#3) needs. Leave the mute-sync, `recoverIfInterrupted`, and bed crossfade running (they must keep tracking), but skip the sparse one-shot accents while paused. Optionally soften the whole bed while paused by ducking the ambient bus (#5) a touch — nice-to-have, not required.

**Files.**
- `src/audio/AudioSystem.ts (constructor params 201-218 add PausedSource; critter block 277-284; new interface near MutedSource 46-49)`
- `src/buildGame.ts (pass `session` into AudioSystem 272-293)`
- `src/audio/AudioSystem.test.ts (makeSystem/neutralArgs add a paused source; new test)`

**Steps.**
1. Add `interface PausedSource { readonly paused: boolean }` (or reuse GameSession's shape) and a constructor param.
2. Wrap the critter-accent block in `if (!this.paused.paused)` — still decrement the timer or hold it so it doesn't burst a backlog on resume (hold the timer while paused).
3. Wire `session` into the AudioSystem construction in buildGame.ts.
4. Add the paused source to the test rig (default not paused) and a test asserting no `birdChirp`/`owlHoot` fires across many paused updates, and that accents resume when unpaused.

**Acceptance.** AudioSystem.test.ts: with a paused source, run ~30 updates spanning the critter interval and assert `engine.birdChirp`/`owlHoot` are never called; flip paused false and assert they resume. Observable: dying or opening the pause menu silences the ambient accents.

**Risk.** Audio-thread only; adds one injected boolean read per frame (allocation-free). Watch: don't gate the mute-sync or `recoverIfInterrupted` (they must keep running while paused). Hold the critter timer while paused so it doesn't fire a queued accent the instant the menu closes.

**Cross-cutting.** The injected `paused` seam is shared with #3 (heartbeat must also be gated on pause) — introduce the `PausedSource` once.

### 4. [minor] Bird chirp is a single pure sine 'ping'
_Effort: S_

**Root cause.** `birdChirp()` is one sine blip at 2200–2800 Hz (AudioEngine.ts:488-492), a steady tone with no glide or multi-note structure. Fired every 4–11 s as the primary daytime accent (AudioSystem.ts:281), it reads as a video-game 'ping', not a bird — real calls have rapid pitch sweeps and 2–3 notes.

**Solution.** Rewrite `birdChirp()` as a 2–3 note call where each note is a short sine/triangle with an exponential pitch glide (a quick up-then-down chirp, e.g. note glides 2600→3200→2400 over ~60 ms), with a randomised note count (2 or 3), inter-note gap (~40–80 ms), base pitch and glide direction per call so a run of them never repeats. Keep the peak low (0.05) as it is an ambient accent. This is a small, self-contained change to one method.

**Files.**
- `src/audio/AudioEngine.ts (birdChirp() 488-492; optionally add a private `chirpNote(freqStart,freqEnd,at,dur,peak)` glide helper)`
- `src/audio/AudioEngine.test.ts (it.each birdChirp row 143 expects 1 oscillator)`

**Steps.**
1. Add a private glide helper (or inline) that schedules `frequency.setValueAtTime`+`exponentialRampToValueAtTime` on a short-lived osc.
2. Rewrite `birdChirp()` to schedule 2–3 gliding notes with per-call random base pitch, note count, and gaps.
3. Update the it.each birdChirp voiceCount (1 → variable): either stub `Math.random` to force a fixed count for a deterministic assert, or assert `oscillators.length >= 2` and all start/stop.

**Acceptance.** Vitest: with `Math.random` stubbed, `engine.birdChirp()` creates the expected 2–3 oscillators, each with a `frequency.exponentialRampToValueAtTime` call (proving a glide), and two calls with different stubbed randoms differ in base freq. Observable: daytime chirps warble and vary rather than pinging identically.

**Risk.** Audio-thread only; still one-shot self-disposing voices. Only test churn is the fixed voiceCount in the it.each. No budget impact. Owl hoot could get the same treatment later but is out of scope here.

**Cross-cutting.** None — isolated to `birdChirp()`.

### 5. [minor] Entire mix is mono / dead-center — no stereo width
_Effort: M_

**Root cause.** No `StereoPannerNode` anywhere; every SFX, accent and bed plays hard-centre and `AudioContextLike` has no pan node (AudioEngine.ts:36-44). A jungle of birds, insects, wildlife and water all stacked centre sounds flat and small, especially on headphones, with no left/right sense of the world.

**Solution.** Reuse the StereoPanner infrastructure added in #4. Give the ambient one-shot accents (`birdChirp`, `owlHoot`, and the comedy critters) a randomised pan per call (`-0.6..0.6`) so the canopy spreads across the field, and give the wildlife/positional one-shots (#4) their computed pan. Keep the beds mostly centred (river/rain/waterfall are enveloping) but optionally widen the insect bed slightly by splitting it into two lightly-panned voices (it's already two detuned oscillators, AudioEngine.ts:526-538 — route them L/R through two small panners for width at near-zero cost). Add an optional `pan` param to `blip()` (already needed by #4).

**Files.**
- `src/audio/AudioEngine.ts (blip() 831-849 pan arg; birdChirp 488, owlHoot 495, monkey/critter cues 373-428; optionally the insect bed L/R split 526-538)`
- `src/audio/AudioEngine.test.ts (createStereoPanner in fakeContext)`

**Steps.**
1. With the StereoPanner support from #4 in place, add an optional `pan` to `blip()` and to the bird/owl/critter methods.
2. Randomise pan per call for the sparse accents (AudioSystem can pass it, or the engine can jitter internally for pure-ambient accents).
3. Optionally route insect osc A and osc B through two panners at ~-0.3/+0.3 for a wider bed.
4. Extend tests to assert accents create a StereoPanner and set a non-zero pan.

**Acceptance.** Vitest: `engine.birdChirp()` (with Math.random stubbed) creates a StereoPanner with a non-zero `pan.value`; two calls yield different pans. Observable on headphones: birds and critters spread across the stereo field instead of stacking centre.

**Risk.** Audio-thread only; StereoPanner is cheap and one-shots self-dispose. Widening the insect bed adds one persistent panner (fine within the node budget). Depends on the #4 panner interface. Keep pan magnitude modest so mobile mono speakers (which sum L+R) don't lose level.

**Cross-cutting.** Same panner infrastructure and `AudioContextLike` extension as #4 — this is the ambient/aesthetic half, #4 is the gameplay-critical half. Implement the panner support once (#4) and apply it here.

### 6. [minor] Footsteps are a single identical tonal tick — no surface or per-step variation
_Effort: M_

**Root cause.** `footstep(wading)` (AudioEngine.ts:260-280) hard-codes a single triangle oscillator: freq 180, bandpass 700, gain 0.06, dur 0.08 for dry (and one square variant for wading). There is no per-call randomisation of pitch/level/timing and no noise transient, so the most-repeated sound in the game is a deterministic blip — a metronome. The design (doc line 159) asked for soil/sand/leaf-litter/shallow-water surfaces.

**Solution.** Two layers. (1) Per-step jitter: multiply freq by `0.9 + Math.random()*0.2`, peak by `0.85 + Math.random()*0.3`, and jitter the bandpass centre ±15% — cheap, kills the metronome. (2) Add a short filtered-noise 'crunch' transient in parallel with the tonal tick: a ~40 ms slice of a cached noise buffer through a highpass (~1.5 kHz for dry leaf-litter, ~2.5 kHz + longer tail for sand) at low gain (~0.04). Branch the tone on a `surface` enum `"soil"|"sand"|"leaf"|"shallow"` passed by AudioSystem, which can classify cheaply from seams it already holds: `waterDepthAt` (>0 shallow → the existing wading path), and lagoon/beach proximity for sand (the world's `zones` seam). Reuse a single lazily-built, cached noise buffer (the LCG pattern already used at AudioEngine.ts:657-663) so it costs zero extra bytes and one shared `AudioBuffer`.

**Files.**
- `src/audio/AudioEngine.ts (footstep() 260-280; add a private cached `stepNoise` buffer + a `noiseBuffer()` helper shared with #6/#7/#13)`
- `src/audio/AudioSystem.ts (footstep call site 293; add a surface classifier from waterDepthAt/zones)`
- `src/audio/AudioEngine.test.ts (it.each footstep row 137; wading-tone test 164-172)`

**Steps.**
1. Extract a private `noiseBuffer(seconds, seed)` helper in AudioEngine that memoises a mono LCG-noise `AudioBufferLike` (refactor rain/waterfall to use it too — see #6/#7).
2. Change `footstep(surface: "soil"|"sand"|"leaf"|"shallow")` (keep a boolean-compat overload or migrate the one call site). Apply pitch/level/filter jitter and add the parallel noise-crunch voice per surface.
3. In AudioSystem, add a private `surfaceAt(state)` returning the enum from `waterDepthAt`/lagoon zone and pass it at line 293.
4. Update the AudioEngine test: the footstep now creates >1 node — assert the tonal osc still starts/stops and that two successive calls produce differing scheduled freqs (jitter); update the wading-tone comparison to the new `"shallow"` surface.

**Acceptance.** Vitest: call `engine.footstep("soil")` twice with a stubbed `Math.random` returning distinct values and assert the two oscillators' `frequency.setValueAtTime` first args differ; assert a noise `bufferSource` is created per step. Observable: run the build, walk on soil vs the lagoon beach and confirm audibly different, non-metronomic steps.

**Risk.** Audio-thread only; the extra noise voice is a one-shot that stops+disconnects (no leak, no render budget). The shared cached buffer keeps allocation off the per-step path. Regression: the it.each voiceCount assertion (AudioEngine.test.ts:137) counts oscillators — the noise layer is a bufferSource not an oscillator, so the tonal count stays 1, but verify. Depends on a `zones`/surface seam being reachable from AudioSystem (already injected `waterDepthAt`; lagoon needs a small added seam or reuse of wading-only classification if zones is not wired).

**Cross-cutting.** The `noiseBuffer()` helper is the same extraction needed by #6 (river noise), #7 (rattle noise) and #13 (splash) — extract once.

### 7. [minor] No audio warning for critical or draining survival meters
_Effort: M_

**Root cause.** `hurtThud` fires only on a single-update health drop ≥ `HURT_DROP_THRESHOLD` (5) (AudioSystem.ts:130,323). Starvation/dehydration/drowning apply `drain*dt` per frame (SurvivalSystem.ts:200-201), a sub-point fraction that never crosses 5, so a player draining to death hears nothing until the death sting (AudioSystem.ts:324). There is no low-meter feedback loop at all.

**Solution.** Add a synthesised heartbeat that engages under a health floor and quickens/loudens as health approaches zero — the classic survival-tension cue, all procedural (0 bytes). New `engine.heartbeat(intensity01)` = two low sine thuds (~55 Hz and ~40 Hz, ~90 ms apart, short decay) at gain scaled by intensity. In AudioSystem, when `survival.health < HEART_FLOOR` (e.g. 30) and `alive`, run a repeating timer whose interval interpolates from ~1.1 s at the floor to ~0.45 s near zero, calling `heartbeat`. Gate on `!session.paused` (uses the same paused seam as #12) so it doesn't thump under the death overlay. Optionally add a separate labored-breath escalation for `breath` (drowning) by reusing `breathe()` on a fast cadence when `submerged` and health draining.

**Files.**
- `src/audio/AudioEngine.ts (new heartbeat() method near breathe() 236-256)`
- `src/audio/AudioSystem.ts (new HEART_FLOOR const + heartTimer field + block in update() near survival edges 320-327)`
- `src/audio/AudioEngine.test.ts (add heartbeat to it.each)`
- `src/audio/AudioSystem.test.ts (survivalSource already carries health)`

**Steps.**
1. Implement `heartbeat(intensity01)` as two low sine blips with intensity-scaled gain (0.08–0.18).
2. Add `HEART_FLOOR=30`, `HEART_INTERVAL_MIN=0.45`, `HEART_INTERVAL_MAX=1.1`, and a `heartTimer` field to AudioSystem.
3. In update(), after reading the survival snapshot: if `sv.alive && sv.health < HEART_FLOOR && !paused`, decrement `heartTimer` by `ctx.dt`; on ≤0 call `heartbeat(1 - sv.health/HEART_FLOOR)` and reset the timer by the interpolated interval; else reset to MAX.
4. Add tests: heartbeat is a 2-voice one-shot (it.each); AudioSystem fires it on a cadence when health<30 and stops when health recovers above the floor (mirror the pant-cadence test AudioSystem.test.ts:432-444).

**Acceptance.** Vitest mirroring the exhaustion-pant test (AudioSystem.test.ts:432): drive `survival.health=15`, step ~2 s of updates, assert `engine.heartbeat` called ≥2 times and interval shrinks as health drops; raise health above 30 and assert it stops. Observable: starve to near-death in the build and hear an accelerating heartbeat.

**Risk.** Audio-thread only, one-shot voices that self-dispose. Must be gated on `!paused` (needs the #12 paused seam) or it thumps under the death overlay. Watch double-cueing against `hurtThud` — they're complementary (transient vs sustained) so acceptable. Ensure it re-arms at full interval when crossing back above the floor to avoid an immediate double-thud.

**Cross-cutting.** Needs the same injected `paused` seam introduced by #12; land #12 first or together.

### 8. [minor] No master limiter — concurrent voices can clip
_Effort: S_

**Root cause.** Every voice/bed connects to `master` → destination with no compressor/limiter, and `AudioContextLike` doesn't expose one (AudioEngine.ts:36-44,846,183). When loud events coincide (growl 0.22 + thunder 0.42 + rain/waterfall/river beds + a chime 0.35), the sum after the 0.7 master exceeds 1.0 and hard-clips.

**Solution.** Insert a `DynamicsCompressorNode` as a soft-knee brickwall limiter between `master` and `destination`: `master → compressor → destination`. Extend `AudioContextLike` with `createDynamicsCompressor(): DynamicsCompressorNodeLike` (params: threshold ~-6 dB, knee ~6, ratio ~12, attack ~0.003, release ~0.1). This tames peaks transparently without touching individual voice levels. It is one persistent node created once in the constructor.

**Files.**
- `src/audio/AudioEngine.ts (AudioContextLike 36-44; new DynamicsCompressorNodeLike; constructor 179-187 to chain master→compressor→destination; dispose 826)`
- `src/audio/AudioEngine.test.ts (fakeContext add createDynamicsCompressor; master→destination connection test 113-121)`

**Steps.**
1. Add `createDynamicsCompressor()` to `AudioContextLike` and a `DynamicsCompressorNodeLike` type exposing `threshold/knee/ratio/attack/release` AudioParams.
2. In the constructor, create the compressor, set its params, connect `master → compressor → destination` (instead of master → destination).
3. Disconnect the compressor in `dispose()`.
4. Add `createDynamicsCompressor` to every test `fakeContext`; update the 'master connects to destination' test (AudioEngine.test.ts:113-121) to expect master → compressor and compressor → destination.

**Acceptance.** AudioEngine.test.ts: assert a compressor node is created, `master.connect(compressor)` and `compressor.connect(destination)` occur, and its params are set. Optional browser-mode `OfflineAudioContext` test: sum several loud cues and assert peak sample ≤ 1.0 (needs real audio engine, not jsdom). Observable: stacking thunder + growl + beds no longer distorts.

**Risk.** Audio-thread only; one added node. Adds a required `AudioContextLike` method → all fakes must add it (shared churn with #4). Watch: compressor introduces a tiny lookahead but at these params it's inaudible; the mute-suspend economy still works (compressor is downstream of master).

**Cross-cutting.** Same `AudioContextLike` extension + master-graph rebuild as #4/#5/#11 — the limiter is the final node before destination in the unified backbone; land it with them.

### 9. [minor] No splash, swim-stroke, or underwater muffling for water play
_Effort: L_

**Root cause.** AudioEngine has no splash/swim/submerged method; diving, surfacing and swimming produce no dedicated audio, and the master is never low-passed while submerged even though `explorer.state.submerged` exists (explorer.ts:207,249) and the visual UnderwaterFxSystem already reacts to it (buildWorld.ts). The soundscape is identical above and below water, leaving the #184 swim/breath mechanic sensory-empty.

**Solution.** Three procedural additions. (1) `engine.splash()` — a short filtered-noise burst (shared `noiseBuffer()`) with a fast bright→dark sweep, fired by AudioSystem on the walk→swim / surface→submerge edge (detect via `state.mode` and `state.submerged` transitions — both now on `StrideSource` from #1). (2) `engine.swimStroke()` — a soft low whoosh (bandpassed noise, ~0.3 s) paced by AudioSystem while `mode==="swim"` and moving (the branch added in #1). (3) Underwater muffle — a `BiquadFilter` lowpass (~600 Hz) inserted before the destination (or on the ambient/one-shot path), bypassed above water and engaged (cutoff ramped down over ~0.2 s) while `submerged`; `engine.setSubmerged(bool)` toggles it click-free by ramping the filter cutoff, not reconnecting nodes.

**Files.**
- `src/audio/AudioEngine.ts (new splash(), swimStroke(), setSubmerged(); a persistent lowpass in the master chain; noiseBuffer() helper)`
- `src/audio/AudioSystem.ts (StrideSource mode+submerged from #1; edge detection for splash/submerge; swim-stroke pacing in the #1 footstep branch)`
- `src/audio/AudioEngine.test.ts + AudioSystem.test.ts`

**Steps.**
1. Add a persistent lowpass filter in the master chain (e.g. between master and the #10 compressor) with cutoff high (~20 kHz, effectively open) when dry; `setSubmerged(true)` ramps cutoff to ~600 Hz, `false` ramps it back.
2. Implement `splash()` (noise burst + sweep) and `swimStroke()` (soft bandpassed-noise whoosh) as self-disposing one-shots gated by `canPlay()`.
3. In AudioSystem, track `lastMode`/`lastSubmerged`; fire `splash()` on the dry→swim and above→submerged edges, call `setSubmerged` on submerged changes, and pace `swimStroke()` in the swim branch created by #1.
4. Tests: splash/swimStroke are one-shot voices (it.each); `setSubmerged(true)` ramps the master lowpass cutoff down and `(false)` back up; AudioSystem fires splash exactly once per entry edge and toggles submerged.

**Acceptance.** AudioEngine.test.ts: `setSubmerged(true)` calls the master lowpass `frequency.linearRampToValueAtTime` toward ~600, `(false)` toward ~20000; splash/swimStroke create self-stopping voices. AudioSystem.test.ts: entering swim mode fires `splash` once (edge, not per-frame) and paces `swimStroke` while moving. Observable: diving in the build gives a splash and a muffled underwater mix; surfacing clears it.

**Risk.** Audio-thread only; one added persistent lowpass + one-shot voices. Must ramp the filter cutoff (never reconnect/assign mid-sound) to stay click-free. Depends on #1's `StrideSource` widening (mode+submerged) and shares the `noiseBuffer()` helper. Watch the muffle placement so it doesn't fight the #10 compressor or #5 bus — settle the master-chain order once.

**Cross-cutting.** Depends on #1 (mode/submerged on StrideSource + the swim branch), shares `noiseBuffer()` with #2/#6/#7, and shares the master-chain ordering with #5/#10. Best delivered right after the graph-backbone slice.

### 10. [minor] No volume control — settings expose only a binary mute
_Effort: M_

**Root cause.** The `Settings` interface holds only `muted/quality/reducedMotion/showDiscoveredMarkers` (settingsStore.ts:12-18); there is no volume field. `AudioEngine` offers only `setMuted` gating the master to 0/MASTER_GAIN (AudioEngine.ts:213-221). Combined with the wide un-compressed dynamic range (bed ~0.1 vs thunder ~0.42), a player can only mute all-or-nothing.

**Solution.** Add a persisted `volume: number` (0..1, default ~0.8) to `Settings` — and, if the UX/frontend team wants the split, `musicVolume`/`sfxVolume` (defer the split; ship a single master volume first). In `AudioEngine`, add `setVolume(v01)` that scales the un-muted master target: store `this.volume` and, whenever un-muted, ramp `master.gain` to `MASTER_GAIN * this.volume` (never assign `.value` mid-sound — anchor + `linearRampToValueAtTime` over ~40 ms, same click-free discipline as `setMuted`). `setMuted` continues to ramp to 0/`MASTER_GAIN*volume`. AudioSystem reads the live setting each frame alongside the mute sync (AudioSystem.ts:254). The UI slider itself is owned by senior-eng-frontend (SettingsMenu); I own the store field validation and the engine gate.

**Files.**
- `src/settings/settingsStore.ts (Settings 12-18, DEFAULTS 27-32, load() 61-80)`
- `src/audio/AudioEngine.ts (new volume field + setVolume(); MASTER_GAIN usage 182,218)`
- `src/audio/AudioSystem.ts (MutedSource → a settings snapshot read; sync in constructor 220 and update() 254)`
- `src/settings/settingsStore.test.ts (persist/validate the new field)`
- `src/audio/AudioEngine.test.ts / AudioSystem.test.ts`

**Steps.**
1. Add `volume` to `Settings`, `DEFAULTS` (0.8) and the `load()` validator (clamp to 0..1, fall back on non-number).
2. Add `private volume` + `setVolume(v01)` to AudioEngine; refactor the two `MASTER_GAIN` targets to `MASTER_GAIN * this.volume`.
3. In AudioSystem, widen the settings source to expose `volume` and call `engine.setVolume(snap.volume)` on the same cadence as `setMuted` (skip redundant sets with an epsilon like the ambient ramps).
4. Add settingsStore test for persistence/validation of `volume`; add an AudioEngine test that `setVolume(0.5)` ramps the master toward `MASTER_GAIN*0.5` and never assigns `.value` directly.
5. Coordinate with senior-eng-frontend for the SettingsMenu slider widget (their seam).

**Acceptance.** settingsStore.test.ts: a persisted `volume:0.5` round-trips and a garbage value falls back to default. AudioEngine.test.ts: `setVolume(0.5)` calls `master.gain.linearRampToValueAtTime` toward `0.35` (0.7*0.5) and never `.value=`. Observable: dragging the volume slider in the running build scales loudness smoothly with no click.

**Risk.** Audio-thread only; no budget impact. Cross-team seam: the slider UI belongs to senior-eng-frontend — do not build the widget here; only the store field + engine gate. Watch interaction with `setMuted` (muted must still win; unmute must restore to `MASTER_GAIN*volume`, not raw `MASTER_GAIN`).

**Cross-cutting.** Overlaps senior-eng-frontend (SettingsMenu widget) and ux-lead (default level, accessibility) — I own settingsStore field + AudioEngine.setVolume; they own the control and the default policy.

### 11. [minor] Phantom gulp on respawn after a thirst death
_Effort: S_

**Root cause.** `respawn()` sets thirst to `respawnLevel` (75) (SurvivalSystem.ts:129) without AudioSystem re-syncing its `lastThirst` baseline. On the first frame after waking, `sv.thirst > this.lastThirst` (AudioSystem.ts:322) is true whenever thirst-at-death was below 75, so `gulp()` fires — a wrong drinking cue at the sensitive respawn moment. Same latent risk exists for hunger/health/breath baselines (they jump on respawn too).

**Solution.** Detect the death→respawn transition in AudioSystem (`!this.lastAlive && sv.alive`) and re-baseline ALL survival-derived edge trackers to the fresh snapshot BEFORE running the edge comparisons that frame: set `lastThirst/lastHealth` (and, if added, hunger/breath baselines) to the respawn values, then skip the gulp/hurt edge checks for that one frame. Cleanest structure: read the snapshot, compute `justRespawned = !this.lastAlive && sv.alive`, and if so assign the baselines and return early from the survival-edge sub-block (still updating `lastAlive`). This mirrors the existing mount-baseline discipline (AudioSystem.ts:243-249) that already exists precisely to avoid spurious first-frame edges.

**Files.**
- `src/audio/AudioSystem.ts (survival edge block 320-327)`
- `src/audio/AudioSystem.test.ts (extend the drink/eat/hurt/death edge test 304-334)`

**Steps.**
1. In the survival block, after `const sv = this.survival.getSnapshot();`, compute `const justRespawned = !this.lastAlive && sv.alive;`.
2. If `justRespawned`, set `this.lastThirst = sv.thirst; this.lastHealth = sv.health;` (and any other survival baselines) and skip the `gulp/hurtThud/deathSting` edge checks for this frame.
3. Always update `this.lastAlive = sv.alive` at the end.

**Acceptance.** AudioSystem.test.ts (extend the edge test at 304): drive `alive:false` (death sting fires), then on the next update set `alive:true, thirst:75` (thirst was 40 before) and assert `engine.gulp` is NOT called on the respawn frame, and IS called on a later genuine thirst rise. 

**Risk.** Trivial, isolated to AudioSystem; no budget impact. Watch: the death sting must still fire on the death frame (the guard is only on the alive rising edge, not the falling edge). Ensure the same-frame skip doesn't swallow a legitimate simultaneous edge (impossible — respawn is a discrete transition).

**Cross-cutting.** None — self-contained. If #3 (heartbeat) or a hunger/breath cue is added, re-baseline those trackers on the same respawn edge.

### 12. [minor] River water is a tonal oscillator drone, not water noise
_Effort: M_

**Root cause.** The river layer in `startMusic()` is a single sawtooth oscillator at 180 Hz (`detune 5`) through a bandpass at 500 Hz (AudioEngine.ts:551-556) — a steady pitched hum. The later rain (654-679) and waterfall (727-752) beds correctly use looping filtered white-noise buffers, so the most-visited water feature sounds like a synth drone and is audibly inconsistent with them.

**Solution.** Rebuild the river layer on a looping filtered-noise buffer, matching the rain/waterfall construction: a cached LCG-noise `AudioBuffer` (distinct seed from rain/waterfall so beds don't phase-align) → bandpass (~600–900 Hz centre for a brighter babble than the waterfall's 520 Hz lowpass) → the existing `riverGain`. Add a slow cutoff LFO for movement: a low-frequency oscillator (~0.15 Hz) → gain → the bandpass `frequency` param, giving the water a living wander instead of a static tone. Keep `setRiverProximity` driving `riverGain` exactly as today — only the source changes from oscillator to buffer source.

**Files.**
- `src/audio/AudioEngine.ts (startMusic river block 540-556; musicVoices bookkeeping 559,576-578; use the shared noiseBuffer() helper from #2)`
- `src/audio/AudioEngine.test.ts (startMusic osc-count 240-249; river-gain index 283-294)`

**Steps.**
1. Replace the `riverOsc` sawtooth with a looping noise `bufferSource` (from the shared `noiseBuffer()` helper) → bandpass → `riverGain`.
2. Add a slow LFO oscillator (+ its own tiny gain) modulating the river bandpass cutoff for babble movement; track both the buffer source and the LFO for teardown.
3. Update the persistent-voice teardown in `stopMusic()`/`dispose()` to stop the buffer source and the LFO (they aren't plain oscillators in `musicVoices` anymore — either keep a separate `riverSource`/`riverLfo` field like rain, or generalise the stop list).
4. Update tests: `startMusic` now creates 2 insect oscillators + 1 LFO oscillator (not the river osc) and 1 bufferSource; fix the osc-count assertion (240-249) and confirm the river gain is still reachable for the proximity ramp test (283-294).

**Acceptance.** Vitest: after `startMusic`, assert a looping `bufferSource` exists for the river (loop===true) and that `setRiverProximity(1)` still ramps the river gain up (adapt AudioEngine.test.ts:283-294). Observable/optional: `OfflineAudioContext.startRendering()` in a browser-mode test to confirm the river layer is broadband noise, not a 180 Hz tone. Observable: stand at the bank and hear moving water, not a hum.

**Risk.** Audio-thread only; swaps one oscillator for one buffer source + one LFO — net node count is flat and the noise buffer is shared/cached (0 bytes). Main hazard is the startMusic oscillator-count and gain-index assertions across AudioEngine.test.ts. Watch teardown: the river source/LFO must be stopped on `stopMusic`/`dispose` or a voice leaks.

**Cross-cutting.** Uses the shared `noiseBuffer()` helper extracted in #2/#7; the LFO-on-cutoff technique is reused nowhere else but mirrors the rain/waterfall buffer pattern already in the file.

### 13. [minor] Snake rattle reads as a harsh alarm-clock beep
_Effort: M_

**Root cause.** `snakeAlert()` is five square-wave blips alternating 1500/1700 Hz (AudioEngine.ts:336-343). High-frequency square waves are buzzy digital tones — they read as a UI/alarm beep, not the dry broadband hiss of a real rattle, so the game's key danger cue sounds toy-like, especially on a phone speaker.

**Solution.** Resynthesise the rattle from amplitude-modulated bandpassed noise. A looping/short noise buffer (shared `noiseBuffer()` helper) → bandpass (~2.5–4 kHz, Q~2) → a gain whose value is modulated at ~35–55 Hz to produce the rapid dry-scale 'chk-chk-chk' shudder, over a ~0.5–0.9 s burst with a soft attack and decay. Add slight per-call randomisation of the AM rate and centre freq so successive rattles differ. This also carries the pan arg from finding #4 cleanly (noise chain → panner → master).

**Files.**
- `src/audio/AudioEngine.ts (snakeAlert() 336-343; shared noiseBuffer() helper)`
- `src/audio/AudioEngine.test.ts (it.each snakeAlert row 143 expects 5 oscillators; muted-SFX test 174-188)`

**Steps.**
1. Extract/reuse `noiseBuffer()`; build snakeAlert as noise bufferSource → bandpass → AM gain, with a low-freq oscillator (or scheduled gain ramps) driving the AM at ~45 Hz.
2. Add small `Math.random`-based jitter to AM rate and bandpass centre per call.
3. Ensure the voice stops+disconnects at burst end (no leak) and honours `canPlay()`/mute and the optional pan from #4.
4. Update AudioEngine.test.ts: snakeAlert no longer creates 5 oscillators — replace the it.each row with an assertion that it creates a looping/one-shot bufferSource + a bandpass + a gain and starts/stops cleanly; keep it in the muted-does-nothing test (adapt to count bufferSources).

**Acceptance.** Vitest: `engine.snakeAlert()` creates one noise `bufferSource` through a bandpass with an AM gain, and creates none while muted. Optional browser-mode `OfflineAudioContext` render asserts broadband (not a 1500 Hz line) output. Observable: the rattle sounds like a dry hiss-shudder, not a beep, on a phone speaker.

**Risk.** Audio-thread only; a one-shot noise chain that self-disposes, buffer shared/cached. Hazard: the it.each in AudioEngine.test.ts asserts an exact oscillator count (5) for snakeAlert — must be rewritten to count the new node shape. Coordinate with #4 so snakeAlert's new signature accepts the pan arg in the same slice.

**Cross-cutting.** Shares the `noiseBuffer()` helper with #2/#6/#13 and the pan plumbing with #4 (both touch snakeAlert) — do #4 and #7 to snakeAlert together to avoid two rewrites of the same method.

### 14. [minor] The two biggest payoffs can be masked — duck only touches the insect bed
_Effort: M_

**Root cause.** `completion()` ducks only `this.musicGain` (the insect bed) (AudioEngine.ts:457-464) and `fanfare()` ducks nothing (431-438). The river, rain (RAIN_MAX_GAIN 0.14) and waterfall (WATERFALL_MAX_GAIN 0.2) beds each connect straight to `master` (AudioEngine.ts:543,675,748), so during rain or near the falls the payoff cues play over un-ducked beds — the intended 'stand-alone' moment is incomplete and inconsistent.

**Solution.** Introduce a single `ambientBus` GainNode between all beds and the master: `bed → ambientBus → master`. Route the insect, river, rain and waterfall gains into `ambientBus` instead of `master`. Replace the direct `musicGain` duck in `completion()` with a duck of `ambientBus.gain` (dip to a fraction, hold, restore to 1) and add the identical duck to `fanfare()`. Because the bus sits above the per-bed level automation, the existing day/night crossfade and proximity ramps on the individual bed gains are untouched — no desync. Keep the existing `cancelScheduledValues` guard, but now on the bus (which carries no crossfade, so it's simpler — a clean dip/restore to 1.0).

**Files.**
- `src/audio/AudioEngine.ts (new ambientBus field + creation in constructor 179-187; startMusic 518,543; rain 675; waterfall 748; completion 457-464; fanfare 431-438; stopMusic/dispose)`
- `src/audio/AudioEngine.test.ts (completion-duck test 190-209; bed-count/gain-index tests that assume master=gains[0])`

**Steps.**
1. Create `this.ambientBus = ctx.createGain()` in the constructor and connect it to `master` (this shifts gain indices — the master is still gains[0], bus becomes gains[1]).
2. Point the insect bed gain, river gain, rain gain and waterfall gain `.connect()` at `ambientBus` instead of `master`.
3. Rewrite the `completion()` duck to operate on `ambientBus.gain` (dip to COMPLETION_DUCK*1, hold, restore to 1) and add the same to `fanfare()` with fanfare-appropriate timings.
4. Update tests that index gains by position (bed gain is now gains[2], river gains[3], etc.) and rewrite the completion-duck assertion to read the bus gain.

**Acceptance.** Extend the existing completion-duck test (AudioEngine.test.ts:190-209): start music, set a rain and waterfall level, call `completion()` and assert the `ambientBus` gain ramps down then back to 1 while the individual bed gains keep their own automation. Add the mirror test for `fanfare()`. Observable: trigger the finale during rain and hear the beds duck under the fanfare.

**Risk.** Audio-thread only; one added persistent GainNode (well within the ~8-node bed budget). Main hazard is the gain-index churn in AudioEngine.test.ts (many tests read `gains[1]`/`gains[2]` positionally) — update them all. Ensure `dispose()`/`stopMusic()` still disconnect cleanly with the new bus in the chain.

**Cross-cutting.** Part of the same master-graph-backbone rebuild as #4 (panner), #10 (limiter) and #11 (stereo). The clean chain is `destination ← limiter(#10) ← master ← [ambientBus(#5) for beds, StereoPanners(#4/#11) for one-shots]`; build the backbone once.

---

## UX & Onboarding  
_13 solutions_

### 1. [MAJOR] 'Reset progress' is a destructive one-click action with no confirmation and no feedback
_Effort: S_

**Root cause.** SettingsMenu.tsx:120 wires the button directly to onResetProgress with no confirm step, no onClose, and no acknowledgement, sitting immediately below the primary Resume button (lines 116-121). GameCanvas.tsx:419 `resetProgress = () => game?.discovery.reset()` only clears the discovery store/persistence — leaving position, survival, world, quest state intact — so it is also a partial, silent wipe (contrast replayExpedition GameCanvas.tsx:424-427 which reloads). A misclick from Resume erases found pages with no undo and no visible confirmation.

**Solution.** Introduce an inline two-step confirm inside SettingsMenu (no new modal, no new store): a local `useState` `confirmingReset`. First click swaps the button label to a guarded 'Erase all pages? Yes / Cancel' inline row (Yes is the destructive action, styled with a danger class; Cancel returns to the single button). Only the Yes click calls onResetProgress and then shows a transient 'Progress reset' acknowledgement line for ~2s (setTimeout cleared on unmount). Keep the menu open (do NOT auto-close — user should see the badge drop to 0/6). Optionally move the reset button below 'Back to title' so it is out of the fast-click zone under Resume. The partial-vs-full-reset inconsistency is a separate concern — note it, but the confirm gate is the fix for THIS finding.

**Files.**
- `src/ui/SettingsMenu.tsx (add confirmingReset + resetDone local state; render inline confirm row replacing the plain Reset button; danger styling; transient ack)`
- `src/ui/SettingsMenu.test.tsx (existing) — add confirm-flow cases`
- `src/tokens.css (.menu__confirm / .menu__btn--danger styles + .menu__ack)`

**Steps.**
1. Add `const [confirming, setConfirming] = useState(false)` and `const [done, setDone] = useState(false)`.
2. Replace the single Reset button with: when !confirming show 'Reset progress' (sets confirming=true); when confirming show 'Erase all pages?' + 'Yes, erase' (danger) + 'Cancel'.
3. 'Yes, erase' calls onResetProgress(), setConfirming(false), setDone(true), and schedules setDone(false) after 2000ms (clear timeout on unmount via useEffect cleanup).
4. Render an aria-live='polite' 'Progress reset' line when done, so AT users hear it.
5. Reorder actions so Reset is not adjacent to Resume (place after 'Back to title').

**Acceptance.** Add to src/ui/SettingsMenu.test.tsx: (1) clicking 'Reset progress' does NOT call onResetProgress and reveals a confirm control; (2) clicking Cancel restores the single button without calling it; (3) clicking 'Yes, erase' calls onResetProgress exactly once and renders the 'Progress reset' ack. Follow the existing render+fireEvent pattern in that file.

**Risk.** UI-only, no perf impact. Watch: keep aria-modal focus management intact (the resumeRef auto-focus effect at SettingsMenu.tsx:35-42 must still fire). The partial-reset scope mismatch (resetProgress vs replayExpedition) is out of scope here; flag it for a follow-up rather than widening this slice.

**Cross-cutting.** None direct, but the noted partial-vs-full reset inconsistency (discovery.reset only vs full reload) may surface in a gameplay/state audit; if so, unify by making resetProgress reuse the replayExpedition reload path so 'reset' always means a clean expedition.

### 2. [MAJOR] GPS-style nav arrows + distance readouts to all sites still ship, gutting the 'read the clues to navigate' pillar
_Effort: M_

**Root cause.** NavSystem.update (src/ui/NavSystem.ts:37-88) iterates every undiscovered POI each frame, computes a metre distance label (line 55) and projects each into NDC to emit either an on-screen dot with distance (lines 61-71) or a rim arrow rotated toward the site (lines 72-81). NavMarkers.tsx:26,40-55 renders the '➤' glyph + label. It is constructed in buildGame.ts:219-228 and mounted live in GameCanvas.tsx:498. The design doc removes this outright ('Nav markers to landmarks (compass instead)', line 171) and pillar 3 forbids a GPS quest arrow (lines 48-49). The system is fully wired with no default-off gate — showDiscoveredMarkers only governs already-found sites, so the undiscovered arrows always show.

**Solution.** Delete the nav-marker subsystem entirely rather than gate it — a disabled-by-default system that still contradicts the pillar is dead weight and re-introduction risk. Remove NavSystem, NavMarkers, navStore and their tests; drop `nav` from the Game interface and buildGame; unmount NavMarkers from GameCanvas; and remove the showDiscoveredMarkers setting (see the unified fix note). Keep DiscoverablePoi/discovery.pois — RevealPanel.tsx consumes them for clue text, which is the sanctioned navigation channel (compass + clue prose). Net effect: navigation reverts to compass strip + journal clue text as the spec mandates.

**Files.**
- `DELETE src/ui/NavSystem.ts + src/ui/NavSystem.test.ts`
- `DELETE src/ui/NavMarkers.tsx + src/ui/NavMarkers.test.ts`
- `DELETE src/ui/navStore.ts + src/ui/navStore.test.ts`
- `src/buildGame.ts (remove NavSystem/createNavStore imports, the `nav` field on Game interface line 47, the createNavStore + engine.addSystem(new NavSystem(...)) block lines 218-228, and `nav` from the returned object line 311)`
- `src/engine/GameCanvas.tsx (remove `<NavMarkers nav={game.nav} />` line 498 + its import)`
- `src/tokens.css (remove .nav-markers/.nav-dot/.nav-arrow rules)`
- `src/buildGame.test.ts + src/engine/GameCanvas.test.tsx (drop nav assertions/mocks)`

**Steps.**
1. Grep-confirm every `nav`/NavSystem/NavMarkers/navStore reference (list already gathered) and enumerate the callers to touch.
2. Remove the NavSystem construction + createNavStore in buildGame.ts and the `nav` field from the Game interface and return object.
3. Remove `<NavMarkers>` and its import from GameCanvas.tsx.
4. Delete NavSystem.ts, NavMarkers.tsx, navStore.ts and their three test files.
5. Delete the orphaned CSS rules in tokens.css.
6. Update buildGame.test.ts / GameCanvas.test.tsx to stop asserting on nav, then run `npm test` and `npm run build` to prove no dangling imports.

**Acceptance.** `npm run build` (typecheck) passes with zero references to nav symbols (`grep -rn 'NavSystem\|NavMarkers\|navStore\|game.nav' src` returns nothing). Add/keep a buildGame test asserting the returned Game has no `nav` field and no system with id 'nav' registered. Observable: at spawn there are no floating distance labels or edge arrows on screen (contrast scratchpad/ux/03-hud-spawn.png).

**Risk.** Low perf risk — this REMOVES a per-frame system that projected N POIs and did a matrix update every frame, so it FREES budget (CPU + React reconciliation), never adds. Watch: DiscoverablePoi/discovery.pois must remain for RevealPanel; only the projection layer goes. Regression to watch: buildGame.test.ts and GameCanvas.test.tsx assertions referencing nav.

**Cross-cutting.** This is the SAME underlying fix as the 'Show discovered markers setting is opaque' finding (#9) and almost certainly appears in the gameplay/story/world audits too (the 'navigate by reading the world, not GPS markers' pillar). Unified fix: delete the nav-marker subsystem once; the settings toggle removal (finding #9) is a strict subset of this change and should land in the same PR/slice.

### 3. [MAJOR] No pointer-lock state affordance: look silently dies after resume/tab-out and there is no 'click to look' prompt
_Effort: M_

**Root cause.** input.ts requests pointer lock only on a world pointerup while unlocked and shouldLock() (lines 144-161); there are zero pointerlockchange/pointerlockerror listeners, so nothing in the app knows or reflects lock state. buildPlayer.ts:66 releases the lock every frame the session is paused and never re-grabs it, so after Resume/Esc/tab-return the lock is gone and a desktop cursor floats over the FP view with no cue. The persistent HUD strip only says 'Mouse look' (Hud.tsx:85); the 'click to grab' hint lives solely in one-time onboarding.

**Solution.** Make lock state observable and surface it. Add a tiny observable `pointerLockStore` (mirroring hudStore/navStore idiom: cached snapshot + subscribe for useSyncExternalStore) written from input.ts on `document`-level pointerlockchange/pointerlockerror. In createPlayerInput, add the two listeners: on change, set store.locked = (document.pointerLockElement === overlay); on error, keep locked=false (a refused lock is non-fatal, matching the existing catch). Render a new `<LookPrompt>` component in GameCanvas that subscribes to the store and shows a centered, pointer-events:none 'Click to look' pill whenever `!locked && !paused && !touchActive`. The existing onPointerUp re-request already re-grabs on the first world click, so no new grab logic is needed — the fix is purely the affordance + state. Gate the prompt off for touch (touchActive) and while any modal/paused.

**Files.**
- `CREATE src/player/pointerLockStore.ts (observable {locked:boolean}, same shape as src/ui/hudStore.ts)`
- `CREATE src/ui/LookPrompt.tsx (+ test) — subscribes to the store, renders 'Click to look' cue`
- `src/player/input.ts (add pointerlockchange/pointerlockerror listeners in createPlayerInput writing the store; remove them in dispose; accept the store via a param or expose a lock-state getter/subscribe on the controller)`
- `src/player/buildPlayer.ts (thread the store through and expose on Player)`
- `src/buildGame.ts (surface lock store on Game so GameCanvas can read it)`
- `src/engine/GameCanvas.tsx (mount <LookPrompt> alongside Hud, passing session paused + touchActive)`
- `src/tokens.css (.look-prompt styling; static, reduced-motion-safe)`

**Steps.**
1. Add pointerLockStore.ts with getSnapshot/subscribe/set following hudStore.ts.
2. In input.ts add `onLockChange`/`onLockError` bound to document, wire into the store, and clean up in dispose().
3. Expose the store from the controller (or via buildPlayer→Player→Game) so React can read it.
4. Build LookPrompt.tsx: `if (locked || paused || touchActive) return null;` else a centered cue.
5. Mount LookPrompt in GameCanvas with the session paused flag and game.input.touchActive.
6. Write input.test.ts case: dispatching a pointerlockchange with document.pointerLockElement=overlay flips store.locked true; a subsequent change to null flips it false.

**Acceptance.** New Vitest in src/player/input.test.ts (existing file): construct the controller, simulate document.pointerLockElement assignment + dispatch 'pointerlockchange', assert the exposed lock store reports locked=true then false. New src/ui/LookPrompt.test.tsx: renders the cue when locked=false & not paused & not touch, renders null otherwise. Observable in build: after Resume without clicking, a 'Click to look' pill is visible; it disappears on the first world click.

**Risk.** Zero WebGL/geometry/draw-call cost — pure DOM + one document listener set. Perf-neutral (no per-frame work; the store writes only on lock transitions). Watch: jsdom has no real pointer lock, so tests must simulate document.pointerLockElement + dispatchEvent (input.test.ts already stubs pointer events). Ensure listeners are removed in dispose() to avoid leaks across the GameCanvas remount in tests.

**Cross-cutting.** Shares surface with the crosshair finding (#5) — both are center-screen, pointer-events:none overlays gated on 'world is interactive'. Build LookPrompt and the crosshair as one small overlay component (or sibling components sharing the same interactive-state gate) to avoid duplicating the paused/touch/locked predicate.

### 4. [minor] 'Show discovered markers' setting is opaque and exposes a design-removed feature
_Effort: S_

**Root cause.** SettingsMenu.tsx:103-114 renders a 'Show discovered markers' switch bound to settings.showDiscoveredMarkers, which only feeds NavSystem via buildGame.ts:226 — a nav-marker system the design doc removed (line 171). It surfaces an internal, spec-contradicting mechanic as a first-class setting with a label meaningless to new players.

**Solution.** Remove the toggle and its setting entirely as part of deleting the nav-marker subsystem (finding #1). Drop showDiscoveredMarkers from Settings, DEFAULTS, and the load() validator in settingsStore.ts; remove the SettingsMenu row (lines 103-114); remove the `() => settings.getSnapshot().showDiscoveredMarkers` argument at the NavSystem construction (which is itself deleted in finding #1). No rename/explain path — the spec keeps navigation on compass + clue text, so there is nothing to keep.

**Files.**
- `src/settings/settingsStore.ts (remove showDiscoveredMarkers from Settings, DEFAULTS, load())`
- `src/ui/SettingsMenu.tsx (remove the toggle row lines 103-114)`
- `src/buildGame.ts (removed with the NavSystem block, finding #1)`
- `src/settings/settingsStore.test.ts + src/ui/SettingsMenu.test.tsx (drop related cases)`

**Steps.**
1. As part of the finding #1 nav removal, delete the showDiscoveredMarkers field from the Settings interface + DEFAULTS + load() validator.
2. Remove the SettingsMenu 'Show discovered markers' row.
3. Remove/rename any settingsStore.test.ts and SettingsMenu.test.tsx assertions referencing showDiscoveredMarkers.
4. Run npm test + build to confirm no dangling references.

**Acceptance.** `grep -rn showDiscoveredMarkers src` returns nothing after the change. settingsStore.test.ts passes without that key; SettingsMenu.test.tsx no longer renders/asserts the toggle. Observable: the pause menu has no 'Show discovered markers' row.

**Risk.** Persisted settings with the old key are harmless — load() simply ignores unknown keys. No perf impact. Must land in the SAME PR as finding #1 to avoid a dangling settings getter passed to a deleted system.

**Cross-cutting.** This IS a strict subset of finding #1 (delete the nav-marker subsystem). Do not treat as an independent fix — the toggle removal is one of the deletion steps of the unified nav-marker removal.

### 5. [minor] Compass heading disappears while sprinting, exactly when traversing the island
_Effort: S_

**Root cause.** Hud.tsx:33-34 renders `{h.sprinting ? 'SPRINT' : h.compass}` in a single pill, so the cardinal heading is entirely replaced by the word SPRINT while Shift+W is held — dropping the compass during the exact movement where heading matters, contradicting the spec's 'compass strip top-center (cardinal letters only)' (design line 146).

**Solution.** Never hide the compass. Always render `h.compass` in the top-center pill, and express the sprint state as a separate, subordinate cue rather than by substitution — e.g. keep the existing `hud-mode--sprint` class as a color/emphasis change on the compass pill, and/or a small sprint glyph/badge next to it. The design says top-center is cardinal letters only, so prefer conveying sprint purely via the class-driven styling (color/glow) on the compass letter, not extra text. Remove the ternary text swap.

**Files.**
- `src/ui/Hud.tsx (replace the ternary at line 33-34 so the pill always shows h.compass; keep/adjust the hud-mode--sprint class for the sprint accent)`
- `src/tokens.css (ensure .hud-mode--sprint is a visual accent, not a layout/label change)`
- `src/ui/Hud.test.tsx (existing) — assert compass stays visible while sprinting`

**Steps.**
1. Change the pill to always render `{h.compass}` with `className={hud-mode + (h.sprinting ? ' hud-mode--sprint' : '')}`.
2. Style .hud-mode--sprint as a color/weight/glow accent so sprint reads without hiding the letter.
3. If a discrete sprint indicator is desired, add a tiny aria-hidden badge, but keep the cardinal letter as the pill's text.
4. Update Hud.test.tsx to assert the compass letter is present when sprinting=true.

**Acceptance.** src/ui/Hud.test.tsx: render with a HUD snapshot {sprinting:true, compass:'E'} and assert 'E' is in the document and 'SPRINT' is not. Observable: holding Shift+W keeps the cardinal letter visible with a sprint accent.

**Risk.** Trivial, no perf impact. Watch: the ux.mjs telemetry read 'SPRINT' as the pill text — any Playwright/smoke assertion keyed on that string must be updated to read the compass letter + a sprint class/attribute instead.

**Cross-cutting.** Same component/pill as the m/s speed-readout removal (finding #10) — both edit the top-center telemetry block in Hud.tsx; do them together.

### 6. [minor] No crosshair or center reticle in the first-person view
_Effort: S_

**Root cause.** No crosshair/reticle exists anywhere in src (grep confirms none); GameCanvas renders the canvas + HUD overlays but nothing at screen center, so there is no aim reference for look or for the forward-vector interactions (drink/dig), and combined with the sometimes-visible cursor the framing reads unfinished.

**Solution.** Add a small static CSS reticle (a 4-6px dot or thin plus) as a pointer-events:none, aria-hidden overlay centered via absolute positioning, shown whenever the world is interactive (not paused, and either pointer-locked on desktop or touchActive). Reuse the interactive-state predicate from the LookPrompt fix (finding #2) — ideally the same component renders both the reticle and the 'Click to look' cue, so there is one gate. Respect reduced motion by never animating it (a plain dot; no pulse). No WebGL, no geometry — pure DOM.

**Files.**
- `src/ui/LookPrompt.tsx (or a shared Crosshair/InteractiveOverlay component created in finding #2) — render the reticle`
- `src/tokens.css (.crosshair: centered, subtle, static)`
- `src/ui/LookPrompt.test.tsx / new Crosshair.test.tsx`

**Steps.**
1. Add a .crosshair rule: position absolute, top/left 50%, transform translate(-50%,-50%), small size, low-opacity light color with a subtle dark outline for legibility over foliage.
2. In the interactive overlay component, render the reticle when the world is interactive (locked or touchActive, and not paused).
3. Keep it aria-hidden and pointer-events:none so it never blocks world input or announces.
4. Confirm reduced-motion: no keyframes on the reticle at all.

**Acceptance.** Vitest (Crosshair/LookPrompt test): the reticle element is present when interactive and absent when paused. Observable in build: a subtle center dot appears once look is active and vanishes when the pause menu opens.

**Risk.** None — DOM only, zero draw calls/triangles/per-frame cost, so no perf-budget impact. Watch: keep it visually subtle so it doesn't fight the jungle art; ensure it is hidden while modals are open so it doesn't sit over the pause menu.

**Cross-cutting.** Directly coupled to finding #2 (pointer-lock affordance) — same center-screen interactive-overlay component and the same 'is the world interactive' gate. Implement both in one component/slice.

### 7. [minor] No look-sensitivity or invert-Y control for a pointer-lock first-person game
_Effort: M_

**Root cause.** MOUSE_SENS is a hardcoded const (input.ts:73) applied directly at onMouseMove (lines 164-165) with no override path; Settings (settingsStore.ts:12-18) carries only muted/quality/reducedMotion/showDiscoveredMarkers, and SettingsMenu exposes no sensitivity or invert control.

**Solution.** Add `lookSensitivity: number` (default 1.0, clamped ~0.25–3.0) and `invertY: boolean` (default false) to Settings + DEFAULTS + the load() validator (settingsStore.ts). Plumb them into input.ts via injected getters (same seam pattern as the existing shouldLock arg): add `getLookScale: () => number` and `getInvertY: () => boolean` params to createPlayerInput. Apply the scale to ALL look channels (mouse, touch, gamepad) so the setting is device-consistent: `look.dx += movementX * MOUSE_SENS * scale`; `look.dy += movementY * MOUSE_SENS * scale * (invertY ? -1 : 1)`. buildPlayer passes `() => settings.getSnapshot().lookSensitivity` and the invert getter. In SettingsMenu add a range slider (aria-valuetext) and an invert-Y switch mirroring the existing toggle rows.

**Files.**
- `src/settings/settingsStore.ts (Settings + DEFAULTS + load() validation for lookSensitivity/invertY)`
- `src/player/input.ts (add getLookScale/getInvertY params to createPlayerInput; apply in onMouseMove, touch onLook, gamepad readGamepad)`
- `src/player/buildPlayer.ts (thread settings getters into createPlayerInput)`
- `src/ui/SettingsMenu.tsx (sensitivity slider + invert-Y switch)`
- `src/settings/settingsStore.test.ts + src/ui/SettingsMenu.test.tsx + src/player/input.test.ts (coverage)`

**Steps.**
1. Extend Settings/DEFAULTS/load() with lookSensitivity (number, clamp) + invertY (boolean).
2. Add the two getter params to createPlayerInput with safe defaults (scale=1, invertY=false) so existing callers/tests are unchanged.
3. Apply scale + invert in the three look channels.
4. In buildPlayer, pass the settings-backed getters.
5. Add SettingsMenu slider + switch; label sensitivity with a numeric aria-valuetext.
6. Write input.test.ts case: with scale=2 a given movementX doubles look.dx; with invertY=true, dy sign flips.

**Acceptance.** src/settings/settingsStore.test.ts: persists + validates lookSensitivity/invertY, drops malformed values. src/player/input.test.ts: consumeLook reflects the scale multiplier and Y inversion. src/ui/SettingsMenu.test.tsx: slider change calls settings.set({lookSensitivity}); invert toggle flips invertY. Observable: dragging the slider changes turn speed live.

**Risk.** No perf impact (a multiply per look event). Watch: clamp sensitivity to avoid a zero/negative that freezes look; invert-Y applied uniformly could surprise gamepad users — acceptable, it is the standard meaning. Settings schema bump is backward-compatible via the load() validator defaulting missing keys.

**Cross-cutting.** Same settings-schema + SettingsMenu touch-points as findings #9 (remove marker toggle) and #6/#10 (HUD). Batch the settingsStore + SettingsMenu edits into one 'settings pass' slice to avoid three separate churns of the same two files.

### 8. [minor] Onboarding backdrop click neither dismisses the modal nor is guarded from grabbing pointer lock
_Effort: S_

**Root cause.** The onboarding backdrop (.onboarding-backdrop, Onboarding.tsx:62) has no onClick, unlike SettingsMenu.tsx:46-49 and RevealPanel.tsx:87-89 which close on backdrop click — an inconsistent modal contract. Worse, onboarding does not pause the sim (Onboarding.tsx:24-29 docstring) and input.ts's pointer-lock guard (lines 147-151) only excludes [role='dialog']/[role='menu'], not the backdrop, so a backdrop click passes shouldLock() (session not paused) and requestPointerLock fires, hiding the cursor while the dialog is still open.

**Solution.** Two-part fix. (1) Block pointer lock while onboarding is up: the cleanest seam is to route onboarding through the session pause flag OR extend the shouldLock gate. Since GameCanvas already tracks onboardingOpen and the input shouldLock is `() => !session.paused`, either add a 'onboarding' pause reason via session.setPaused('onboarding', true) while the overlay is open (which also makes InputPollSystem release any existing lock), or give the backdrop role='dialog' so the existing input.ts guard (line 151) excludes it. Prefer session pause — it is the honest state and reuses the existing release path. (2) Make the backdrop click behavior consistent: give .onboarding-backdrop an onClick that dismisses (calling the same dismiss()/markSeen for first-run, or just closing for the menu-opened view), matching SettingsMenu/RevealPanel.

**Files.**
- `src/ui/Onboarding.tsx (add backdrop onClick with the e.target===currentTarget guard; call dismiss())`
- `src/engine/GameCanvas.tsx (drive session.setPaused('onboarding', open) off the existing onOpenChange callback so lock is blocked + released while up)`
- `src/gameSession.ts (verify 'onboarding' is an acceptable pause reason / reason set)`
- `src/ui/Onboarding.test.tsx (backdrop-click dismiss + onOpenChange coverage)`

**Steps.**
1. Add `onClick={(e)=>{ if(e.target===e.currentTarget) dismiss(); }}` to the .onboarding-backdrop div (mirror SettingsMenu.tsx:47-49).
2. In GameCanvas, in the existing onOpenChange handler for Onboarding, call session.setPaused('onboarding', open) so shouldLock (=!paused) is false and InputPollSystem.releasePointerLock runs while it's up.
3. Confirm gameSession supports the reason (it is a keyed pause map per SettingsMenu docstring).
4. Add Onboarding.test.tsx cases: backdrop click closes; card click does not; onOpenChange fires true/false.

**Acceptance.** src/ui/Onboarding.test.tsx: fireEvent.click on the backdrop closes the overlay (dismiss called) while a click on the card does not. A GameCanvas/session assertion: while onboarding open, session.paused is true (so input.shouldLock returns false). Observable: clicking outside the card closes it and the cursor is never captured while it's open.

**Risk.** Low. Watch: pausing the sim during onboarding changes current behavior (the world runs behind it today) — this is intended and matches the spec's modal expectation, but confirm no test asserts the sim advances during onboarding. Ensure the pause reason is cleared on dismiss so the world resumes.

**Cross-cutting.** Same file/slice as findings #7, #11, #12 (all Onboarding/controlScheme). The pointer-lock-guard reasoning also touches the same input.ts shouldLock seam as finding #2 — both are about lock only engaging when the world is truly interactive.

### 9. [minor] Onboarding controls list omits the Journal (J) key
_Effort: S_

**Root cause.** KEYBOARD_ENTRIES (controlScheme.ts:41-51) lists W A S D / Mouse / Shift / Space / E / Esc but has no J entry; Onboarding.tsx:73-84 renders exactly that table, so J (which opens the journal holding every clue) is taught nowhere formal — only in the aria-hidden HUD strip (Hud.tsx:85) and the book-button tooltip (Hud.tsx:68).

**Solution.** Add a frozen `{ label: 'J', action: 'Journal' }` entry to KEYBOARD_ENTRIES, placed logically near E/Esc (e.g. after E, before Esc). Terse two-word style to match the list rhythm (see finding #12). No touch entry needed — touch has no J key and the journal book button is on the HUD.

**Files.**
- `src/ui/controlScheme.ts (add the J entry to KEYBOARD_ENTRIES)`
- `src/ui/controlScheme.test.ts (assert J present in keyboard scheme, absent from touch)`

**Steps.**
1. Insert `Object.freeze({ label: 'J', action: 'Journal' })` into KEYBOARD_ENTRIES after the E entry.
2. Update controlScheme.test.ts to assert the keyboard scheme includes a J/Journal entry and the touch scheme does not.

**Acceptance.** src/ui/controlScheme.test.ts: resolveControlScheme('keyboard').entries contains an entry with label 'J' and action 'Journal'; resolveControlScheme('touch') does not. Rendered onboarding (Onboarding.test.tsx) shows a J row for keyboard channel.

**Risk.** None. Watch: any test that pins the exact keyboard entry count/order (controlScheme.test.ts) must be updated to +1.

**Cross-cutting.** Same file and slice as findings #7, #8, #12 (onboarding/control-scheme pass). Land all control-scheme copy/entry edits together.

### 10. [minor] Onboarding is one-time-only with no way to review controls afterward
_Effort: M_

**Root cause.** Onboarding open state is `!seen()` and markSeen() persists forever (Onboarding.tsx:41,56-58; onboardingPersistence.ts), and SettingsMenu has no controls/help entry, so after the first dismissal the only reference is the aria-hidden bottom HUD strip (Hud.tsx:85). A player returning via a shared link days later has no on-demand controls reference.

**Solution.** Add a 'How to play' / 'Controls' entry to the pause menu that re-opens the onboarding content on demand, decoupled from the persisted first-run flag. Refactor the controls-list rendering out of Onboarding into a reusable presentational component (e.g. ControlsList consuming resolveControlScheme) so both first-run onboarding and the menu-triggered view share one source of truth. Drive visibility with a `forceOpen` prop (or lift open state to GameCanvas): first-run opens from !seen(); the menu's button sets a state that opens the same overlay without touching the seen flag. Reuse the existing onOpenChange seam so Escape handling stays gated while it's up.

**Files.**
- `src/ui/Onboarding.tsx (accept a controlled/forceOpen prop; extract the controls list)`
- `CREATE src/ui/ControlsList.tsx (shared control-scheme renderer) OR keep inside Onboarding and expose an open control`
- `src/ui/SettingsMenu.tsx (add a 'How to play' button calling a new onShowControls callback)`
- `src/engine/GameCanvas.tsx (own the 'controls overlay open' state; pass to Onboarding + wire the menu button; keep onboardingOpen Escape guard)`
- `src/ui/SettingsMenu.test.tsx + src/ui/Onboarding.test.tsx (coverage)`

**Steps.**
1. Extract the lede+controls-list JSX into a shared renderer keyed off resolveControlScheme(channel).
2. Add a controlled-open path to Onboarding (prop) that does NOT call markSeen on close when opened from the menu.
3. Add onShowControls to SettingsMenuProps + a 'How to play' button; on click, close the menu and open the controls overlay.
4. In GameCanvas, hold `controlsOpen` state, pass it to Onboarding's controlled prop, and set it from the menu callback.
5. Ensure onOpenChange still fires so Escape opens/menu handling stays correct.

**Acceptance.** src/ui/SettingsMenu.test.tsx: clicking 'How to play' invokes onShowControls. src/ui/Onboarding.test.tsx: with seen()=true it renders nothing by default but renders when forced open, and closing the forced view does NOT call markSeen. Observable: dismiss onboarding, open pause menu, click How to play → the controls list reappears.

**Risk.** UI only. Watch: the Escape-precedence guards in GameCanvas (onboardingOpen at lines 407) must treat the menu-opened controls view the same way so Esc closes it cleanly; avoid a state where both menu and controls overlay are open at once (close the menu when opening controls).

**Cross-cutting.** Overlaps findings #8 and #12 (Onboarding modal contract + Space copy) and #11 (add J key) — all touch Onboarding/controlScheme. Batch the onboarding fixes into one slice so the extracted ControlsList lands once and all copy/behavior fixes ride together.

### 11. [polish] No fullscreen affordance for a pointer-lock browser game
_Effort: S_

**Root cause.** grep for requestFullscreen/fullscreen in src finds only shader jargon in createCompositor.ts — there is no UI control, so a pointer-lock FP experience runs inside the windowed tab with browser chrome.

**Solution.** Add a fullscreen toggle using the Fullscreen API, guarded for Safari's webkit-prefixed variant and for absence (jsdom/SSR). Two placement options; recommend the pause menu (a persistent, discoverable home) plus optionally the title CTA. Add a small helper (e.g. src/ui/fullscreen.ts) exposing `toggleFullscreen(el)` and `isFullscreen()` that call element.requestFullscreen?.() / document.exitFullscreen?.() with the webkit fallbacks, swallowing rejections (fullscreen requires a user gesture — the button click satisfies it). Wire a 'Fullscreen' switch in SettingsMenu targeting the game-canvas container (containerRef in GameCanvas). Keep it defensive: if requestFullscreen is undefined, hide or disable the control.

**Files.**
- `CREATE src/ui/fullscreen.ts (+ test) — toggleFullscreen/isFullscreen with webkit + absence guards`
- `src/ui/SettingsMenu.tsx (add a Fullscreen switch; needs a target element callback)`
- `src/engine/GameCanvas.tsx (pass containerRef.current as the fullscreen target to SettingsMenu)`
- `src/ui/SettingsMenu.test.tsx (mock requestFullscreen; assert wiring)`

**Steps.**
1. Write fullscreen.ts: `toggleFullscreen(el)` → if document.fullscreenElement || webkitFullscreenElement, exit; else el.requestFullscreen?.() ?? webkit variant; wrap in try/catch and swallow promise rejection.
2. Add isFullscreen() reading document.fullscreenElement/webkit equivalent.
3. Add a Fullscreen switch to SettingsMenu that calls toggleFullscreen(target); reflect state via a fullscreenchange listener.
4. In GameCanvas, hand SettingsMenu a `() => containerRef.current` target.
5. Test with a stubbed requestFullscreen on a fake element.

**Acceptance.** src/ui/fullscreen.test.ts: toggleFullscreen calls el.requestFullscreen when not fullscreen and document.exitFullscreen when it is, and does not throw when the API is absent. SettingsMenu.test.tsx: clicking the Fullscreen switch calls the injected toggle. Observable: clicking Fullscreen expands the game to fill the screen.

**Risk.** No perf/geometry impact. Watch: fullscreen requires a user gesture (the button click provides it); iOS Safari has limited/absent element fullscreen — guard and hide the control when unsupported rather than showing a dead switch. Fullscreen + pointer lock interaction: entering fullscreen can drop lock; the finding #2 affordance already handles re-grab on next click.

**Cross-cutting.** Touches SettingsMenu, same file as findings #3/#4/#7/#9 — fold into the settings-pass slice. If a mobile/on-device audit also flags fullscreen, note the iOS Safari support caveat is shared.

### 12. [polish] The 'Space — swim' onboarding row is a long run-on inconsistent with the terse control list
_Effort: S_

**Root cause.** The Space entry in KEYBOARD_ENTRIES (controlScheme.ts:45-48) has a two-clause sentence action ('Swim up — in the lagoon you swim where you look; the river's current is not your friend') while every other row is one or two words, so it overflows to three lines and buries a mechanic tip in a controls reference.

**Solution.** Shorten the Space action to 'Swim up' to restore the scannable key/action rhythm. Move the lagoon/current guidance into the onboarding lede (Onboarding.tsx:67-71, which already covers survival tips) or a single separate tip line below the controls list — not inside the terse entry. This keeps the mechanic tip discoverable without breaking the list format.

**Files.**
- `src/ui/controlScheme.ts (Space entry action → 'Swim up')`
- `src/ui/Onboarding.tsx (add the current/lagoon guidance to the lede or a tip line)`
- `src/ui/controlScheme.test.ts + src/ui/Onboarding.test.tsx (coverage)`

**Steps.**
1. Change the Space entry action to 'Swim up'.
2. Append the swim-direction/current caveat to the onboarding lede sentence, or add one `<p className='onboarding__tip'>` under the list.
3. Update controlScheme.test.ts if it asserts the old Space string; verify Onboarding renders the tip.

**Acceptance.** src/ui/controlScheme.test.ts: the Space entry action equals 'Swim up'. Observable / Onboarding.test.tsx: the controls list rows are all short and the current/lagoon guidance appears in the lede or a tip line, not inside the Space row (contrast scratchpad/ux/02-onboarding.png 3-line row).

**Risk.** None. Watch: a test asserting the exact old Space action string must be updated.

**Cross-cutting.** Same controlScheme.ts/Onboarding.tsx slice as findings #7, #8, #11 — do the onboarding copy + J-key + modal fixes together.

### 13. [polish] Vehicle-era speed readout (m/s) persists on the walking survival HUD
_Effort: S_

**Root cause.** Hud.tsx:36-40 renders `<span class='hud-stat__value'>{h.speed}</span> m/s` next to the compass — a leftover from the drive/fly rig, and the component docstring (Hud.tsx:15-24) still describes DRIVE/FLY mode, speed and altitude. The design asks for a top-center compass with cardinal letters only (design line 146); raw m/s is non-diegetic noise for a walking explorer.

**Solution.** Remove the speed stat block from the HUD (Hud.tsx:36-40) and rewrite the stale docstring (lines 14-24) to describe the actual survival HUD (compass strip, pages badge, journal/menu buttons). Optionally stop the HudSystem from writing `speed` — but since hudStore already throttles and speed no longer renders, the minimal change is UI-only; a follow-up can drop `speed` from HudSnapshot/HudSystem if nothing else reads it (grep to confirm). Keep compass (finding #6 keeps it visible while sprinting).

**Files.**
- `src/ui/Hud.tsx (remove the hud-stat speed span lines 36-40; fix the docstring)`
- `src/tokens.css (remove now-unused .hud-stat rules if orphaned)`
- `src/ui/Hud.test.tsx (remove/adjust speed assertions)`
- `(optional follow-up) src/ui/hudStore.ts + src/ui/HudSystem.ts if `speed` becomes dead`

**Steps.**
1. Delete the speed <span> block from Hud.tsx.
2. Rewrite the component docstring to reflect the survival HUD (no DRIVE/FLY/speed/altitude).
3. Grep for `.speed`/hud-stat usage; if the speed field is now unread, note a follow-up to drop it from HudSnapshot (keep this slice UI-only unless trivial).
4. Update Hud.test.tsx to stop asserting 'm/s'.

**Acceptance.** src/ui/Hud.test.tsx: rendered HUD contains no 'm/s' text. Observable: the top-center pill shows only the compass letter (contrast scratchpad/ux/03-hud-spawn.png 'E 0 m/s').

**Risk.** Trivial. Watch: any Playwright/smoke or Hud.test.tsx assertion keyed on 'm/s' or hud-stat. Removing the speed field from the store is optional and should only follow a grep proving no other reader.

**Cross-cutting.** Same Hud.tsx top-center block as finding #6 (keep compass while sprinting). Do both in one HUD-cleanup slice.

---

## Accessibility & Comfort  
_13 solutions_

### 1. [MAJOR] Modal dialogs do not trap focus — Tab escapes to background HUD
_Effort: M_

**Root cause.** SettingsMenu.tsx:35-42, DeathOverlay.tsx:23-25, RevealPanel.tsx:57-67 and Onboarding.tsx:45-47 each only set initial focus + an Escape handler; none wrap Tab, and the background HUD buttons (Hud.tsx:64-81) stay focusable, so Tab leaks onto them (and the dev StatsOverlay). JournalPanel.tsx:26-98 is the sole correct implementation — it has a focusable()+Tab-wrap trap.

**Solution.** Extract JournalPanel's proven trap into a reusable useFocusTrap(dialogRef, { onEscape }) hook in a new src/ui/useFocusTrap.ts — lift focusable() (JournalPanel.tsx:26-32) and the Tab/Shift+Tab wrap + escaped-focus pull-back (JournalPanel.tsx:74-95) verbatim, plus seat-focus-on-open and return-focus-to-opener-on-unmount (capture document.activeElement at mount, restore in cleanup). Apply the hook in SettingsMenu, DeathOverlay, RevealPanel and Onboarding, and refactor JournalPanel to consume the same hook (removing its inline duplicate) so there is one implementation. Do not touch the background inert story separately — a wrapping Tab trap is sufficient and simplest; optionally add aria-hidden to the HUD when any modal is open as a belt-and-braces follow-up.

**Files.**
- `src/ui/useFocusTrap.ts (new — extracted from JournalPanel)`
- `src/ui/JournalPanel.tsx (replace inline trap with the hook)`
- `src/ui/SettingsMenu.tsx (use the hook; keep resumeRef as the initial focus target)`
- `src/ui/DeathOverlay.tsx (use the hook)`
- `src/ui/RevealPanel.tsx (use the hook, preserving the guess→first-option initial focus)`
- `src/ui/Onboarding.tsx (use the hook)`

**Steps.**
1. Create useFocusTrap.ts: accept a ref, an onEscape callback, and an optional initialFocus selector/ref; on mount capture the opener, seat focus, add a keydown handler doing Escape + Tab-wrap; on unmount restore focus to the opener.
2. Refactor JournalPanel to call the hook and delete its inline focusable()/Tab logic (keep behaviour identical).
3. Wire the hook into SettingsMenu, DeathOverlay, RevealPanel, Onboarding, mapping each component's existing initial-focus ref into the hook.
4. Verify precedence still holds (only the topmost modal's handler runs — the GameCanvas.tsx:386-415 opener already defers).

**Acceptance.** New src/ui/useFocusTrap.test.tsx and per-dialog assertions extending SettingsMenu.test.tsx / RevealPanel.test.tsx / Onboarding.test.tsx: render the dialog with a focusable sibling 'HUD' button in the DOM, fire Tab from the last focusable inside — assert focus stays inside the dialog and never lands on the sibling; fire Shift+Tab from the first — assert wrap to last. Assert focus returns to the opener element on unmount. (Model the assertions on JournalPanel.test.tsx's existing trap test.)

**Risk.** Low, no perf impact. Regression: window-level keydown listeners can stack when modals briefly overlap — keep the GameCanvas precedence guards (it already prevents two modals opening). Ensure RevealPanel's guess-vs-close initial-focus rule (RevealPanel.tsx:57-60) is preserved through the hook's initialFocus option. DeathOverlay currently has a single button so the trap is trivial but still closes the WCAG gap.

**Cross-cutting.** This is the a11y-focus counterpart to any 'keyboard navigation / WCAG 2.4.3' findings that may appear under a ux audit — the single useFocusTrap hook resolves all modal focus-leak instances at once.

### 2. [MAJOR] OS prefers-reduced-motion is ignored by all in-world motion (head-bob, FX)
_Effort: S_

**Root cause.** settingsStore.ts:27-32 DEFAULTS.reducedMotion=false and load() (settingsStore.ts:61-80) falls back to that default when the persisted key/field is absent — it never consults the OS. World motion (fpCamera.ts:47 reads this.motion.getSnapshot().reducedMotion; motes/rain/bursts/beacon read the same store) is therefore full-on for a motion-sensitive user until they find the in-game toggle. reducedMotion.ts:14-19 deliberately keeps the OS media query as a CSS-only signal, so WebGL motion never sees it.

**Solution.** Seed the store's reducedMotion default from the OS at construction. Add an optional osReducedMotion boolean param (or a small readEnv() guard mirroring controlScheme.ts:88-94) to createSettingsStore, and in load(), when the persisted object has no reducedMotion field, use that OS-derived value instead of the hard-coded false. Crucially: a persisted explicit user choice still wins (so a user who turned it OFF is respected), and only the *first-run / never-set* case inherits the OS. Wire it by passing window.matchMedia('(prefers-reduced-motion: reduce)').matches as the default at the buildGame.ts:112 construction site (guarded for jsdom/SSR). Because the world reads the store live, seeding the store gates head-bob (fpCamera.ts:50) and every FX/beacon consumer for free, with no per-consumer change.

**Files.**
- `src/settings/settingsStore.ts (createSettingsStore signature + load(): honour an OS-seeded default for the unset case; add a guarded readOsReducedMotion() helper)`
- `src/buildGame.ts:112 (pass the OS signal into createSettingsStore)`
- `src/engine/GameCanvas.tsx:157 (the throwaway quality-read store — leave as-is or reuse the same seed; only quality is read there)`

**Steps.**
1. Add readOsReducedMotion(): boolean to settingsStore.ts, guarding typeof window/matchMedia (copy the controlScheme.ts readEnv guard).
2. Change DEFAULTS resolution in load(): when parsed.reducedMotion is not a boolean (or no stored key), use the OS seed rather than DEFAULTS.reducedMotion.
3. Thread an optional osReducedMotion default param through createSettingsStore so tests can inject it deterministically.
4. At buildGame.ts:112 pass readOsReducedMotion() (or leave default arg to call it) so the real store seeds from the OS.
5. Confirm fpCamera and FX still read the store unchanged (no consumer edits needed).

**Acceptance.** Extend src/settings/settingsStore.test.ts: with empty storage and injected osReducedMotion=true, getSnapshot().reducedMotion===true; with a persisted {reducedMotion:false}, it stays false even when OS=true (explicit choice wins); with a persisted true and OS=false, stays true. Observable: with the OS set to reduce and no prior save, head-bob is off on first load (fpCamera.ts:50 branch skipped).

**Risk.** Low. No perf impact. Regression to watch: do NOT overwrite an explicit persisted choice with the OS value — only seed the unset case, or a user who deliberately enabled full motion would get it stripped on every reload. Keep the CSS media-query path in reducedMotion.ts intact (it already covers pure-CSS UI motion); this change adds the WebGL/store path.

**Cross-cutting.** Same reducedMotion gate must be respected by the new threat vignette and damage flash overlays (findings 1 and 12) — those must check both @media(prefers-reduced-motion) and :root[data-reduced-motion] like tokens.css:452-455.

### 3. [MAJOR] Wildlife danger warnings are audio-only — no HUD/visual alternative
_Effort: L_

**Root cause.** The only consumers of the danger edges are AudioSystem.ts:351-358, which call engine.snakeAlert()/engine.growl() on the rising edges of snakes.anyAlert() and jaguar.isStalking(). No store or React component mirrors that threat state — grep of src/ui for the threat predicates returns nothing, and GameCanvas.tsx:456-529 has no threat overlay. The threat data exists and is cheap to read: jaguar.isStalking() (jaguar.ts:589), snakes.anyAlert() (snakes.ts:311), plus positions (jaguar describe().at / snakes.positions() at snakes.ts:320) for direction, but nothing surfaces it visually.

**Solution.** Introduce a DI-injected observable threatStore (same cached-snapshot/useSyncExternalStore idiom as hudStore.ts/navStore.ts) whose snapshot is { level: 0|1|2, kind: 'snake'|'jaguar'|null, bearing: number|null }. Write it from a tiny ThreatSystem registered in buildGame that each frame polls jaguar.isStalking()/snakes.anyAlert() and, for direction, computes a screen-relative bearing from the nearest active threat's world position, the explorer position and the camera yaw (reuse cameraEulerYFromYaw from explorer.ts). Render a ThreatOverlay React component: a CSS-only pulsing edge vignette (a fixed full-screen div with a radial-gradient inset box-shadow, opacity driven by level) plus a directional danger chevron pinned to the rim at the computed bearing (mirror NavMarkers' EdgeArrow rim-placement math). Gate the pulse animation behind both reduced-motion signals (keep a static, non-animated vignette when reduced) so it survives reduced motion. Add a dialog-free polite sr-only live region that announces 'Snake nearby' / 'Predator stalking' once per rising edge (guarded by a prev-kind ref, like GuessBody in RevealPanel.tsx:237). This is a pure DOM/CSS overlay — zero WebGL geometry, draws, or passes.

**Files.**
- `src/ui/threatStore.ts (new — observable store, mirror src/ui/hudStore.ts)`
- `src/ui/ThreatSystem.ts (new — System that polls jaguar/snakes + explorer/camera and writes threatStore)`
- `src/ui/ThreatOverlay.tsx (new — vignette + directional chevron + polite live region)`
- `src/buildGame.ts (register ThreatSystem after wildlife+camera; expose threat store on the Game handle)`
- `src/engine/GameCanvas.tsx (GameHandle: add threat?; mount <ThreatOverlay> in the game overlay tree ~line 498)`
- `src/tokens.css (new .threat-vignette / .threat-chevron rules + reduced-motion gates mirroring .meter--low at 444-455)`

**Steps.**
1. Create threatStore.ts with getSnapshot/subscribe/set and a cached snapshot object; set() only re-allocates when level/kind/bearing change (throttle like hudStore.set).
2. Create ThreatSystem: constructor takes {isStalking}, {anyAlert}+{positions}, explorer state, engine camera; update() derives level (2=jaguar stalk, 1=snake alert, 0=none), picks nearest active threat position for bearing = atan2 in screen space relative to camera yaw, writes threatStore.
3. Register ThreatSystem in buildGame after wildlife and the camera system so it reads post-update positions; add threat:{store} to the returned Game.
4. Add threat? to GameHandle in GameCanvas.tsx and render <ThreatOverlay threat={game.threat.store}/> in the game block.
5. Build ThreatOverlay: vignette div (opacity from level), directional chevron via EDGE_INSET ellipse math copied from NavMarkers.tsx:42-43, and a polite sr-only region announcing on rising kind edges.
6. Add tokens.css classes; put the pulse under @keyframes with both @media(prefers-reduced-motion) and :root[data-reduced-motion=true] disabling the animation but leaving a static vignette.

**Acceptance.** New Vitest RTL test src/ui/ThreatOverlay.test.tsx: render with a fake threatStore, assert (a) a level>0 snapshot shows the vignette element and a chevron with the expected rim transform, level 0 hides them; (b) the sr-only live region text updates to 'Predator stalking' on a null→jaguar transition and does not re-announce on an unrelated re-render. Plus src/ui/ThreatSystem.test.ts driving fake jaguar/snakes/explorer and asserting the written store level+bearing (mirror NavSystem.test.ts fake-camera pattern).

**Risk.** PERF: pure DOM/CSS overlay like the existing lens-rain (GameCanvas.tsx:464) — zero draw calls, one extra per-frame store write already gated by change-detection; no WebGL budget impact. ThreatSystem adds a small per-frame CPU poll (two boolean reads + one atan2) — negligible. Watch: don't double-announce (guard edges); ensure ThreatSystem registers AFTER the camera system so bearing uses the current-frame view. Shares the CSS-vignette infrastructure with the damage-feedback finding — build the overlay primitive once.

**Cross-cutting.** The screen-edge CSS vignette primitive here is the same mechanism needed by 'Taking damage has no on-screen feedback'. Build one reduced-motion-gated .screen-edge-flash primitive and drive it from two sources (threat level and health-drop edge) rather than two bespoke overlays.

### 4. [minor] HUD telemetry is a polite live region — screen-reader chatter while moving
_Effort: S_

**Root cause.** Hud.tsx:32 wraps the compass+speed cluster in role=status aria-label='explorer status', and hudStore emits on any rounded speed/heading/sprint change (hudStore.ts:59-70). A screen reader therefore re-announces on every 1 m/s or compass-sector change during normal play.

**Solution.** Remove role=status and the aria-label from the telemetry div so it becomes a plain visual label, not a live region — the speed/compass are ambient, non-critical readouts that a SR user does not need spoken continuously. This is the simplest correct fix and matches the codebase's own single-live-region discipline (the discovery announcer at DiscoveryAnnouncer is the intended polite region; Hud.tsx:43-50 already notes the badge is deliberately NOT a live region to avoid double-announce). No store changes needed — the throttling in hudStore stays; it just no longer feeds an announcer.

**Files.**
- `src/ui/Hud.tsx:32 (drop role=status + aria-label='explorer status'; keep the visual cluster)`

**Steps.**
1. Remove role="status" and aria-label from the .hud-telemetry div; optionally keep a static aria-label on child spans only if a SR user should be able to query them on demand (non-live).
2. Confirm no test asserts the live-region role.

**Acceptance.** Extend src/ui/Hud.test.tsx: assert the telemetry element has no role=status / aria-live, i.e. querying by that role returns nothing while the visual speed/compass text still renders. Observable: a screen reader no longer announces 'explorer status' while walking/turning.

**Risk.** Trivial, no perf impact. Regression: ensure removing the label doesn't hide genuinely useful directional info from SR users — that gap is addressed by the nav-marker AT cue (finding 11), which is the right place for on-demand wayfinding rather than constant telemetry chatter.

### 5. [minor] Nav markers are aria-hidden and carry no landmark identity
_Effort: M_

**Root cause.** NavMarkers.tsx:25 sets the whole wrapper aria-hidden='true' (no AT wayfinding), and NavSystem.ts:55 sets label to distance only (`${Math.round(dist)} m`); markers differ solely by --nav-color (NavMarkers.tsx:33,48), and those hues are unexplained and not colourblind-distinct.

**Solution.** IMPORTANT: honour the design pillar 'navigate by reading the world, not GPS markers' (design spec) before enriching markers — the right fix is not to make the GPS HUD louder but to give it identity where it exists and an on-demand AT cue, without turning it into a persistent turn-by-turn readout. Concretely: (1) sighted differentiation beyond colour — add a distinct shape/glyph or the landmark's short name to each marker (NavSystem already has poi.title upstream via DiscoverablePoi; thread a name/shape token into NavMarker and render it), so simultaneous markers are distinguishable without relying on hue. (2) AT wayfinding — instead of un-hiding the whole per-frame marker layer (which would chatter), add ONE on-demand, non-live element (or a key-triggered polite announcement) that reads 'nearest clue: <name>, <distance>, <direction>' derived from the nav data, so a SR user can query heading without constant speech. Keep the visual markers aria-hidden; the single cue is the accessible seam.

**Files.**
- `src/ui/navStore.ts (NavMarker: add name and/or shape token)`
- `src/ui/NavSystem.ts:55 (set label/name from poi.title; keep distance separate)`
- `src/ui/NavMarkers.tsx (render name/shape; add colourblind-distinct glyphs)`
- `src/ui/NavAnnouncer.tsx (new — an on-demand/throttled polite 'nearest clue' cue, sibling of DiscoveryAnnouncer)`
- `src/content/discoverablePois.ts (ensure a short display name is available to NavSystem)`

**Steps.**
1. Add name (and optionally a shape enum) to NavMarker; populate it in NavSystem from the POI title, distinct from the distance label.
2. Render the name/shape in NavMarkers so markers differ by more than hue; pick 3+ distinguishable glyph shapes for colourblind users.
3. Create NavAnnouncer: derive the nearest undiscovered marker's name+distance+compass direction and announce it politely, either on demand (a key) or heavily throttled (only when the nearest target changes), NOT every frame.
4. Wire NavAnnouncer into GameCanvas as a single sibling live region.
5. Confirm the visual marker layer stays aria-hidden so only the one announcer speaks.

**Acceptance.** src/ui/NavSystem.test.ts: assert markers carry a name derived from the POI, not just distance. src/ui/NavMarkers.test.tsx: assert two markers render distinguishable shape/name, not only colour. New NavAnnouncer test: on nearest-target change it announces 'nearest clue: <name>, N m, <dir>' exactly once (guarded like DiscoveryAnnouncer/GuessBody).

**Risk.** Low, no WebGL/perf impact (DOM only). Regression: do NOT make the marker layer a live region — that reintroduces the chatter this file already avoids for the HUD (finding 9). Respect the design pillar: the AT cue should aid, not replace, reading-the-world navigation — keep it terse/on-demand.

**Cross-cutting.** The GPS nav-marker concern is the same root issue flagged across gameplay/story/ux/world audits ('navigate by reading the world, not GPS markers'). The unified fix is: give markers real landmark identity + a single on-demand AT wayfinding cue, and NOT amplify them into a persistent GPS. Coordinate with those areas so the marker model changes once; this accessibility slice adds the name/shape/AT-cue and defers any 'reduce reliance on markers' gameplay change to that shared thread.

### 6. [minor] No FOV control for a first-person game (fixed 60°)
_Effort: M_

**Root cause.** The camera is constructed with a literal FOV at GameCanvas.tsx:196 (new THREE.PerspectiveCamera(60, 1, 0.1, 2000)) and Settings (settingsStore.ts:12-18) has no fov field, so SettingsMenu.tsx exposes no control. There is no data path from a setting to camera.fov.

**Solution.** Add a persisted numeric fov to Settings (default 60, clamped 60–100 on load like isQuality validates quality). Apply it at camera construction (GameCanvas.tsx:196 read settings.getSnapshot().fov) AND live: add an effect in GameCanvas subscribed to the settings store that sets camera.fov and calls camera.updateProjectionMatrix() on change (mirror the existing quality-apply effect at GameCanvas.tsx:303-320). Surface it in SettingsMenu as a range slider (a labelled <input type=range min=60 max=100 step=5> with the value shown), writing settings.set({fov}). Changing FOV is free — it only alters the projection matrix, adding no geometry, draws, or passes.

**Files.**
- `src/settings/settingsStore.ts (Settings: add fov:number; DEFAULTS.fov=60; load() clamp/validate; a clampFov helper)`
- `src/ui/SettingsMenu.tsx (add an FOV range row under Quality)`
- `src/engine/GameCanvas.tsx (read fov at camera build ~196; add a settings-subscribed effect that sets camera.fov + updateProjectionMatrix, mirroring the 303-320 quality effect)`

**Steps.**
1. Add fov to Settings/DEFAULTS with a clampFov(v)=min(100,max(60,round)) used in load().
2. Read fov at PerspectiveCamera construction in GameCanvas.tsx.
3. Add a useEffect subscribed to game.settings that applies fov to the live camera and calls updateProjectionMatrix().
4. Add the SettingsMenu range control with aria-label 'Field of view' and a visible degree readout.
5. Persist via settings.set({fov}).

**Acceptance.** settingsStore.test.ts: fov persists and clamps out-of-range/malformed values to 60–100. SettingsMenu.test.tsx (mirror the existing switch tests): moving the slider calls settings.set with the new fov. Observable: dragging the slider widens/narrows the view live without reload.

**Risk.** Low. Zero perf-budget impact (projection-matrix only). Regression: a very wide FOV increases fill/overdraw marginally on low tier — clamp at 100 keeps it safe; the frustum change can pull slightly more props into view but within the existing prop budget. Ensure the live effect also runs once on mount to apply a restored value.

### 7. [minor] No input remapping and no left-handed layout
_Effort: M_

**Root cause.** settingsStore has no handedness/keybinding fields; input.ts:307-309 hard-codes JOYSTICK_ZONE_FRACTION=0.45 and onOverlayPointerDown (input.ts:375-392) always treats the left share as the joystick zone. controlScheme.ts:41-51 is a static table. So the touch stick side is fixed and keys are fixed.

**Solution.** Scope to the high-value, low-risk half: a persisted left-handed touch toggle. Add handedness:'left'|'right' to Settings (default 'left' = current). Thread it into createTouchControls so the joystick zone test flips: instead of `clientX-left < width*FRACTION` for the stick, when handedness==='right' the stick zone is the RIGHT share (`clientX-left > width*(1-FRACTION)`) and look is the left. Pass a live getter (settings.getSnapshot().handedness) into createPlayerInput/createTouchControls so it can change without rebuild. Surface a 'Left-handed controls' switch in SettingsMenu (only meaningful on touch, but harmless on desktop). Defer full key remapping as a separate XL slice — it needs a keybinding model, a capture UI and conflict handling, and the arrow-key mirror + gamepad already give partial keyboard alternatives (input.ts:129-132).

**Files.**
- `src/settings/settingsStore.ts (add handedness field + validation)`
- `src/player/input.ts (JOYSTICK_ZONE_FRACTION zone test in onOverlayPointerDown reads handedness; pass a getter through createPlayerInput/createTouchControls)`
- `src/buildGame.ts (pass settings handedness getter into buildPlayer/input)`
- `src/ui/SettingsMenu.tsx (add the Left-handed switch)`

**Steps.**
1. Add handedness to Settings/DEFAULTS ('left') with string validation in load().
2. Change onOverlayPointerDown's inJoystickZone computation to branch on the injected handedness getter.
3. Thread the getter from buildGame → buildPlayer → createPlayerInput → createTouchControls.
4. Add the SettingsMenu switch writing settings.set({handedness}).
5. Leave the touch-look zone as the complement of the stick zone so the two never overlap.

**Acceptance.** settingsStore.test.ts: handedness persists/validates. A new input.ts unit test (or extend an existing input test) firing a synthetic touch pointerdown in the right share asserts the joystick spawns there when handedness==='right' and look otherwise. Observable on a touch device: flipping the toggle moves the floating stick to the right thumb.

**Risk.** Low, no perf impact. Regression: ensure the zone flip keeps stick and look zones mutually exclusive (no dead band or overlap); guard that changing handedness mid-touch doesn't reassign an in-flight pointer (only new pointerdowns consult it). Full keybinding remap is intentionally out of scope — flag as a follow-up so the finding isn't over-built.

### 8. [minor] No text-size / UI-scale option; several sub-11px HUD labels
_Effort: M_

**Root cause.** settingsStore has no scale field; the persistent .discovery-remaining line is 0.65rem (~10.4px) at tokens.css:870, and .hud-stat__unit is 0.7rem (tokens.css:836), below a comfortable low-vision minimum with no enlargement path.

**Solution.** Two parts. (1) Immediately raise the smallest persistent labels: bump .discovery-remaining and .hud-stat__unit to >=0.75rem (12px) — a one-line CSS fix with negligible layout impact. (2) Add a persisted uiScale setting (e.g. 'normal'|'large', or a 0.9–1.3 multiplier) applied by setting a CSS custom property (--ui-scale) on the shell root and expressing HUD font-sizes in terms of it (font-size: calc(base * var(--ui-scale))), or simpler, a data-attribute on <html> that tokens.css keys off (mirror the data-reduced-motion pattern in reducedMotion.ts:16-20). Surface it as a segmented control in SettingsMenu. Pure CSS/DOM — no WebGL cost.

**Files.**
- `src/tokens.css:870 and :836 (raise the two sub-12px sizes; add --ui-scale-driven rules or a :root[data-ui-scale=large] block)`
- `src/settings/settingsStore.ts (add uiScale + validation)`
- `src/settings/uiScale.ts (new — a data-attribute applier mirroring reducedMotion.ts) or reuse the reducedMotion bridge pattern`
- `src/engine/GameCanvas.tsx (apply uiScale to <html> like useReducedMotion at 322-324)`
- `src/ui/SettingsMenu.tsx (a Text size segmented control)`

**Steps.**
1. Raise .discovery-remaining and .hud-stat__unit to >=0.75rem.
2. Add uiScale to Settings/DEFAULTS + validation.
3. Add a useUiScale hook/applier that reflects the setting onto <html data-ui-scale> (copy reducedMotion.ts:27-39).
4. Add tokens.css rules scaling HUD label sizes under [data-ui-scale='large'].
5. Add the SettingsMenu segmented control.

**Acceptance.** src/tokens.css.test.ts (existing CSS-assertion suite): assert no persistent HUD label is below 0.75rem, and that [data-ui-scale='large'] increases the HUD font-size custom property. settingsStore.test.ts: uiScale persists. SettingsMenu.test.tsx: the control writes settings.set({uiScale}).

**Risk.** Low, no perf impact. Regression: enlarging text can overflow the fixed HUD clusters and touch safe-area layouts — verify against the mobile safe-area/dvh CSS tests (tokens.mob2.*.test.ts) and cap the scale so the top-right badge/menu buttons don't collide.

### 9. [minor] Onboarding/tutorial does not pause the sim — slow readers take damage while learning
_Effort: S_

**Root cause.** Onboarding.tsx:26-29 documents that it does NOT pause, and GameCanvas.tsx:511 mounts <Onboarding onOpenChange={setOnboardingOpen}> without any session.setPaused — only menu/journal/reveal set pause reasons (GameCanvas.tsx:329-339). So hunger/thirst keep draining (SurvivalSystem.ts:138-152) behind the first-run overlay.

**Solution.** Add a fourth pause-reason effect in GameCanvas mirroring the menu/journal ones: useEffect(() => game?.session.setPaused('onboarding', onboardingOpen), [game, onboardingOpen]). onboardingOpen is already tracked (GameCanvas.tsx:140, fed by Onboarding's onOpenChange). This reuses the session's reason-Set so onboarding coexists with (and is independent of) other reasons, and resumes exactly when the overlay dismisses. Update the stale Onboarding.tsx:26-29 doc comment to reflect that the shell now pauses under an 'onboarding' reason.

**Files.**
- `src/engine/GameCanvas.tsx (add the onboarding pause effect near lines 329-339)`
- `src/ui/Onboarding.tsx (fix the 'does NOT pause' doc comment at 26-29)`

**Steps.**
1. Add useEffect(() => { game?.session.setPaused('onboarding', onboardingOpen); }, [game, onboardingOpen]); alongside the existing menu/journal effects.
2. Update the Onboarding component doc comment.
3. Confirm the Escape-precedence guard (GameCanvas.tsx:398 already skips opening the menu while onboarding is up) still holds.

**Acceptance.** Extend src/buildGame.test.ts (or a GameCanvas-level test) asserting session.isPaused('onboarding') is true while onboardingOpen and false after dismiss. Observable: with the first-run overlay up, survival meters do not drain (SurvivalSystem short-circuits on session.paused) and the world holds.

**Risk.** Very low, no perf impact. Regression: ensure a returning player who has already seen onboarding (open=false at mount) never sets the pause reason — the effect keys on onboardingOpen which starts false in that case. Verify the pause releases even if storage is blocked (Onboarding still calls onOpenChange(false) on dismiss).

### 10. [minor] Sound is a single mute toggle — no volume or per-channel control
_Effort: L_

**Root cause.** Settings has only boolean muted (settingsStore.ts:12-18); SettingsMenu.tsx:56-67 renders a single On/Muted switch; AudioSystem only calls engine.setMuted (AudioSystem.ts:220,254). There is no volume or channel abstraction surfaced, even though AudioEngine internally uses gain nodes.

**Solution.** Add persisted masterVolume (0..1, default ~0.8) and two channel levels ambientVolume/sfxVolume (0..1) to Settings. Expose engine.setMasterGain(v) / setAmbientGain(v) / setSfxGain(v) on AudioEngine backed by its existing gain-node graph (a master gain the output routes through, and two sub-buses: ambient bed vs. one-shot SFX). In AudioSystem.update, alongside the existing setMuted sync (AudioSystem.ts:254), push the three live values each frame (cheap; the engine can epsilon-skip like setWaterfallLevel already does at AudioSystem.ts:374). Surface three range sliders in SettingsMenu. This lets a player quiet the jungle bed while keeping the wildlife warning SFX audible — directly the stated need.

**Files.**
- `src/settings/settingsStore.ts (add masterVolume/ambientVolume/sfxVolume + clamp/validate)`
- `src/audio/AudioEngine.ts (add setMasterGain/setAmbientGain/setSfxGain; route SFX vs ambient through separate sub-gains under a master gain)`
- `src/audio/AudioSystem.ts (push the three levels in update(), mirror the setMuted sync)`
- `src/ui/SettingsMenu.tsx (three volume sliders under Sound)`

**Steps.**
1. Add the three volume fields to Settings/DEFAULTS with 0..1 clamping in load().
2. In AudioEngine, ensure a master GainNode terminates the graph and that ambient sources vs one-shot SFX each route through their own sub-gain; add the three setters.
3. In AudioSystem.update, read settings and call the setters (guard with epsilon skips to avoid churn).
4. Add three labelled range inputs to SettingsMenu writing settings.set(...).
5. Keep the existing mute switch as a master override (mute wins regardless of volumes).

**Acceptance.** settingsStore.test.ts: the three volumes persist and clamp to 0..1. An AudioSystem test (with a fake AudioEngine spy, as the module is already fully DI'd per its header) asserts update() calls setMasterGain/setAmbientGain/setSfxGain with the store values. SettingsMenu.test.tsx: sliders call settings.set. Observable: lowering the ambient slider quiets the bed while a snake rattle stays audible.

**Risk.** Sound work ranks strictly below other tracks per charter — schedule accordingly. No WebGL/perf-budget impact (Web Audio gain nodes are near-free). Regression: verify iOS audio-unlock and the interrupt-recovery path (AudioSystem.ts:259) still work with the new gain routing; don't break the existing single mute contract. Requires AudioEngine internals — coordinate with whoever owns synthesis.

### 11. [minor] Survival meters lose their only critical-low cue under reduced motion, and have no numeric readout
_Effort: M_

**Root cause.** tokens.css:446-455 .meter--low is animation-only and is suppressed by both reduced-motion gates, leaving only the shrinking width; per-meter fill colours are constant (tokens.css:396-400) so colour never signals value. Values live only in aria-label (SurvivalMeters.tsx:47), never on screen, on a 7px track (tokens.css:379-387).

**Solution.** Two independent, motion-free cues. (1) Give .meter--low a static high-salience treatment that survives reduced motion: a bright outline/box-shadow ring on .meter__track and a brighter/desaturated fill (e.g. .meter--low .meter__fill { filter: brightness(1.4); } plus .meter--low .meter__track { outline: 2px solid var(--danger); }) — pure static CSS, no @keyframes, so neither reduced-motion gate removes it. Keep the existing flash as an additive layer only for non-reduced users. (2) Add an optional on-screen numeric readout: a settings flag showMeterValues (default off) that renders the integer value in a small .meter__value span (aria-hidden, since the aria-label already carries it). Render values at a comfortable size (>=0.8rem) so they read on the thin bars. Both are DOM/CSS only.

**Files.**
- `src/tokens.css (static .meter--low outline+brightness rules; a .meter__value style)`
- `src/ui/SurvivalMeters.tsx (render an optional numeric span gated on the setting)`
- `src/settings/settingsStore.ts (add showMeterValues, default false)`
- `src/ui/SettingsMenu.tsx (a 'Show meter numbers' switch)`

**Steps.**
1. Add static .meter--low outline + fill-brightness rules NOT wrapped in @keyframes; leave the existing flash animation as the extra (motion) layer for non-reduced users.
2. Add showMeterValues to Settings/DEFAULTS + validation.
3. In SurvivalMeters, when the setting is on, render <span className='meter__value' aria-hidden>{value}</span>; keep the aria-label unchanged.
4. Add the SettingsMenu toggle.
5. Verify the outline is visible against the HUD backdrop at 7px height (bump .meter__track height slightly if needed, within layout budget).

**Acceptance.** Extend src/ui/SurvivalMeters.test.tsx: with a value<=LOW_METER the container carries meter--low (already tested) AND, crucially, add a CSS assertion in tokens.css.test.ts that .meter--low has a non-animation cue (outline/filter) not gated by prefers-reduced-motion. With showMeterValues on, assert the numeric span renders the value. settingsStore.test.ts: the flag persists.

**Risk.** Low, no perf impact. Regression: keep the aria-label as the single spoken source (don't make .meter__value a live region or it will chatter — the comment at SurvivalMeters.tsx:19-25 explains why). Ensure the static low-outline doesn't clash visually with the health meter's red fill (use a distinct outline colour).

### 12. [minor] Taking damage has no on-screen feedback
_Effort: M_

**Root cause.** The only damage feedback is engine.hurtThud() fired on a sharp health drop (AudioSystem.ts:323, gated by HURT_DROP_THRESHOLD=5 at AudioSystem.ts:130) plus the silent health-bar decrement (SurvivalMeters.tsx). Grep of src/ui and tokens.css finds no damage-linked visual. Deaf/muted players get nothing salient.

**Solution.** Add a brief screen-edge red flash/vignette driven by the SAME health-drop edge the audio uses. Reuse the CSS screen-edge-flash primitive built for the threat vignette (finding 1): a fixed full-screen div with a red inset radial box-shadow, opacity pulsed from 0 to a peak and eased back over ~400ms on each qualifying health drop. Drive it from React: a small effect subscribed to the survival store that detects health drops >= HURT_DROP_THRESHOLD (mirror the AudioSystem edge logic, ideally share the threshold constant) and triggers a CSS class or an opacity ramp. Gate the animation behind both reduced-motion signals — under reduced motion show a single brief static tint instead of a pulse (photosensitivity-safe, no rapid flashing). Optionally bias the vignette toward the damage direction if a threat bearing is available (reuse the ThreatSystem bearing). Pure DOM/CSS — zero draws.

**Files.**
- `src/ui/DamageFlash.tsx (new — subscribes to survival store, ramps a CSS red edge overlay on health-drop edges)`
- `src/engine/GameCanvas.tsx (mount <DamageFlash survival={game.survival.store}/> in the survival block ~476)`
- `src/tokens.css (.damage-flash red edge rules + reduced-motion static-tint fallback, mirror .meter--low gates at 444-455)`
- `src/survival/survivalStore.ts or a shared const (export HURT_DROP_THRESHOLD so the visual and audio agree)`

**Steps.**
1. Export/share the HURT_DROP_THRESHOLD so DamageFlash and AudioSystem use one value.
2. Build DamageFlash: track prev health, on a drop >= threshold set a transient 'flashing' state (timeout-cleared) that drives the overlay opacity.
3. Add tokens.css .damage-flash with a red inset vignette; a @keyframes pulse for non-reduced users and a static brief tint under both reduced-motion gates.
4. Mount DamageFlash under the survival branch in GameCanvas.
5. Ensure single, non-rapid pulses (no strobing) to stay photosensitivity-safe.

**Acceptance.** New src/ui/DamageFlash.test.tsx: drive a fake survival store from health 100→90 and assert the overlay becomes visible/gets the flashing class; a slow drain (1/frame under threshold) does not trigger it. Assert a reduced-motion context uses the static-tint class (no keyframe animation). Observable: taking a snake bite paints a brief red screen edge even when muted.

**Risk.** Low — DOM/CSS only, zero WebGL/perf-budget impact (same class as lens-rain). Regression/safety: MUST avoid rapid repeated flashing (photosensitivity) — clamp re-trigger frequency and keep the static fallback under reduced motion. Keep the audio threshold and visual threshold identical so the cues stay in sync.

**Cross-cutting.** Shares the reduced-motion-gated screen-edge CSS primitive with the wildlife-threat vignette (finding 1). Build one .screen-edge-flash base (colour + intensity as CSS vars) and drive it from both the threat store and the health-drop edge, rather than two parallel overlays.

### 13. [polish] Onboarding never teaches the journal key (J)
_Effort: S_

**Root cause.** controlScheme.ts:41-51 KEYBOARD_ENTRIES lists W A S D / Mouse / Shift / Space / E / Esc but not J, while the J handler exists (GameCanvas.tsx:404-411) and the only always-visible mention is the aria-hidden HUD strip (Hud.tsx:84). So keyboard/SR users are never told how to open the journal.

**Solution.** Add a frozen ControlEntry { label: 'J', action: 'Journal' } to KEYBOARD_ENTRIES (place it after 'E' — matches the E/J adjacency in the HUD strip and the interact-then-journal mental model). Onboarding renders the table verbatim (Onboarding.tsx:73-84) via <kbd>, so it appears automatically with no component change. No touch entry needed — the touch scheme uses the action button, and journal-on-touch is a separate concern.

**Files.**
- `src/ui/controlScheme.ts:41-51 (add the J entry to KEYBOARD_ENTRIES)`

**Steps.**
1. Insert Object.freeze({ label: 'J', action: 'Journal' }) after the 'E' entry in KEYBOARD_ENTRIES.
2. No other changes — Onboarding renders it automatically.

**Acceptance.** Extend src/ui/controlScheme.test.ts: assert the keyboard scheme entries include a label 'J' with action mentioning Journal. Extend src/ui/Onboarding.test.tsx: rendering the keyboard channel shows a <kbd>J</kbd> row. Observable: first-run overlay lists 'J — Journal'.

**Risk.** Trivial, no perf impact. Regression: keep entries in a sensible order (WASD→Mouse→Shift→Space→E→J→Esc) so the taught list matches the HUD strip wording at Hud.tsx:85.

---

## Story & Theming  
_12 solutions_

### 1. [MAJOR] "Five pages" in onboarding/README/notice vs "6" in every in-game counter
_Effort: S_

**Root cause.** Two different truths were authored. The quest/discovery layer counts all six POI_ANCHORS as pages: buildGame.ts:136 passes every anchor as a clueId and questStore is created with POI_ANCHORS.length (=6) at buildGame.ts:109, so cluesTotal=6, RevealPanel.tsx:98 shows 'Page N of 6', Hud.tsx:59 shows 'Pages N / 6'. Meanwhile the marketing/onboarding copy kept the design's 'Five clues' framing verbatim: Onboarding.tsx:68, README.md:3, TextView.tsx:32. All six expedition.json entries (including site-ancient-fig, the dig site) genuinely carry a readable `body`, so there truly are six pages in-game.

**Solution.** Unify on SIX everywhere, because every counter already says six and all six POIs are literally readable pages (the fig's 'This is the place. Dig.' is a found page too). Change the three copy strings from 'five pages' to 'six pages'. This is the low-risk fix and stays honest to what the player reads. (Rejected alternative: excluding the fig/camp from the count would require re-plumbing cluesTotal, the dig gate in QuestSystem, discoveryStore.total, and the RevealPanel eyebrow — larger surface, and it would make the reveal panel show a page eyebrow for an uncounted page, an awkward inconsistency.) Since the design doc's own prose says 'five clues', add a one-line note in the design doc that the shipped count is six readable pages (5 trail clues + the dig-site page) so the doc and product agree.

**Files.**
- `src/ui/Onboarding.tsx:68 ('Five pages' → 'Six pages')`
- `src/ui/TextView.tsx:32 ('five pages' → 'six pages')`
- `README.md:3 ('five pages' → 'six pages')`
- `src/ui/Onboarding.test.tsx (add copy assertion)`
- `docs/design/2026-07-08-the-lost-idol-design.md (footnote reconciling 5 clues vs 6 pages)`

**Steps.**
1. Edit the three copy strings to 'six pages'.
2. Add a Vitest to Onboarding.test.tsx asserting the lede text contains 'Six pages' and does NOT contain 'Five pages'.
3. Grep the repo for /five pages|Five pages/ to confirm no straggler copy remains.
4. Add the design-doc reconciliation note.

**Acceptance.** Vitest in src/ui/Onboarding.test.tsx: rendered onboarding lede matches /six pages/i and not /five pages/i. Repo-wide grep for 'five pages' returns zero product matches. Observable: onboarding, the WebGL-fallback notice, the top-right badge, and the reveal eyebrow all say six.

**Risk.** No perf impact (copy only). Regression: none mechanical; ensure no test currently asserts 'five pages' (grep found none in tests). Watch that README wording elsewhere (line 19) stays consistent.

**Cross-cutting.** May also surface in a ux/content audit as a copy-consistency bug — same three-string fix; no separate work.

### 2. [MAJOR] GPS-style nav arrows contradict the "read the world, no map markers" pillar the design explicitly cut
_Effort: M_

**Root cause.** NavSystem.update (src/ui/NavSystem.ts:37-89) projects EVERY undiscovered POI each frame into either an on-screen homing dot (lines 61-71) or an off-screen edge arrow (lines 72-86), each stamped with a live `${Math.round(dist)} m` label (line 55). The undiscovered path is unconditional: the only gate (`showDiscovered`, line 52) governs already-discovered POIs, so there is no setting or code path that turns off the undiscovered homing markers. NavMarkers.tsx renders them (mounted at src/engine/GameCanvas.tsx:498). This is the exact 'no GPS-style quest arrow' feature the design lists as Removed (design doc line 171).

**Solution.** Delete the undiscovered-projection path entirely; the compass strip already in the HUD is the design-sanctioned wayfinding. In NavSystem.update, skip any POI that is NOT discovered (invert the current filter): keep the projection loop only for discovered POIs, and only when showDiscovered() is true — so with the default-off setting NavSystem emits an empty marker list and does no per-frame projection. Also strip the distance label from the discovered-marker path (drop `label`/`${n} m`) so even the opt-in backtracking aid is a plain location pip, not GPS telemetry. NavMarkers loses the `__label` spans. The `showDiscoveredMarkers` setting is retained as an opt-in aid for returning to sites you already found (it never reveals the trail ahead), which keeps a shipped setting honest while restoring the clue-reading craft.

**Files.**
- `src/ui/NavSystem.ts (update(): invert the discovered filter, remove label/onScreen-dot for undiscovered)`
- `src/ui/NavMarkers.tsx (OnScreen/EdgeArrow: drop the distance-label spans)`
- `src/tokens.css (remove now-unused .nav-dot__label/.nav-arrow__label rules)`
- `src/ui/NavSystem.test.ts and src/ui/NavMarkers.test.tsx (update expectations)`

**Steps.**
1. In NavSystem.update, replace `if (discovered.has(poi.id) && !showDiscovered) continue;` with `if (!discovered.has(poi.id) || !showDiscovered) continue;` so undiscovered POIs are never projected.
2. Remove the `label` computation and the label fields from the emitted NavMarker objects; remove `MAX_EDGE_ARROWS` clutter cap only if edge arrows for discovered POIs are also cut (decide: keep dots only, drop edge arrows for a fully non-GPS feel).
3. In NavMarkers.tsx delete the `nav-dot__label`/`nav-arrow__label` spans.
4. Delete the corresponding CSS rules in src/tokens.css.
5. Update NavSystem.test.ts: assert that with showDiscovered=()=>false the marker set is empty even when undiscovered POIs are in view; assert discovered POIs project only when the setting is on.
6. Verify in the running build at spawn: STATE nav.markers:0 (default), and the top-center cardinal compass still reads N/E/S/W.

**Acceptance.** New/updated Vitest in src/ui/NavSystem.test.ts: given a fake camera, three undiscovered POIs in front of it, and showDiscovered=()=>false, `navStore.getSnapshot().markers` has length 0; flipping showDiscovered on and marking one POI discovered yields exactly one labelless dot. Observable: at spawn no '<n> m' dots/arrows appear; wayfinding is the compass + clue text only.

**Risk.** No PERF-BUDGET impact — this REMOVES per-frame projection and DOM markers (net win, no geometry/draws/passes added). Regression to watch: the 'show discovered markers' setting must still function; keep the NavSystem/navStore seam so DiscoveryBurst and tests are unaffected. Coordinate the compass half of the wayfinding story with finding #5 (speedometer) so the compass survives that edit.

**Cross-cutting.** This is the single unified 'GPS nav marker' fix that almost certainly also appears in the gameplay, ux, and world audits. The one change (stop projecting undiscovered POIs; lean on the compass + clue prose) resolves all of them. Whoever implements it should own it once and the other areas should reference this issue rather than re-fixing NavSystem.

### 3. [minor] Deploy and share URL still carries the retired "AboutMeGame" product slug
_Effort: M_

**Root cause.** The Pages base path is hard-coded to the legacy repo name: vite.config.ts:12 `const BASE = process.env.VITE_BASE ?? "/AboutMeGame/"`, so the site serves at /AboutMeGame/ and shareCapabilities.ts:58 `realShareUrl = socialUrlHref(import.meta.env.BASE_URL)` copies that path. index.html and socialMeta.ts (CANONICAL_ORIGIN) build og:url/og:image on `nikolajmosbaek.github.io%BASE_URL%`. Every shared link and the address bar show the pivoted-away product name.

**Solution.** This is a deploy-identity change, not just code. Preferred: attach a custom domain (e.g. thelostidol.<domain>) via a public/CNAME file — then set CANONICAL_ORIGIN to the custom origin and VITE_BASE to '/'; the address bar, og:url and share link all read the brand with no legacy slug and no dead-link risk. Fallback with no domain: rename the GitHub repo to `the-lost-idol` (GitHub auto-creates a redirect from the old name so existing links keep working) and change the VITE_BASE default in vite.config.ts to '/the-lost-idol/'; the index.html %BASE_URL% placeholder and socialMeta base-passing already flow the new base through, so only the default literal and any base-referencing comments/tests change. Update the deploy workflow's VITE_BASE if it sets one explicitly.

**Files.**
- `vite.config.ts:12 (BASE default → '/the-lost-idol/' OR '/')`
- `src/share/socialMeta.ts:32 (CANONICAL_ORIGIN if using a custom domain)`
- `public/CNAME (new, only for custom-domain route)`
- `index.html (comments referencing /AboutMeGame/; the %BASE_URL% hrefs auto-update)`
- `.github/workflows/deploy.yml and ci.yml (any explicit VITE_BASE)`
- `src/share/indexHtmlMeta.test.ts + socialMetaCheck.test.ts (update expected origin/base only if the custom-domain route changes CANONICAL_ORIGIN)`

**Steps.**
1. Decide route: custom domain (best brand outcome) vs repo rename (zero-cost, keeps github.io).
2. Repo-rename route: rename the GitHub repo, set VITE_BASE default to '/the-lost-idol/', update deploy.yml VITE_BASE, update index.html comment strings; run npm run build and npm run check:social.
3. Custom-domain route: add public/CNAME, set CANONICAL_ORIGIN, set VITE_BASE default to '/', configure Pages custom domain + DNS, update the two share tests' expected origin.
4. Grep the repo for 'AboutMeGame' and purge remaining product-name references (comments, README deploy notes).
5. Verify the built dist/index.html og:url and the Share button copy the branded URL.

**Acceptance.** Post-build: `npm run check:social` passes with the new base; src/share/indexHtmlMeta.test.ts and socialMetaCheck.test.ts assert the branded origin+base. Observable: the running/deployed site address bar and the Share-copied URL contain 'the-lost-idol' (or the custom domain), not 'AboutMeGame'.

**Risk.** Deploy-config dependency (GitHub Pages settings, DNS if custom domain) — the code change is small but the operational change needs the repo owner. Regression: og:image/og:url absolute-href gates (socialMetaCheck) and the asset path resolution via import.meta.env.BASE_URL must stay consistent — change base in ONE place (VITE_BASE) so engine/assets.ts, share URL, and meta all move together. Note the already-documented dev-server share bug (base '/' in dev) is orthogonal. No perf impact.

**Cross-cutting.** Part of the 'purge AboutMeGame identity' cluster with findings #7 (favicon aria-label) and #12 (docstrings). One 'kill the legacy product name' pass could sweep all three, but the deploy/base change is the load-bearing piece and belongs here.

### 4. [minor] Ending leaves the R./M./K. character threads unresolved
_Effort: S_

**Root cause.** The narrative payoff is thin at the end: the clue chain builds R.'s betrayal/map theft, K.'s fever, M.'s vindication, and R.'s dropped shovel (expedition.json bodies for site-fallen-idol-ruin and site-ancient-fig), but resolution is a single flavor line plus a stats card on TreasurePanel.tsx:88-93. R.'s fate and K. are never closed. Per design the completion screen is scoped to stats+idol+replay/share, so this is polish, not a defect.

**Solution.** Add one closing found-object/journal beat that resolves R. and M. Best-fit, lowest-scope: extend the fig's clue body (site-ancient-fig in expedition.json) with a final discovered detail beside the dropped shovel that reveals R. reached the tree first but was taken — tying into the jaguar (finding #3) closes two threads at once: e.g. 'The shovel's handle is scored with deep parallel gouges, and the loose earth is dark and dragged. R. found it. Something found R.' Then extend the TreasurePanel win flavor (TreasurePanel.tsx:90-93) to name M.'s vindication and R.'s end: 'M. was right, and paid for it. R. was wrong, and paid worse. You brought the truth up with the idol.' K. can be acknowledged in the same or the last-camp body. Content-only; no new panel or system.

**Files.**
- `content/expedition.json (site-ancient-fig body: add the shovel/R. beat; optionally site-last-camp for K.)`
- `src/ui/TreasurePanel.tsx:90-93 (extend the win flavor to close R./M.)`
- `src/content/content.test.ts and src/ui/TreasurePanel.test.tsx (assert the beats)`

**Steps.**
1. Draft the fig-body closing beat in M./found-object voice, tying R.'s shovel to the jaguar for a diegetic fate.
2. Extend the TreasurePanel flavor paragraph to resolve M.'s vindication and R.'s end (keep it to 2-3 sentences so the win screen stays punchy).
3. Add a content test asserting the fig body resolves R. (regex on 'R.') and a TreasurePanel test asserting the flavor names both M. and R.
4. Playtest the ending read for tone.

**Acceptance.** Vitest: content test asserts the site-ancient-fig body matches /R\./ with a resolution phrase; TreasurePanel.test.tsx asserts the flavor text names M. and R. Observable: reaching the fig and winning presents a beat that closes R.'s and M.'s arcs.

**Risk.** No perf impact (content/copy). Regression: keep expedition.json schema/field shape (content.test.ts validates); keep the win screen concise so stats stay legible. Coordinate the shovel/jaguar wording with finding #3 so the two beats agree.

**Cross-cutting.** Directly reinforces finding #3 (jaguar narrative seeding) — implement them together so the jaguar foreshadowing pays off in R.'s fate; the same PR can carry both content beats.

### 5. [minor] Favicon is a pre-pivot "sky-beacon" mark labeled "AboutMeGame"
_Effort: S_

**Root cause.** public/favicon.svg:1 has `aria-label="AboutMeGame"` and lines 9-14 draw a 'Beacon glow column' + 'Beacon core + lamp' — the beacon motif the design doc (line 168) lists among Removed pre-pivot features. index.html:16-19 comments still call it 'the amber sky-beacon mark'. The one persistent tab-bar brand is off-brand and screen-reader users hear the retired product name.

**Solution.** Redraw the favicon as a jungle/idol mark using the existing brand tokens, and set aria-label/title to 'The Lost Idol'. Keep the 64x64 rounded-rect indigo (#14121f) base but replace the beacon column with an idol silhouette (a simple stylized emerald idol head using the world's emerald/green `#8affc1`-family accent, echoing the site color of the fig POI 0x8affc1) framed by two arced fronds/leaves in the vegetation greens (#5b8f4a/#49753c already present). Pure inline SVG, no external asset, negligible bytes. Update the aria-label to 'The Lost Idol' and refresh the index.html favicon comment to describe the idol mark.

**Files.**
- `public/favicon.svg (redraw shapes; aria-label='The Lost Idol')`
- `index.html:16-19 (update the favicon comment wording)`

**Steps.**
1. Design a simple idol-head + fronds SVG at 64x64 using tokens (bg #14121f, emerald accent, foliage greens).
2. Replace the beacon paths (lines 9-14) with the new shapes; keep the rounded-rect base and viewBox.
3. Set aria-label='The Lost Idol'.
4. Update the index.html comment from 'amber sky-beacon mark' to the idol description.
5. Verify the tab icon renders at 16px (silhouette stays legible at small size) and the accessible name reads 'The Lost Idol'.

**Acceptance.** Observable: the browser tab shows the idol/jungle mark, not the amber beacon; inspecting the SVG shows aria-label='The Lost Idol'. Optional Vitest reading public/favicon.svg as text (mirroring tokens.css.test.ts pattern) asserting it contains aria-label="The Lost Idol" and NOT 'AboutMeGame' or 'Beacon'.

**Risk.** No perf impact (tiny static SVG). Regression: ensure the icon reads at 16px; keep the file valid SVG (viewBox intact). No test currently pins favicon content, so add the optional guard to prevent regressions.

**Cross-cutting.** Part of the 'purge AboutMeGame identity' cluster with findings #6 (URL) and #12 (docstrings).

### 6. [minor] HUD speedometer ("0 m/s") is an off-theme leftover from the vehicle/flight game
_Effort: S_

**Root cause.** Hud.tsx:36-40 renders `{h.speed}` + 'm/s' in the top-center pill next to the compass letter; HudSystem.ts:23 feeds `speed` every frame; the pill's docstring (Hud.tsx:16) still describes 'mode (DRIVE/FLY), speed, and altitude (fly only)' — a verbatim carry-over from the retired vehicle game. The design (line 146) asks only for a 'compass strip (cardinal letters only)'. A stationary explorer staring at '0 m/s' breaks immersion.

**Solution.** Drop the speed readout from the HUD, leaving only the diegetic cardinal compass. In Hud.tsx remove the `.hud-stat` span (speed value + unit). Keep the compass point in the `.hud-mode` slot (it already flips to 'SPRINT' while sprinting — retain that as a subtle sprint cue, which is diegetic enough). Remove `speed` from what the HUD reads if nothing else needs it, OR leave HudSystem feeding speed but stop rendering it (minimal). Cleanest: keep hudStore.speed (used for the SPRINT flag path is actually `sprinting`, not speed) — verify no other consumer of `h.speed`; if none in the DOM, the Hud simply stops rendering it. Update the Hud docstring to describe the compass-only strip and delete the DRIVE/FLY/altitude language (this also resolves half of finding #12). Rename/repurpose the `.hud-stat` CSS or delete it.

**Files.**
- `src/ui/Hud.tsx (remove the .hud-stat span at lines 36-40; rewrite the component docstring lines 14-24)`
- `src/tokens.css (remove .hud-stat/.hud-stat__value/.hud-stat__unit rules ~lines 618, 829-839)`
- `src/ui/Hud.test.tsx (remove the 'shows speed' assertions at lines 15, 23)`
- `src/ui/HudSystem.ts (optional: stop pushing speed if no remaining consumer)`

**Steps.**
1. Grep for consumers of hudStore `speed` in the DOM/UI; confirm only Hud renders it.
2. Remove the .hud-stat span from Hud.tsx; keep the compass/SPRINT `.hud-mode` span.
3. Rewrite the Hud docstring to 'compass strip top-center (cardinal letters only)' and drop DRIVE/FLY/altitude wording.
4. Delete unused .hud-stat* CSS.
5. Update Hud.test.tsx: the 'shows the compass point and speed' test becomes 'shows the compass point' (assert 'E' present, assert no 'm/s' text); keep the SPRINT test but drop the speed assertion.
6. Optionally trim HudSystem to stop computing/pushing speed if unused.

**Acceptance.** Updated Vitest in src/ui/Hud.test.tsx: rendered HUD contains the compass letter and NOT the text 'm/s'. Observable: the top-center pill shows only a cardinal letter (or SPRINT), no numeric speed.

**Risk.** No perf impact (removes a per-frame-fed DOM value). Regression: the existing Hud.test.tsx asserts speed — it MUST be updated in the same PR or the suite goes red. Coordinate with finding #1 so the compass remains the wayfinding element after both edits. Confirm the SPRINT indicator still works (driven by `sprinting`, not `speed`).

**Cross-cutting.** Shares the compass/wayfinding surface with finding #1 and the docstring cleanup with finding #12 — the DRIVE/FLY docstring fix is done here, so #12 need not re-touch Hud.tsx.

### 7. [minor] Onboarding controls table crams a chatty run-on aside into the swim row
_Effort: S_

**Root cause.** controlScheme.ts:45-48 sets the Space entry's `action` to a three-clause narrative sentence ('Swim up — in the lagoon you swim where you look; the river's current is not your friend'), while every other row is a terse label. Onboarding.tsx:72-84 renders each `action` verbatim as the `<dd>`, so the Space row wraps to three lines. The lede (Onboarding.tsx:67-71) never mentions swimming, so the mechanic first appears as prose inside a keybinding.

**Solution.** Shorten the Space `action` to a control-length label ('Swim up') so the table stays visually uniform, and move the swim/current lore into the onboarding lede prose where mechanics are introduced. The lede gains a clause: '…drink at the river and forage fruit to stay alive, keep clear of snakes, and mind the water — you can swim in the lagoon, but the river's current will drag you.' This surfaces the mechanic in the right place (the teaching paragraph) and de-clutters the controls table. controlScheme.test.ts currently asserts the run-on regex — update it to expect the terse label; move the lore assertion to an Onboarding lede test.

**Files.**
- `src/ui/controlScheme.ts:45-48 (Space action → 'Swim up')`
- `src/ui/Onboarding.tsx:67-71 (add swim/current clause to the lede)`
- `src/ui/controlScheme.test.ts:31-34 (update Space-row assertion)`
- `src/ui/Onboarding.test.tsx (add lede-mentions-swimming assertion)`

**Steps.**
1. Change the Space entry action to 'Swim up' (keyboard scheme).
2. Add the swim/current sentence to the onboarding lede.
3. Update controlScheme.test.ts so the Space row matches /swim up/i and no longer asserts the run-on lore.
4. Add an Onboarding.test.tsx assertion that the lede mentions swimming and the river current.
5. Verify the touch scheme's swim wording (if any) stays consistent.

**Acceptance.** Vitest: controlScheme.test.ts asserts byLabel('Space') === 'Swim up' (short); Onboarding.test.tsx asserts the lede text matches /swim/i and /current/i. Observable: the controls table's Space row is one line matching its neighbors; swimming is introduced in the lede.

**Risk.** No perf impact (copy only). Regression: controlScheme.test.ts:33-34 WILL fail unless updated in the same PR — that is the intended, guarded change. Keep the touch scheme entries coherent.

**Cross-cutting.** Minor overlap with the general onboarding-copy theme of finding #2/#3; all three touch Onboarding.tsx and can be batched into one onboarding-copy PR to reduce churn.

### 8. [minor] Screen-reader page announcement uses find-count while the visible eyebrow uses narrative order
_Effort: S_

**Root cause.** discoveryAnnounce.ts:26 builds the live-region string from the running find count: `Found ${title} — page ${next.discoveredCount} of ${next.total}`, where discoveredCount is how many you've collected so far. The visible eyebrow (RevealPanel.tsx:98) uses the page's fixed narrative order: `Page ${open.order} of ${snap.total}`. Because discovery is 'ordered but not gated' (design line 112), finding page 5 as your 2nd discovery makes the sighted user read 'PAGE 5 OF 6' while AT users hear 'page 2 of 6' for the same page.

**Solution.** Announce the page's fixed `order`, matching the visible eyebrow. OpenInfo already carries `order` (discoveryStore.ts:31, used at RevealPanel.tsx:98), so change discoveryAnnounce.ts to read `next.open.order` instead of `next.discoveredCount`: `Found ${next.open.title} — page ${next.open.order} of ${next.total}`. The guard (announce only when discoveredCount rises and a panel is open) stays exactly as-is, so it still fires once per new find; only the spoken number changes to the narrative order. This keeps spoken and visible labels identical.

**Files.**
- `src/ui/discoveryAnnounce.ts:26 (use next.open.order)`
- `src/ui/DiscoveryAnnouncer.tsx:9-15 (refresh the docstring's 'N of 13' example — also finding #12)`
- `src/ui/discoveryAnnounce.test.ts (update expected string)`

**Steps.**
1. Change the returned string to interpolate next.open.order rather than next.discoveredCount; keep the two count-based guards (they gate WHEN to speak, not the wording).
2. Update discoveryAnnounce.test.ts: assert that discovering the order-5 page as the 2nd find announces 'page 5 of 6', matching the eyebrow.
3. Update the DiscoveryAnnouncer docstring example from 'N of 13' to 'page N of 6' (resolves half of #12).

**Acceptance.** Vitest in src/ui/discoveryAnnounce.test.ts (existing file): given prev with discoveredCount=1 and next with discoveredCount=2, open.order=5, total=6 → announcementFor returns 'Found <title> — page 5 of 6' (was 'page 2 of 6'). Observable: with a screen reader, opening a page speaks the same page number the eyebrow shows.

**Risk.** No perf impact. Regression: discoveryAnnounce.test.ts asserts the old string — update it in the same PR. Confirm next.open is always present on a new find (guarded at line 25).

**Cross-cutting.** Likely also flagged in an accessibility/ux audit as a label-mismatch; single fix. The DiscoveryAnnouncer docstring edit here also covers part of finding #12.

### 9. [minor] The clue panel is a generic dark UI dialog, not the parchment styling the design called for
_Effort: M_

**Root cause.** RevealPanel.tsx:91-100 renders the narrative reveal with `className="reveal-panel"`, and src/tokens.css:687-713 styles it as a plain dark card (`background: var(--color-bg)`, white body text, 1px translucent border, rounded 1rem) — byte-identical chrome to the pause/journal menus. The design (line 148) specified parchment styling precisely so the found field-notes read as aged paper, not a system dialog.

**Solution.** Give the reveal panel a distinct aged-paper skin via CSS only (no new DOM, no assets). Introduce parchment design tokens in tokens.css (warm stock e.g. `--parchment: #e8dcc0`, ink `--parchment-ink: #2b2013`, edge shadow) and restyle `.reveal-panel`, `.reveal-panel__eyebrow/__title/__body/__emphasis` to use them: a warm radial-gradient paper fill, a subtle inset vignette and torn/deckled edge via `clip-path` or a layered `box-shadow`+`mask` (pure CSS), a slightly serif/handwritten-leaning `font-family` stack for the body (system serif fallback, no web font — respects no-external-assets), and dark ink text on the light stock. Keep the guess/option buttons legible against parchment (darker borders, ink text). Scope every rule under `.reveal-panel` so the pause/journal chrome is untouched. Respect reduced-motion (no animated paper). This is the one story artifact, so the divergence from menu chrome is intentional and design-mandated.

**Files.**
- `src/tokens.css (add parchment tokens; restyle .reveal-panel and its children ~lines 687-799; adjust .reveal-panel__option colors for light bg)`
- `src/tokens.css.test.ts (if it asserts token presence, add parchment assertions)`
- `src/ui/RevealPanel.tsx (no structural change needed; optionally add a `reveal-panel--parchment` marker class only if the Journal reuses .reveal-panel — verify first)`

**Steps.**
1. Confirm .reveal-panel is used only by RevealPanel (grep) so restyling doesn't bleed into Journal/menus; if shared, add a modifier class in RevealPanel.tsx instead.
2. Add parchment tokens to :root in tokens.css.
3. Restyle .reveal-panel: warm paper gradient background, ink text color, deckled edge via clip-path/mask, soft drop shadow; update eyebrow/title/body/emphasis to ink tones and a serif-leaning font stack.
4. Recolor .reveal-panel__option and --chosen states for contrast on the light stock (keep the ✓ non-color affordance and focus outline WCAG-compliant).
5. Guard animation under [data-reduced-motion]; verify contrast ratios (ink on parchment) pass AA.
6. Manually verify the reveal looks like aged paper and is visually distinct from the pause menu; snapshot/DOM test unchanged.

**Acceptance.** Observable in the running build: opening any clue shows a warm parchment card with ink text and torn edges, clearly distinct from the dark pause/journal menus (screenshot compare vs finding evidence #05). Optional Vitest in src/tokens.css.test.ts asserting the parchment token strings exist in the stylesheet. Contrast check: body ink on parchment ≥ 4.5:1.

**Risk.** No PERF-BUDGET impact — DOM/CSS only, no 3D geometry/draws/passes; clip-path/mask are cheap and the panel is a paused modal. Regression to watch: guess-option and focus-outline contrast on the light background; ensure the reduced-motion path; ensure .reveal-panel isn't shared by the Journal before restyling globally.

**Cross-cutting.** Standalone UI-polish; no overlap, though it shares the 'story artifacts should feel diegetic' theme with findings #5 and #7.

### 10. [minor] The jaguar (a lethal ~45-damage pounce predator) is absent from all narrative and onboarding
_Effort: S_

**Root cause.** The jaguar deals STRIKE_DAMAGE=45 (src/wildlife/jaguar.ts:58/563) and telegraphs (prowl→stalk with a growl, glowing night eyes), but no player-facing text names it. Onboarding.tsx:68-70 warns only 'keep clear of snakes'; expedition.json, README, index.html and the design doc return zero 'jaguar' matches. The teaching contract (design pillar 2: 'survival pressure that teaches') has a gap — the island's deadliest animal is never introduced, so a first pounce reads as unfair even though behaviorally it is fair.

**Solution.** Two small, additive changes. (1) Name the jaguar in the onboarding lede alongside snakes: '…keep clear of snakes — and if you hear a growl close by, put water or open ground between you and the jaguar.' This teaches the out (water/camp/distance) that the mechanic already grants. (2) Seed the dread diegetically by weaving one line into an existing clue body — best fit is site-carved-overhang or site-last-camp in expedition.json, where M.'s notes already record danger ('K. is fevered'): add a sentence like 'Something big has been pacing the tree line at dusk — we keep the fire high and the water at our backs.' This makes the predator both foreshadowed and part of the expedition's fear without a new system. Optionally reinforce on the Journal by virtue of the clue text already living there.

**Files.**
- `src/ui/Onboarding.tsx:68-70 (extend the lede warning)`
- `content/expedition.json (add one jaguar-foreshadowing sentence to site-carved-overhang or site-last-camp body)`
- `src/ui/controlScheme.ts (optional: no change) `
- `content.test.ts / src/content/content.test.ts (assert the beat exists)`

**Steps.**
1. Add the jaguar clause to the onboarding lede, keeping it terse and action-oriented (name the out: water/open ground).
2. Add one sentence to a chosen clue body in expedition.json foreshadowing a large predator; keep M.'s field-notes voice.
3. Optionally tie R.'s dropped shovel at the fig to the jaguar (see finding #10) so the same animal closes a narrative loop.
4. Add a content test asserting some expedition.json body matches /jaguar|big cat|pacing the tree line/i, and an Onboarding test asserting the lede mentions the jaguar.

**Acceptance.** Vitest in src/content/content.test.ts (co-located with the existing content tests): at least one POI body matches the foreshadowing regex; Onboarding.test.tsx asserts the lede text names the jaguar. Observable: first-run overlay warns about the jaguar; the journal contains the foreshadowing beat.

**Risk.** No perf impact (copy/content only). Regression: expedition.json is validated by content.test.ts/schema — keep schemaVersion and field shape intact; only edit a `body` string. Coordinate wording with finding #10 if using the shovel/jaguar tie-in.

**Cross-cutting.** Overlaps a likely gameplay/ux 'unannounced lethal predator' finding; the onboarding+clue beat is the shared fix. The shovel tie-in also feeds finding #10 (ending threads).

### 11. [polish] Social share image is a hazy, title-less terrain screenshot
_Effort: M_

**Root cause.** The unfurl card public/social-preview.png (wired at index.html:37/46) is an intentional title-less in-game screenshot rendered by scripts/render-social-preview.mjs; even after a recompose to fight sun-bloom haze it is a cool, low-contrast lagoon vista with a tiny tent and no 'treasure hunt' read. This is a design-direction call, not a bug — socialMeta.ts documents the deliberate screenshot approach and a 300 KB byte bound.

**Solution.** Retune the render toward composed key art with the wordmark. Two options: (A) Recompose the render script for a warmer, higher-contrast frame — golden-hour toward the idol/fig with the emerald accent visible, camera lower and closer for depth, then composite the 'THE LOST IDOL' wordmark (a bold serif in brand accent) top-left with a dark scrim for legibility. (B) If time-boxed, at minimum overlay the wordmark on the current frame. Keep it 1200x630, re-encode to the 256-color palette PNG, and stay under SOCIAL_PREVIEW_MAX_BYTES (300 KB) so socialPreviewPng.test.ts passes. Since scripts/render-social-preview.mjs owns the frame, add a text-composite step there (canvas/sharp already in the pipeline) rather than hand-editing the PNG.

**Files.**
- `scripts/render-social-preview.mjs (retune camera/lighting; composite the wordmark + scrim)`
- `public/social-preview.png (regenerated output)`
- `src/share/socialPreviewPng.test.ts (byte-bound stays; assert 1200x630)`

**Steps.**
1. Decide direction with the owner (accept, retune, or full key art) — this is a design call.
2. In render-social-preview.mjs, set a golden-hour camera framing the idol/fig with the emerald accent; raise contrast/warmth.
3. Composite the 'THE LOST IDOL' wordmark with a legibility scrim in the render step.
4. Re-encode to 256-color PNG; confirm size < 300 KB and dimensions 1200x630.
5. Run socialPreviewPng.test.ts and check:social; eyeball the unfurl in a card previewer.

**Acceptance.** Vitest src/share/socialPreviewPng.test.ts stays green (dimensions 1200x630, bytes < 300 KB). Observable: pasting the deploy URL into a card previewer shows a warm, high-contrast frame with the readable wordmark, not a hazy title-less vista.

**Risk.** The render/encode is build-time only — no runtime PERF-BUDGET impact, but the 300 KB per-image bound (SOCIAL_PREVIEW_MAX_BYTES) and the 6 MB total-payload cap must hold; re-encode to palette PNG. Regression: keep the exact filename/dimensions the meta gates assert. This is graphics-3d-adjacent for the render framing — coordinate camera/lighting choices with that owner if the frame is regenerated.

**Cross-cutting.** The camera/lighting framing overlaps graphics-3d (the render is a WebGL capture); the wordmark composite and copy are client-side. Split the seam: client owns the wordmark/meta, graphics-3d advises the frame.

### 12. [polish] Stale pivot leftovers in shipped code docstrings (13-landmark count, "Drive on", DRIVE/FLY)
_Effort: S_

**Root cause.** Docstrings were never updated across two pivots and cite dead facts: DiscoveryAnnouncer.tsx:14 says it speaks 'N of 13' (old 13-landmark set; game has 6), RevealPanel.tsx:129-132 calls the footer button 'Drive on' while RevealPanel.tsx:159 actually renders 'Press on', and Hud.tsx:16 documents 'mode (DRIVE/FLY), speed, and altitude (fly only)' that no longer exist. These mislead the next maintainer editing this copy.

**Solution.** Refresh the three docstrings to the shipped reality: DiscoveryAnnouncer → 'page N of 6' (or reference discoveryStore.total rather than a literal); RevealPanel footer docstring → 'Press on' (the actual dismiss label) and drop the drive-era framing; Hud → 'compass strip (cardinal letters only)' with DRIVE/FLY/altitude removed. Doc-comment-only changes, no behavior. Note that finding #5 already rewrites the Hud docstring and finding #9 already updates the DiscoveryAnnouncer docstring — so this finding is effectively just the RevealPanel 'Drive on' → 'Press on' correction plus a sweep to confirm no other stale references remain.

**Files.**
- `src/ui/RevealPanel.tsx:128-145 (footer docstring: 'Drive on' → 'Press on'; remove 'toward a concrete landmark' drive framing where inaccurate)`
- `src/ui/Hud.tsx:14-24 (docstring — done in #5)`
- `src/ui/DiscoveryAnnouncer.tsx:9-16 (docstring — done in #9)`

**Steps.**
1. Correct the RevealPanel footer docstring to name the real 'Press on' button and current forward-nav semantics.
2. Confirm the Hud and DiscoveryAnnouncer docstrings are fixed (via findings #5 and #9) — if those are not being done, apply the doc edits here.
3. Grep the src tree for '13', 'DRIVE', 'FLY', 'Drive on', 'altitude' in comments and purge remaining pivot leftovers.
4. No test needed (comments); rely on build/typecheck staying green.

**Acceptance.** Repo-wide grep of src/**/*.tsx comments for /Drive on|DRIVE\/FLY|altitude \(fly|of 13|13-landmark/ returns zero matches. `npm run build` (typecheck) stays green. Observable: none (comments), but the next maintainer reads accurate docs.

**Risk.** No perf/behavior impact (comments only). Regression: none. Sequence after or alongside #5 and #9 to avoid duplicate edits to the same docstrings.

**Cross-cutting.** Fully overlaps the docstring edits in findings #5 (Hud) and #9 (DiscoveryAnnouncer) — do them once. This finding's unique remainder is the RevealPanel 'Drive on'→'Press on' fix. Also part of the 'purge AboutMeGame/vehicle-era identity' cluster with #6 and #7.

---

## Not yet covered

The audit's completeness critic named 8 deeper cross-system angles; a session limit stopped 6 before they finished, so their issues (and thus solutions) are partial: mid-run reload desync in detail, cold-start loading feedback, predators×dig×finale end-states, mobile single-action-button arbitration, clue-prose vs. actual site geometry for all five sites, and weather×navigation×survival. Worth a dedicated follow-up audit+solutions pass once budget resets.
