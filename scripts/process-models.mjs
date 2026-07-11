// Flora model pipeline (visual-overhaul slice 6, flora & fauna).
//
// An authoring-time tool, run by hand — never at build or test time — that
// turns a handful of CC0 Kenney "Nature Kit" glTF models into the tiny
// quantized GLB payload `public/assets/models/flora/` ships. `@gltf-transform/*`
// (added as devDependencies, build-time only — they never reach the shipped
// bundle) does the actual mesh surgery; the system `unzip` binary extracts just
// the source `.glb` files this slice uses out of the kit's single zip.
//
//   node scripts/process-models.mjs
//
// SOURCE ASSET: Kenney "Nature Kit" (CC0 1.0 — see `public/assets/LICENSES.md`
// for the full record and the source-selection trail).
//
//   https://kenney.nl/assets/nature-kit
//   Direct download (found by following the site's donate-or-skip download
//   flow, not guessable from the pack page's static HTML alone):
//   https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip
//
// Quaternius (quaternius.com, the design doc's first-choice source) was tried
// first and rejected for THIS slice: every pack's "Just give me the download"
// button opens a Google Drive FOLDER (`drive.google.com/drive/folders/...`),
// which has no stable, scriptable direct-file URL (Google Drive folder listings
// require either browser JS rendering or an authenticated Drive API call) —
// exactly the "download mechanics defeat scripting" case the design doc
// anticipated. Kenney's flow, while also gated behind a donate-or-skip modal,
// resolves to one stable, curl-able `.zip` URL once followed, so it was used
// instead. Both sources are CC0; this is a scriptability finding, not a
// licensing one.
//
// Each zip is downloaded to a LOCAL CACHE outside the repo (default
// `<os.tmpdir()>/lost-idol-flora-models`, override with `FLORA_MODEL_CACHE`) —
// never committed; only the processed GLB output under
// `public/assets/models/flora/` is. Re-running the script reuses an
// already-cached zip instead of re-downloading it.
//
// PER-MODEL PIPELINE (`processOne`, all via the `@gltf-transform/core` +
// `@gltf-transform/functions` programmatic API — the CLI's single-purpose
// commands don't compose the custom "bake material colour into vertex colour"
// step this needs):
//
//   1. Read the source GLB (Kenney's kit ships each model as ~2 primitives —
//      e.g. a "woodBark" trunk primitive + a "leafsGreen" canopy primitive —
//      each an UNTEXTURED `KHR_materials_unlit` material with only a flat
//      `baseColorFactor`, confirmed by inspecting every candidate with
//      `gltf-transform inspect` before picking it: no textures anywhere in the
//      kit, so "drop textures unless trivially small" is moot here — there are
//      none to drop).
//   2. BAKE each primitive's colour into a per-vertex `COLOR_0` attribute
//      (every vertex in that primitive gets the same flat RGB) — this is what
//      lets step 3 merge primitives that used to need separate materials
//      (bark vs leaves) into ONE draw call while keeping the two-tone look,
//      the same "vertex colour instead of a material split" discipline
//      `props.ts`'s `stampColor` already uses for the procedural geometry
//      this replaces. The colour itself is RECOLOURED by material NAME
//      (`RECOLOR_BY_MATERIAL_NAME`, not the source `baseColorFactor`) to this
//      island's own warm-jungle palette tokens — Kenney's own colours read
//      cool/mint (`leafsGreen` is nearer cyan than green), confirmed visually
//      via a real Playwright screenshot before this map existed (washed-out
//      pale-cyan canopies against the world's warm light).
//   3. Reassign every primitive to one shared dummy material, then run
//      `dedup()` + `join({ keepMeshes: false, keepNamed: false })` — merges
//      every primitive in the file into ONE mesh / ONE draw call (the "keep
//      our one-material-per-InstancedMesh discipline" requirement). The
//      dummy material is pruned away by step 5; only geometry + `COLOR_0`
//      matters at runtime (`src/world/floraUpgrade.ts` extracts `.geometry`
//      and applies its OWN lit `MeshStandardMaterial`, ignoring whatever
//      material the glTF carries — see that module's own doc for why the
//      renderer's lit, flat-shaded convention must own materials, not an
//      unlit Kenney passthrough).
//   4. RESCALE + GROUND to this world's existing scale: Kenney's kit is
//      authored at roughly 1 world-unit-per-metre grid scale (~1-2 units
//      tall), while `props.ts`'s existing procedural geometry (the fallback
//      this upgrades) is tuned to THIS island's own scale (a ~6-10 unit
//      canopy tree). Baked DIRECTLY into the merged primitive's `POSITION`
//      vertex array (never the mesh node's transform): read the primitive's
//      OWN local-space bbox straight off its `POSITION` accessor, compute the
//      uniform scale that maps its height to `targetHeight`, then rewrite
//      every vertex by that scale plus a grounding offset (local min-Y ->
//      world 0). This keeps the OUTPUT mesh's node at the identity transform,
//      which matters because the runtime loader
//      (`src/world/floraGlb.ts`) is a minimal purpose-built GLB parser that
//      reads ONLY `meshes[0].primitives[0]` and never touches `nodes`/
//      `scenes` at all (see that module's header doc for the byte-budget
//      finding that motivated skipping three's official `GLTFLoader`) — a
//      transform left on the node would be silently lost at load time. An
//      earlier cut of this step computed the right scale/ground but applied
//      it to the node instead, which this direct-vertex-bake replaced.
//   5. `prune()` (drop the now-unreferenced per-primitive materials/textures)
//      + `quantize()` (`KHR_mesh_quantization` — quantizes POSITION/NORMAL to
//      normalized int16 and COLOR_0 to normalized uint8, with `normalized:
//      true` set on the accessor so the GPU dequantizes for free; the design's
//      explicit "no decoder, it costs eager JS we don't have" constraint holds
//      doubly here since `floraGlb.ts` needs no decoder OR loader library at
//      all — it reads the quantized bytes directly into a `THREE.BufferAttribute`
//      with `normalized: true`).
//
// Output: `public/assets/models/flora/<name>.glb` — see the per-model table in
// this script's `MODELS` array below for the exact byte counts measured at the
// bottom of a run.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { KHRMaterialsUnlit, KHRMeshQuantization } from "@gltf-transform/extensions";
import { dedup, join as joinPrimitives, prune, quantize } from "@gltf-transform/functions";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const OUT_DIR = resolve(REPO_ROOT, "public/assets/models/flora");
const CACHE_DIR = process.env.FLORA_MODEL_CACHE ?? join(tmpdir(), "lost-idol-flora-models");

