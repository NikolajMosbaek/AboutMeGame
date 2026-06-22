// World scope, layout and the landmark anchor map (issues #15, #20, #21).
//
// This is the single source of truth for "how big is the world and where does
// everything sit." Terrain, boundaries, props and the camera all read from it,
// and Epic 4 binds the discoverable content to these same anchors by `poiId`,
// so the level design and the content stay in lockstep.

export interface PoiAnchor {
  /** Matches an `id` in content/working-with-claude.json (Epic 4 binds here). */
  poiId: string;
  /** Narrative order (1 = spawn). Drives the suggested exploration path. */
  order: number;
  /** Short label for the landmark, the navigation hint, and debugging. */
  label: string;
  /** World position on the ground plane; terrain height is sampled at build. */
  x: number;
  z: number;
  /** Which procedural landmark archetype renders here. */
  archetype: LandmarkArchetype;
  /** Signature colour for the landmark + its sky-beacon + the nav hint. */
  color: number;
}

export type LandmarkArchetype =
  | "gate" // an arch you pass through
  | "monolith" // a tall standing stone / slab
  | "tower" // a lighthouse-like beacon tower
  | "foundry" // a blocky industrial structure
  | "dam" // a long wall across a gap
  | "station" // a low platform with a canopy
  | "ring" // a circular formation (gardens / rail yard)
  | "mirror"; // a reflective wall at the world's edge

export const WORLD = {
  /** Random seed for the terrain — fixed so the world is identical every load. */
  seed: 20260622,
  /** Full width/depth of the terrain tile (world units). */
  size: 520,
  /** Terrain mesh subdivisions per side. 200 ⇒ ~80k tris, within the budget. */
  segments: 200,
  /** Land stays a full-height plateau out to here, so every POI (max radius
   *  ~145) sits comfortably on solid ground. */
  coastRadius: 165,
  /** Beyond this the terrain is fully below sea level — open water. The shore
   *  ramps between coastRadius and here. */
  islandRadius: 200,
  /** Soft boundary radius — past here the player is turned back (Epic 3). Set
   *  just inside the coastline so you roam the whole island but not the sea. */
  boundaryRadius: 178,
  /** Peak terrain relief above the land base. Kept gentle so the island is
   *  mostly rolling grass — inviting to look at and easy to drive (Epic 3). */
  maxHeight: 18,
  /** Minimum inland elevation, so valleys never dip below the waterline. */
  landBase: 3,
  /** Sea level (water plane sits here; y=0). */
  seaLevel: 0,
  /** How far the masked-out rim sinks below sea level, to read as a coastline. */
  shoreDrop: 14,
  /** Flat radius of the spawn plaza around the origin (keeps the start gentle). */
  spawnPlazaRadius: 22,
} as const;

/**
 * The 13 landmark anchors, hand-placed in a loop from the southern spawn
 * (#1 Arrivals Gate) outward and around the island, finishing at the far
 * north-west edge (#13 Meta Mirror) — so following them is a natural tour while
 * free roaming stays open. Colours are spread across the wheel so each beacon
 * reads as a distinct navigation target from a distance.
 */
export const POI_ANCHORS: PoiAnchor[] = [
  { poiId: "poi-arrivals-gate", order: 1, label: "Arrivals Gate", x: 0, z: 64, archetype: "gate", color: 0xffcb47 },
  { poiId: "poi-end-state-overlook", order: 2, label: "One-Sentence Overlook", x: -62, z: 34, archetype: "monolith", color: 0x7ad1ff },
  { poiId: "poi-ai-first-foundry", order: 3, label: "Session Foundry", x: -96, z: -28, archetype: "foundry", color: 0xff8a5c },
  { poiId: "poi-staff-engineer-gate", order: 4, label: "Staff-Engineer Gate", x: -52, z: -92, archetype: "gate", color: 0xc8a2ff },
  { poiId: "poi-root-cause-quarry", order: 5, label: "Root-Cause Quarry", x: 18, z: -112, archetype: "monolith", color: 0xb0b6c0 },
  { poiId: "poi-autonomous-debug-lab", order: 6, label: "Autonomous Debug Lab", x: 82, z: -88, archetype: "foundry", color: 0xff5c8a },
  { poiId: "poi-review-tower", order: 7, label: "Calibrated Review Tower", x: 118, z: -18, archetype: "tower", color: 0xffe066 },
  { poiId: "poi-force-push-dam", order: 8, label: "Force-Push Dam", x: 102, z: 52, archetype: "dam", color: 0x5cc8ff },
  { poiId: "poi-pr-walkthrough-station", order: 9, label: "Walkthrough Station", x: 56, z: 98, archetype: "station", color: 0x8affc1 },
  { poiId: "poi-history-rail-yard", order: 10, label: "History Rail Yard", x: -12, z: 112, archetype: "ring", color: 0xffa3d1 },
  { poiId: "poi-architecture-gardens", order: 11, label: "Seam Gardens", x: -78, z: 92, archetype: "ring", color: 0x9fe06a },
  { poiId: "poi-skill-workshop", order: 12, label: "Portable Toolkit Workshop", x: -124, z: 26, archetype: "station", color: 0xffb74d },
  { poiId: "poi-meta-mirror", order: 13, label: "Hall of Mirrors", x: -120, z: -74, archetype: "mirror", color: 0xd9e3ff },
];
