// Model pipeline for both the flora upgrade (visual-overhaul slice 6) and the
// man-made object upgrade (Objects slice 1, #185-family — "make the objects
// look like what they really are").
//
// An authoring-time tool, run by hand — never at build or test time — that
// turns handfuls of CC0 Kenney glTF models into the tiny quantized GLB payload
// `public/assets/models/{flora,objects}/` ships. `@gltf-transform/*` (added as
// devDependencies, build-time only — they never reach the shipped bundle) does
// the actual mesh surgery; the system `unzip` binary extracts just the source
// `.glb` files each job uses out of its kit's single zip.
//
//   node scripts/process-models.mjs
//
// Two JOBS share one `processOne` pipeline (the recolour/merge/rescale/
// quantize steps are the same shape either way) but differ in COLOUR SOURCE:
//
//   - FLORA (`MODELS_FLORA`, Kenney "Nature Kit"): every primitive is an
//     UNTEXTURED `KHR_materials_unlit` material with only a flat
//     `baseColorFactor` — `colorMode: "material"` bakes that factor (recoloured
//     by material NAME to this world's warm-jungle tokens) into COLOR_0.
//   - OBJECTS (`MODELS_OBJECTS`, Kenney "Survival"/"Pirate"/"Graveyard" kits):
//     every model instead carries ONE shared "colormap" material — a textured
//     flat-colour-palette atlas (each UV island is a solid-colour swatch, the
//     same convention many low-poly kits use to avoid a material-per-part
//     explosion) — so there is no useful per-material `baseColorFactor` to
//     read. `colorMode: "texture"` instead SAMPLES that atlas at each vertex's
//     own UV (`bakeVertexColorFromTexture`, via `sharp` — already a
//     devDependency for `process-textures.mjs`) and bakes the sampled RGB into
//     COLOR_0 directly. Confirmed by inspecting several candidates
//     (`gltf-transform inspect`-equivalent probing): every "colormap" material
//     has `baseColorFactor: [1,1,1,1]` (i.e. the effective colour is exactly
//     the texture sample, no factor to combine), and per-vertex sampling
//     correctly separates a single mesh's multi-part colouring (e.g. a tent's
//     tan canvas vs its brown poles) since Kenney's flat-shaded low-poly
//     construction keeps each triangle's UVs inside one solid-colour swatch —
//     confirmed by print-sampling several models and seeing only a handful of
//     distinct (r,g,b) triples per mesh, not photographic noise.
//
// SOURCE ASSETS — all CC0 1.0 (see `public/assets/LICENSES.md` for the full
// record and the source-selection trail):
//   - Kenney "Nature Kit"      https://kenney.nl/assets/nature-kit
//   - Kenney "Survival Kit"    https://kenney.nl/assets/survival-kit
//   - Kenney "Pirate Kit"      https://kenney.nl/assets/pirate-kit
//   - Kenney "Graveyard Kit"   https://kenney.nl/assets/graveyard-kit
// Each kit's direct zip URL was found by following the site's donate-or-skip
// download flow (not guessable from the pack page's static HTML alone) — the
// SAME scriptability finding the flora slice recorded for Quaternius (Google
// Drive folders defeat scripting; Kenney's flow resolves to one stable
// curl-able zip).
//
// Each zip is downloaded to a LOCAL CACHE outside the repo (default
// `<os.tmpdir()>/lost-idol-flora-models`, override with `FLORA_MODEL_CACHE`) —
// never committed; only the processed GLB output under
// `public/assets/models/{flora,objects}/` is. Re-running the script reuses an
// already-cached zip instead of re-downloading it.
//
// PER-MODEL PIPELINE (`processOne`, all via the `@gltf-transform/core` +
// `@gltf-transform/functions` programmatic API — the CLI's single-purpose
// commands don't compose the custom "bake a colour source into vertex colour"
// step this needs):
//
//   1. Read the source GLB.
//   2. BAKE colour into per-vertex COLOR_0 (`colorMode`, see above) — this is
//      what lets step 3 merge primitives that used to need separate materials
//      into ONE draw call while keeping the multi-tone look, the same "vertex
//      colour instead of a material split" discipline `props.ts`'s
//      `stampColor` (and `landmarks.ts`'s `prep`) already use for the
//      procedural geometry this replaces/upgrades.
//   3. Reassign every primitive to one shared dummy material, then run
//      `dedup()` + `join({ keepMeshes: false, keepNamed: false })` — merges
//      every primitive (and every source NODE's own transform — `join` bakes
//      each node's translation/rotation/scale into its primitive's vertices
//      before merging, confirmed by the flora job's own multi-node
//      trunk+canopy models coming out correctly fused) into ONE mesh / ONE
//      draw call. The dummy material is pruned away by step 5; only geometry +
//      `COLOR_0` matters at runtime.
//   4. RESCALE + GROUND to this world's scale, baked DIRECTLY into the merged
//      primitive's `POSITION` vertex array (never the mesh node's transform —
//      the runtime parser, `src/world/floraGlb.ts`, reads ONLY
//      `meshes[0].primitives[0]` and never touches `nodes`/`scenes`). The
//      scale factor is computed from the model's OWN local bbox range along
//      `scaleAxis` (default `"y"`, i.e. height — the flora job's original,
//      unchanged behaviour) mapped to `targetHeight`; grounding (local min-Y ->
//      world 0) always happens on Y regardless of which axis drove the scale,
//      so a wide-but-short object (a rowboat hull, a campfire ring) can be
//      sized by its LENGTH/WIDTH instead of being blown up trying to match a
//      height it was never tall to begin with.
//   5. `prune()` (drop the now-unreferenced per-primitive materials/textures —
//      for `colorMode: "texture"` this is what drops the shipped colormap.png
//      reference entirely; the baked COLOR_0 is all that survives) + `quantize()`
//      (`KHR_mesh_quantization`).
//
// Output: `public/assets/models/flora/<name>.glb` /
// `public/assets/models/objects/<name>.glb` — see the per-model log line each
// run prints for the exact byte counts.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { srgbToLinear, texelIndex } from "./colorSpace.mjs";
import { NodeIO } from "@gltf-transform/core";
import { KHRMaterialsUnlit, KHRMeshQuantization } from "@gltf-transform/extensions";
import { dedup, flatten, join as joinPrimitives, prune, quantize } from "@gltf-transform/functions";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const CACHE_DIR = process.env.FLORA_MODEL_CACHE ?? join(tmpdir(), "lost-idol-flora-models");