const KIT_URL =
  "https://kenney.nl/media/pages/assets/nature-kit/37ac38a37b-1677698939/kenney_nature-kit.zip";
const KIT_ZIP_NAME = "kenney_nature-kit.zip";

/**
 * The 7 models this slice ships, picked by inspecting every nature-kit
 * candidate's triangle count + bounding box (`gltf-transform inspect`) for a
 * jungle-plausible silhouette at a low triangle cost — every one of these is
 * under 200 triangles POST-merge (see the per-model log line each run prints).
 *
 * `category` groups models for `src/world/floraUpgrade.ts`'s variant split
 * (each category becomes 1 or more `InstancedMesh` draw calls, splitting the
 * SAME `props.ts` seeded instance count across its variants); `targetHeight`
 * is the world-unit height (see step 4 above) each model is rescaled to,
 * chosen to match the EXISTING procedural geometry it replaces so `props.ts`'s
 * per-instance random scale factor (0.6-1.6, unchanged) still reads right:
 *   - canopy:     old trunk (6.2) + foliage cross (3.6) ~= 9.8
 *   - palm:       old curved trunk (~4.4) + frond crown (~2.1) ~= 6.5
 *   - understory: old cross-plane height (1.2)
 *   - rock:       old dodecahedron (radius 1, ~1.6 total incl. its 0.3 lift)
 */
