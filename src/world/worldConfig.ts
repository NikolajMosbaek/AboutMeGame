// World scope, layout, the river course and the expedition-site anchor map
// (The Lost Idol — pivot slice C; spec docs/design/2026-07-08-the-lost-idol-design.md).
//
// This is the single source of truth for "how big is the world and where does
// everything sit." Terrain, water, props, sites and the spawn all read from it,
// and the quest content binds to these same anchors by `poiId`, so the level
// design and the clue chain stay in lockstep.

export interface PoiAnchor {
  /** Matches an `id` in content/expedition.json (the clue chain binds here). */
  poiId: string;
  /** Narrative order (1 = the camp you wake at). Drives the intended chain. */
  order: number;
  /** Short label for the site, the navigation hint, and debugging. */
  label: string;
  /** World position on the ground plane; terrain height is sampled at build. */
  x: number;
  z: number;
  /** Which procedural site archetype renders here. */
  archetype: SiteArchetype;
  /** Signature colour for the site's nav hint and journal entry. */
  color: number;
}

export type SiteArchetype =
  | "camp" // your riverside camp: tent, cold fire ring, supply crates
  | "canoe" // the expedition's wrecked canoe, half out of the water
  | "overhang" // a rock overhang in the highland with old carvings
  | "remains" // the lost expedition's last camp — pack, bones, mossy cairn
  | "ruin" // an overgrown ruin with a fallen statue head
  | "figtree"; // the ancient strangler fig — the dig site under its roots

export const WORLD = {
  /** Random seed for the terrain — fixed so the world is identical every load. */
  seed: 20260708,
  /** Full width/depth of the terrain tile (world units). */
  size: 520,
  /** Terrain mesh subdivisions per side. 260 ⇒ 2 units/vertex, enough for the
   *  ~14-unit river channel to read cleanly; ~135k tris, within budget. */
  segments: 260,
  /** Land stays a full-height plateau out to here, so every site (max radius
   *  ~120) sits comfortably on solid ground. */
  coastRadius: 165,
  /** Beyond this the terrain is fully below sea level — open sea. The shore
   *  ramps between coastRadius and here. */
  islandRadius: 200,
  /** Soft boundary radius — past here the player is turned back. Set just
   *  inside the coastline so you roam the whole island but not the sea. */
  boundaryRadius: 178,
  /** Peak terrain relief above the land base (before the highland boost). */
  maxHeight: 16,
  /** Minimum inland elevation, so valleys never dip below the waterline —
   *  except where the river/lagoon deliberately carve through. */
  landBase: 3,
  /** Sea level (the one water plane sits here; y=0). The river bed and lagoon
   *  are carved below it, so the same plane fills them — one water level. */
  seaLevel: 0,
  /** How far the masked-out rim sinks below sea level, to read as a coastline. */
  shoreDrop: 14,
  /** Extra elevation the northern highland gains (the river's source country). */
  highlandBoost: 13,
  /** Flat radius of the cleared ground around the camp (gentle start). */
  campClearRadius: 14,
} as const;

/**
 * The river: a polyline from the northern highland spring down to the south
 * lagoon. Terrain carves a channel along it (bed below sea level, so the single
 * water plane fills it); wildlife, foam and audio all read the same course.
 * Points run source → mouth.
 */
export const RIVER = {
  points: [
    { x: 24, z: -148 },
    { x: -6, z: -112 },
    { x: 22, z: -62 },
    { x: -2, z: -14 },
    { x: -20, z: 38 },
    { x: 4, z: 88 },
    { x: 0, z: 124 },
  ],
  /** Half-width of the fully-deep bed. */
  bedHalfWidth: 5,
  /** Half-width where the banks finish blending back into the terrain. */
  bankHalfWidth: 14,
  /** Bed depth below sea level — deeper than maxWadeDepth, a real obstacle. */
  depth: 2.6,
} as const;

/** The south lagoon the river empties into — the camp sits on its west shore. */
export const LAGOON = {
  x: 0,
  z: 142,
  radius: 32,
  /** Blend distance from open water back up to jungle floor. */
  shoreRamp: 20,
  depth: 3.2,
} as const;

/** Where you wake: the camp on the lagoon's west shore, facing the water. */
export const SPAWN = {
  x: -34,
  z: 124,
  /** Face east toward the lagoon (yaw is CCW-positive, 0 = +Z). */
  yaw: Math.PI / 2,
} as const;

/**
 * The 6 expedition sites. The chain reads camp → canoe → overhang → remains →
 * ruin → fig (each clue's text names the next site by landmark description),
 * looping the whole island: south shore, upriver along the west bank, the
 * northern highland, back down the western valley, east across the river, and
 * finally the fig on the eastern hill. Free roaming stays open — clues are
 * collectable in any order; only the dig needs all five (quest slice).
 */
export const POI_ANCHORS: PoiAnchor[] = [
  { poiId: "site-base-camp", order: 1, label: "Base Camp", x: SPAWN.x + 6, z: SPAWN.z + 2, archetype: "camp", color: 0xffcb47 },
  { poiId: "site-wrecked-canoe", order: 2, label: "Wrecked Canoe", x: -29, z: 57, archetype: "canoe", color: 0x7ad1ff },
  { poiId: "site-carved-overhang", order: 3, label: "Carved Overhang", x: 34, z: -104, archetype: "overhang", color: 0xc8a2ff },
  { poiId: "site-last-camp", order: 4, label: "The Last Camp", x: -72, z: -24, archetype: "remains", color: 0xb0b6c0 },
  { poiId: "site-fallen-idol-ruin", order: 5, label: "Fallen Ruin", x: 84, z: 26, archetype: "ruin", color: 0xff8a5c },
  { poiId: "site-ancient-fig", order: 6, label: "The Ancient Fig", x: 108, z: -46, archetype: "figtree", color: 0x8affc1 },
];