/** One Kenney kit: its stable direct-zip URL (found via the site's
 *  donate-or-skip flow) and the internal folder its single-file GLB models
 *  live under — most kits use "Models/GLB format", but the Nature Kit's zip
 *  names that same folder "Models/GLTF format" despite it holding `.glb`
 *  files (a real, observed Kenney inconsistency, not a typo). */
const KITS = {
  nature: {
    url: "https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip",
    zipName: "kenney_nature-kit.zip",
    modelsDir: "Models/GLTF format",
  },
  survival: {
    url: "https://kenney.nl/media/pages/assets/survival-kit/4065a8185b-1712149243/kenney_survival-kit.zip",
    zipName: "kenney_survival-kit.zip",
    modelsDir: "Models/GLB format",
  },
  pirate: {
    url: "https://kenney.nl/media/pages/assets/pirate-kit/e6d4bb1525-1771333093/kenney_pirate-kit.zip",
    zipName: "kenney_pirate-kit.zip",
    modelsDir: "Models/GLB format",
  },
  graveyard: {
    url: "https://kenney.nl/media/pages/assets/graveyard-kit/ba8d4b4517-1760691807/kenney_graveyard-kit_5.0.zip",
    zipName: "kenney_graveyard-kit_5.0.zip",
    modelsDir: "Models/GLB format",
  },
};

/**
 * FLORA job (visual-overhaul slice 6) — unchanged from that slice: 7 models,
 * `colorMode: "material"` (bake each primitive's flat `baseColorFactor`,
 * recoloured by material name), `scaleAxis` defaults to `"y"` (height).
 */
const MODELS_FLORA = [
  { name: "canopy-a", kit: "nature", source: "tree_default.glb", targetHeight: 9.8 },
  { name: "canopy-b", kit: "nature", source: "tree_oak.glb", targetHeight: 9.8 },
  { name: "palm-a", kit: "nature", source: "tree_palmTall.glb", targetHeight: 6.5 },
  { name: "understory-a", kit: "nature", source: "plant_bushDetailed.glb", targetHeight: 1.2 },
  { name: "understory-b", kit: "nature", source: "plant_flatTall.glb", targetHeight: 1.2 },
  { name: "rock-a", kit: "nature", source: "rock_largeA.glb", targetHeight: 1.6 },
  { name: "rock-b", kit: "nature", source: "rock_largeD.glb", targetHeight: 1.6 },
].map((m) => ({ ...m, colorMode: "material", outDir: "flora" }));