const MODELS = [
  { name: "canopy-a", source: "tree_default.glb", category: "canopy", targetHeight: 9.8 },
  { name: "canopy-b", source: "tree_oak.glb", category: "canopy", targetHeight: 9.8 },
  { name: "palm-a", source: "tree_palmTall.glb", category: "palm", targetHeight: 6.5 },
  { name: "understory-a", source: "plant_bushDetailed.glb", category: "understory", targetHeight: 1.2 },
  { name: "understory-b", source: "plant_flatTall.glb", category: "understory", targetHeight: 1.2 },
  { name: "rock-a", source: "rock_largeA.glb", category: "rock", targetHeight: 1.6 },
  { name: "rock-b", source: "rock_largeD.glb", category: "rock", targetHeight: 1.6 },
];

async function ensureKitZip() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const zipPath = join(CACHE_DIR, KIT_ZIP_NAME);
  if (existsSync(zipPath) && statSync(zipPath).size > 0) {
    console.log(`  cached: ${zipPath}`);
    return zipPath;
  }
  console.log(`  downloading ${KIT_URL}`);
  const res = await fetch(KIT_URL, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`download failed (${res.status}): ${KIT_URL}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await import("node:fs/promises").then((fs) => fs.writeFile(zipPath, bytes));
  return zipPath;
}

/** Extract just the source GLBs this slice uses (`unzip -j` junks the zip's
 *  internal `Models/GLTF format/` path so they land flat in `destDir`) — the
 *  Kit's ~330 other models, its Isometric/Blender/FBX siblings, etc. are never
 *  touched. */
function extractSources(zipPath, sourceNames, destDir) {
  mkdirSync(destDir, { recursive: true });
  const members = sourceNames.map((n) => `Models/GLTF format/${n}`);
  execFileSync("unzip", ["-o", "-j", zipPath, ...members, "-d", destDir], { stdio: "pipe" });
}

// Step 2's RECOLOR map: Kenney's own `baseColorFactor` per material reads cool
// and mint/teal (`leafsGreen` is `[0.16, 0.79, 0.67]` — nearer cyan than green)
// against THIS island's warm jungle palette (`docs/art-direction.md`; the exact
// hex tokens `src/world/props.ts` already uses for the procedural fallback this
// slice replaces) — visually confirmed via a real Playwright screenshot before
// this map existed: canopy/palm foliage read as a pale, washed-out cyan rather
// than jungle green. Recolouring by MATERIAL NAME (not trusting the source
// `baseColorFactor`) keeps every model consistent with the world's own tokens;
// an unrecognized name falls back to the source colour so a future model swap
// never silently renders black.
const RECOLOR_BY_MATERIAL_NAME = {
  woodBark: [0x5c / 255, 0x44 / 255, 0x30 / 255], // WOOD_CANOPY (props.ts)
  leafsGreen: [0x4a / 255, 0x7d / 255, 0x3f / 255], // FROND_GREEN (props.ts)
  grass: [0x5b / 255, 0x8f / 255, 0x4a / 255], // "grass" art-direction token — also the moss-patch colour on rocks
  dirt: [0x7c / 255, 0x82 / 255, 0x72 / 255], // ROCK_MOSSY (props.ts)
  _defaultMat: [0x7c / 255, 0x82 / 255, 0x72 / 255], // ROCK_MOSSY fallback (rock_largeD's 3rd material)
};

async function processOne(io, { name, source, targetHeight }, srcDir) {
  const inPath = join(srcDir, source);
  const doc = await io.read(inPath);
  const root = doc.getRoot();

  // Step 2: bake each primitive's (recoloured) flat colour into COLOR_0.
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial();
      const recolor = material && RECOLOR_BY_MATERIAL_NAME[material.getName()];
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

  // Step 3: one shared dummy material so `join` can merge every primitive
  // (previously split across "bark"/"leaves"/etc. materials) into one draw call.
  const shared = doc.createMaterial("flora");
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) prim.setMaterial(shared);
  }
  await doc.transform(dedup(), joinPrimitives({ keepMeshes: false, keepNamed: false }));

  // Step 4: rescale + ground by mutating the merged primitive's OWN vertex
  // array directly (NOT the node transform): the runtime side
  // (`src/world/floraGlb.ts`) is a minimal purpose-built GLB parser that reads
  // ONLY `meshes[0].primitives[0]` and never touches `nodes`/`scenes` at all
  // (a deliberate, measured trade against three's official `GLTFLoader` — see
  // that module's header doc for the byte-budget finding that motivated it),
  // so any transform living on the node would be silently lost at load time.
  // Baking it into the vertex data itself keeps the output mesh's node at the
  // identity transform, so a future GLTFLoader-based consumer would ALSO
  // render it correctly with no special-casing either way. Reads the merged
  // primitive's LOCAL bbox straight off its own POSITION accessor (never the
  // whole scene's bounds in world space) so the maths can't be thrown off by
  // a leftover source-file node offset — an earlier cut of this script
  // computed the target scale/ground correctly but applied it to the NODE,
  // which this runtime doesn't read; this direct-vertex-bake replaced it.
  const meshNode = root.listNodes().find((n) => n.getMesh());
  const prim = meshNode.getMesh().listPrimitives()[0];
  const positionAccessor = prim.getAttribute("POSITION");
  const positions = positionAccessor.getArray().slice();
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    if (positions[i] < minY) minY = positions[i];
    if (positions[i] > maxY) maxY = positions[i];
  }
  const scale = targetHeight / (maxY - minY);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] *= scale;
    positions[i + 1] = (positions[i + 1] - minY) * scale;
    positions[i + 2] *= scale;
  }
  positionAccessor.setArray(positions);

  // Step 5: prune the now-dead per-primitive materials, quantize geometry.
  await doc.transform(prune(), quantize());

  // The shared dummy material (step 3) never uses `KHR_materials_unlit` — only
  // the discarded per-primitive source materials did, and `prune()` above drops
  // those materials but leaves the extension's OWN declaration dangling
  // (harmless per `gltf-transform validate`, but needless output bytes/noise:
  // every downstream consumer, including `src/world/floraUpgrade.ts`, ignores
  // the glTF material entirely and applies its own lit `MeshStandardMaterial`).
  // Explicitly dispose it so the shipped file's `extensionsUsed` only lists the
  // one extension the quantized geometry actually needs.
  const unlitExt = root.listExtensionsUsed().find((e) => e.extensionName === "KHR_materials_unlit");
  unlitExt?.dispose();

  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, `${name}.glb`);
  await io.write(outPath, doc);
  const kb = (statSync(outPath).size / 1024).toFixed(2);
  const triCount = prim.getIndices() ? prim.getIndices().getCount() / 3 : positions.length / 3 / 3;
  console.log(`  ${name}.glb — ${Math.round(triCount)} tri, ${kb} KB (from ${source})`);
}

async function main() {
  console.log(`cache: ${CACHE_DIR}`);
  console.log(`output: ${OUT_DIR}\n`);

  const zipPath = await ensureKitZip();
  const srcDir = join(CACHE_DIR, "extracted");
  extractSources(
    zipPath,
    MODELS.map((m) => m.source),
    srcDir,
  );

  // `KHRMeshQuantization` must be registered for the WRITE side too — `quantize()`
  // (step 5) produces normalized-integer POSITION/NORMAL accessors that are only
  // spec-valid under that extension; without registering it here the writer
  // silently drops the `KHR_mesh_quantization` extensionsUsed declaration (a
  // real bug this script's first draft shipped — caught by
  // `gltf-transform validate` flagging `MESH_PRIMITIVE_ATTRIBUTES_ACCESSOR_INVALID_FORMAT`
  // on every output file) and three's `GLTFLoader` cannot be relied on to
  // decode the un-flagged quantized data correctly.
  const io = new NodeIO().registerExtensions([KHRMaterialsUnlit, KHRMeshQuantization]);
  for (const model of MODELS) {
    await processOne(io, model, srcDir);
  }

  const files = readdirSync(OUT_DIR).filter((f) => f.endsWith(".glb"));
  const total = files.reduce((sum, f) => sum + statSync(join(OUT_DIR, f)).size, 0);
  console.log(`\n${files.length} files, ${(total / 1024).toFixed(1)} KB total`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