/**
 * OBJECTS job (Objects slice 1, "make the objects look like what they really
 * are") — `colorMode: "texture"` (see this file's header doc). Sized to slot
 * into the EXISTING site layouts in `src/world/landmarks.ts`/
 * `src/quest/buildTreasure.ts` (each `targetHeight` chosen to roughly match
 * the procedural piece it replaces at that site, so `landmarksUpgrade.ts`'s
 * hand-placed transforms don't need re-deriving from scratch). `tint`
 * (component-wise multiplier, applied AFTER `srgbToLinear` — see
 * `bakeVertexColorFromTexture` — so it's a LINEAR-space correction) corrects
 * the Graveyard Kit's stone pieces, whose "colormap" atlas reads distinctly
 * cool/blue-grey against this world's warm, muted `STONE`/`RUIN` tokens
 * (`src/world/landmarks.ts`), the exact same "recolour to fit this world's
 * palette" finding the flora job's own header doc records for Kenney's
 * `leafsGreen`.
 *
 * RE-DERIVED after fixing the missing sRGB->linear conversion (the earlier
 * `[0.92, 0.84, 0.6]` was picked by eye against washed-out, still-sRGB-encoded
 * output). Once decoded correctly, `ruin-wall`/`ruin-wall-damaged`/
 * `ruin-debris`'s raw atlas samples turned out MUCH bluer than they first
 * appeared (linear B ~1.6-1.7x linear R — `ruin-column`'s own raw sample is
 * comparatively mild, ~0.9x), so the old blue multiplier (0.6) left 3 of the 4
 * ruin pieces reading distinctly COOL (B channel highest) instead of the
 * warm tan-grey `STONE`/`RUIN` tokens target (confirmed both by directly
 * averaging each model's baked `COLOR_0` and by a live-build screenshot
 * comparison). The new multiplier's blue channel (0.44, solved against the
 * post-fix linear atlas samples so R stays the anchor channel) pulls all four
 * pieces warm; `ruin-column` (whose atlas sample needed the least
 * correction) ends up the most saturated of the four as a result — an
 * accepted trade-off of one shared multiplier across pieces sampled from
 * genuinely different atlas swatches, same as the pre-fix tint's own
 * documented limitation.
 */
const STONE_TINT = [0.92, 0.85, 0.44];
const MODELS_OBJECTS = [
  // Camp (site-base-camp): tent, campfire ring + logs, crates, barrel.
  { name: "tent", kit: "survival", source: "tent-canvas.glb", targetHeight: 2.3 },
  { name: "campfire", kit: "survival", source: "campfire-pit.glb", targetHeight: 1.4, scaleAxis: "x" },
  { name: "crate", kit: "survival", source: "box.glb", targetHeight: 0.9 },
  { name: "crate-open", kit: "survival", source: "box-open.glb", targetHeight: 0.8 },
  { name: "barrel", kit: "survival", source: "barrel.glb", targetHeight: 0.7 },
  { name: "bedroll", kit: "survival", source: "bedroll.glb", targetHeight: 1.4, scaleAxis: "z" },
  // Canoe (site-wrecked-canoe): one hull, already carrying its own paddles.
  { name: "canoe-hull", kit: "pirate", source: "boat-row-small.glb", targetHeight: 3.4, scaleAxis: "x" },
  // Ruin (site-fallen-idol-ruin): worked-stone wall/column/rubble pieces —
  // the fallen statue head + gaze rig + soil pits stay procedural
  // (`src/world/landmarks.ts`'s `ruinGazeRig`, no CC0 model fits them).
  { name: "ruin-wall", kit: "graveyard", source: "stone-wall.glb", targetHeight: 2.6, tint: STONE_TINT },
  { name: "ruin-wall-damaged", kit: "graveyard", source: "stone-wall-damaged.glb", targetHeight: 2.2, tint: STONE_TINT },
  { name: "ruin-column", kit: "graveyard", source: "column-large.glb", targetHeight: 1.8, tint: STONE_TINT },
  { name: "ruin-debris", kit: "graveyard", source: "debris.glb", targetHeight: 0.9, scaleAxis: "x", tint: STONE_TINT },
  // Remains (site-last-camp): the lost expedition's dropped tools, alongside
  // the still-procedural cairn/pack/bones.
  { name: "tool-axe", kit: "survival", source: "tool-axe.glb", targetHeight: 0.9 },
  { name: "tool-shovel", kit: "survival", source: "tool-shovel.glb", targetHeight: 1.0 },
].map((m) => ({ ...m, colorMode: "texture", outDir: "objects" }));

async function ensureKitZip(kit) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const zipPath = join(CACHE_DIR, kit.zipName);
  if (existsSync(zipPath) && statSync(zipPath).size > 0) {
    console.log(`  cached: ${zipPath}`);
    return zipPath;
  }
  console.log(`  downloading ${kit.url}`);
  const res = await fetch(kit.url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`download failed (${res.status}): ${kit.url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await import("node:fs/promises").then((fs) => fs.writeFile(zipPath, bytes));
  return zipPath;
}

/** Extract just the source GLBs a job uses, plus the kit's shared
 *  `Textures/colormap.png` (every "Survival"/"Pirate"/"Graveyard" model
 *  references it by relative URI, even though the GLB's mesh data is
 *  self-contained — `gltf-transform`'s `NodeIO` resolves that URI relative to
 *  `destDir`, so it must land alongside the models it's read for). `unzip -j`
 *  junks the internal path so both land flat in `destDir`. */
function extractSources(zipPath, kit, sourceNames, destDir) {
  mkdirSync(destDir, { recursive: true });
  const members = sourceNames.map((n) => `${kit.modelsDir}/${n}`);
  execFileSync("unzip", ["-o", "-j", zipPath, ...members, "-d", destDir], { stdio: "pipe" });
  try {
    const texDir = join(destDir, "Textures");
    mkdirSync(texDir, { recursive: true });
    execFileSync("unzip", ["-o", "-j", zipPath, `${kit.modelsDir}/Textures/colormap.png`, "-d", texDir], {
      stdio: "pipe",
    });
  } catch {
    // Nature Kit's untextured KHR_materials_unlit models have no colormap —
    // fine, `colorMode: "material"` never looks for one.
  }
}

// FLORA's step 2's RECOLOR map: Kenney's own `baseColorFactor` per material
// reads cool and mint/teal (`leafsGreen` is `[0.16, 0.79, 0.67]` — nearer cyan
// than green) against THIS island's warm jungle palette (`docs/art-direction.md`;
// the exact hex tokens `src/world/props.ts` already uses for the procedural
// fallback this replaces) — visually confirmed via a real Playwright
// screenshot before this map existed: canopy/palm foliage read as a pale,
// washed-out cyan rather than jungle green. An unrecognized name falls back to
// the source colour so a future model swap never silently renders black.
const RECOLOR_BY_MATERIAL_NAME = {
  woodBark: [0x5c / 255, 0x44 / 255, 0x30 / 255], // WOOD_CANOPY (props.ts)
  leafsGreen: [0x4a / 255, 0x7d / 255, 0x3f / 255], // FROND_GREEN (props.ts)
  grass: [0x5b / 255, 0x8f / 255, 0x4a / 255], // "grass" art-direction token — also the moss-patch colour on rocks
  dirt: [0x7c / 255, 0x82 / 255, 0x72 / 255], // ROCK_MOSSY (props.ts)
  _defaultMat: [0x7c / 255, 0x82 / 255, 0x72 / 255], // ROCK_MOSSY fallback (rock_largeD's 3rd material)
};

/** `colorMode: "material"` — bake each primitive's flat (recoloured)
 *  `baseColorFactor` into COLOR_0.
 *
 *  COLOR-SPACE (jungle-feel review finding, 2026-07-19): three treats
 *  `COLOR_0` as LINEAR, and the RECOLOR map's tuples are sRGB bytes (the
 *  props.ts hex tokens) — baking them raw rendered every flora model ONE
 *  GAMMA TOO BRIGHT (`#4a7d3f` jungle green displayed as ≈`#93ba88` mint;
 *  the "pastel orchard" in every screenshot). The texture-mode bake below
 *  already runs its samples through `srgbToLinear` for exactly this reason;
 *  the recolor path now does the same. glTF's own `baseColorFactor` is
 *  linear per spec, so the no-recolor fallback stays unconverted. */
function bakeVertexColorFromMaterial(doc) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial();
      const recolorSrgb = material && RECOLOR_BY_MATERIAL_NAME[material.getName()];
      const recolor = recolorSrgb ? recolorSrgb.map(srgbToLinear) : null;
      const [r, g, b] = recolor ?? (material ? material.getBaseColorFactor() : [1, 1, 1, 1]);
      const positions = prim.getAttribute("POSITION");
      const count = positions.getCount();
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      }
      prim.setAttribute("COLOR_0", doc.createAccessor().setType("VEC3").setArray(colors));
    }
  }
}

/** `colorMode: "texture"` — sample each primitive's base-colour texture atlas
 *  at every vertex's own UV0 and bake the sampled RGB into COLOR_0 (see this
 *  file's header doc for why: the Survival/Pirate/Graveyard kits carry one
 *  shared textured "colormap" material per model, not a flat per-material
 *  factor).
 *
 *  The atlas PNG is sRGB-ENCODED (as any authored colour image is), but
 *  `sharp(...).raw()` hands back the raw encoded bytes unchanged — dividing
 *  by 255 alone yields an sRGB-encoded [0,1] value, NOT a linear one. Three's
 *  renderer treats `COLOR_0` as already-linear (it never colour-manages
 *  vertex attributes the way it does a `sRGBColorSpace`-tagged texture), so
 *  every sampled byte is run through `srgbToLinear` (the same IEC 61966-2-1
 *  EOTF as `THREE.Color.convertSRGBToLinear`) BEFORE anything else touches it
 *  — this was missing in an earlier version of this bake and left all 13
 *  Kenney object models reading washed-out/over-bright next to the vertex
 *  colours baked by `bakeVertexColorFromMaterial` (which never round-trips
 *  through PNG bytes, so never had this bug). `tint` (default `[1,1,1]`, ALSO
 *  linear-space) applies a component-wise multiplier AFTER that conversion,
 *  for the same "correct Kenney's colour to this world's palette" reason
 *  `RECOLOR_BY_MATERIAL_NAME` exists for the flora job. */
async function bakeVertexColorFromTexture(doc, tint = [1, 1, 1]) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial();
      const tex = material?.getBaseColorTexture();
      const uv = prim.getAttribute("TEXCOORD_0");
      const positions = prim.getAttribute("POSITION");
      const count = positions.getCount();
      const colors = new Float32Array(count * 3);
      if (tex && uv) {
        const image = tex.getImage();
        const { data, info } = await sharp(Buffer.from(image))
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        const el = [0, 0];
        for (let i = 0; i < count; i++) {
          uv.getElement(i, el);
          const px = texelIndex(el[0], info.width);
          const py = texelIndex(el[1], info.height);
          const idx = (py * info.width + px) * info.channels;
          colors[i * 3] = srgbToLinear(data[idx] / 255) * tint[0];
          colors[i * 3 + 1] = srgbToLinear(data[idx + 1] / 255) * tint[1];
          colors[i * 3 + 2] = srgbToLinear(data[idx + 2] / 255) * tint[2];
        }
      } else {
        colors.fill(0.6); // no texture found — flat mid-grey, never black.
      }
      prim.setAttribute("COLOR_0", doc.createAccessor().setType("VEC3").setArray(colors));
    }
  }
}

async function processOne(io, spec, srcDir, outDir) {
  const { name, source, targetHeight, scaleAxis = "y", colorMode, tint } = spec;
  const inPath = join(srcDir, source);
  const doc = await io.read(inPath);
  const root = doc.getRoot();

  // Step 2: bake colour into COLOR_0 (see this file's header doc for the two
  // `colorMode`s and why they differ).
  if (colorMode === "texture") {
    await bakeVertexColorFromTexture(doc, tint);
  } else {
    bakeVertexColorFromMaterial(doc);
  }

  // Step 3: one shared dummy material so `join` can merge every primitive
  // (previously split across per-part materials) into one draw call.
  // `flatten()` runs FIRST — some Survival/Pirate/Graveyard-kit models split
  // parts across a PARENT-CHILD node pair (e.g. bedroll.glb's "blanket" node
  // is a CHILD of its "bedroll" node, not a sibling), unlike the flora job's
  // Nature Kit models, which split parts across PRIMITIVES within one node
  // instead. `join`'s own merge (`_joinLevel`) only combines SIBLING nodes at
  // the same hierarchy depth, so a child-of-a-mesh-node is invisible to it —
  // confirmed by a real bedroll.glb probe that came out of `join` alone still
  // as 2 separate meshes. `flatten()` reparents every node to the scene root
  // first (baking each node's own accumulated world transform into itself, via
  // its own `clearNodeParent`), turning that parent-child pair into siblings
  // `join` can then merge — re-verified on the same bedroll.glb probe.
  const shared = doc.createMaterial("baked");
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) prim.setMaterial(shared);
  }
  await doc.transform(flatten(), dedup(), joinPrimitives({ keepMeshes: false, keepNamed: false }));

  // Step 4: rescale + ground by mutating the merged primitive's OWN vertex
  // array directly (NOT the node transform — see this file's header doc).
  // The scale factor comes from the model's OWN local bbox range along
  // `scaleAxis` (default "y"); grounding (min-Y -> 0) always happens on Y
  // regardless of which axis drove the scale, so a wide-but-short model (a
  // rowboat hull, a campfire ring) can be sized by its length/width instead of
  // a height it was never tall to begin with.
  const meshNode = root.listNodes().find((n) => n.getMesh());
  const prim = meshNode.getMesh().listPrimitives()[0];
  const positionAccessor = prim.getAttribute("POSITION");
  const positions = positionAccessor.getArray().slice();
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] < minX) minX = positions[i];
    if (positions[i] > maxX) maxX = positions[i];
    if (positions[i + 1] < minY) minY = positions[i + 1];
    if (positions[i + 1] > maxY) maxY = positions[i + 1];
    if (positions[i + 2] < minZ) minZ = positions[i + 2];
    if (positions[i + 2] > maxZ) maxZ = positions[i + 2];
  }
  const range = { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
  const scale = targetHeight / range[scaleAxis];
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] *= scale;
    positions[i + 1] = (positions[i + 1] - minY) * scale;
    positions[i + 2] *= scale;
  }
  positionAccessor.setArray(positions);

  // Step 5: prune the now-dead per-primitive materials/textures (for
  // `colorMode: "texture"` this drops the shipped colormap.png reference
  // entirely — only the baked COLOR_0 survives), quantize geometry.
  await doc.transform(prune(), quantize());

  // The shared dummy material never uses `KHR_materials_unlit` — only the
  // discarded per-primitive source materials (flora job) did, and `prune()`
  // drops those but leaves the extension's OWN declaration dangling (harmless
  // per `gltf-transform validate`, but needless output bytes/noise — every
  // downstream consumer ignores the glTF material entirely and applies its
  // own lit `MeshStandardMaterial`).
  const unlitExt = root.listExtensionsUsed().find((e) => e.extensionName === "KHR_materials_unlit");
  unlitExt?.dispose();

  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${name}.glb`);
  await io.write(outPath, doc);
  const kb = (statSync(outPath).size / 1024).toFixed(2);
  const triCount = prim.getIndices() ? prim.getIndices().getCount() / 3 : positions.length / 3 / 3;
  console.log(`  ${name}.glb — ${Math.round(triCount)} tri, ${kb} KB (from ${source})`);
}

async function runJob(io, jobName, models) {
  console.log(`\n== ${jobName} ==`);
  const byKit = new Map();
  for (const m of models) {
    if (!byKit.has(m.kit)) byKit.set(m.kit, []);
    byKit.get(m.kit).push(m);
  }

  const srcDirByKit = new Map();
  for (const [kitName, kitModels] of byKit) {
    const kit = KITS[kitName];
    const zipPath = await ensureKitZip(kit);
    const srcDir = join(CACHE_DIR, `extracted-${kitName}`);
    extractSources(
      zipPath,
      kit,
      kitModels.map((m) => m.source),
      srcDir,
    );
    srcDirByKit.set(kitName, srcDir);
  }

  const outDir = resolve(REPO_ROOT, "public/assets/models", models[0].outDir);
  for (const model of models) {
    await processOne(io, model, srcDirByKit.get(model.kit), outDir);
  }

  const files = readdirSync(outDir).filter((f) => f.endsWith(".glb"));
  const total = files.reduce((sum, f) => sum + statSync(join(outDir, f)).size, 0);
  console.log(`${files.length} files, ${(total / 1024).toFixed(1)} KB total`);
}

async function main() {
  console.log(`cache: ${CACHE_DIR}`);

  // `KHRMeshQuantization` must be registered for the WRITE side too — `quantize()`
  // (step 5) produces normalized-integer POSITION/NORMAL accessors that are only
  // spec-valid under that extension; without registering it here the writer
  // silently drops the `KHR_mesh_quantization` extensionsUsed declaration and
  // three's `GLTFLoader` cannot be relied on to decode the un-flagged quantized
  // data correctly (a real bug the flora job's first draft shipped, caught by
  // `gltf-transform validate` flagging `MESH_PRIMITIVE_ATTRIBUTES_ACCESSOR_INVALID_FORMAT`).
  const io = new NodeIO().registerExtensions([KHRMaterialsUnlit, KHRMeshQuantization]);

  await runJob(io, "flora", MODELS_FLORA);
  await runJob(io, "objects", MODELS_OBJECTS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
