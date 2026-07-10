// Terrain texture pipeline (visual-overhaul slice 3, PBR terrain splatting).
//
// An authoring-time tool, run by hand — never at build or test time — that
// turns 4 CC0 ambientCG material sets into the WebP payload
// `public/assets/textures/terrain/` ships. `sharp` (added as a devDependency,
// build-time only — it never reaches the shipped bundle) does the resize +
// re-encode; the system `unzip` binary (present on every dev machine and the
// `ubuntu-latest` CI runner) extracts just the two source images this slice
// uses out of each multi-gigabyte-capable zip.
//
//   node scripts/process-textures.mjs
//
// SOURCE ASSETS (all ambientCG, CC0 — see `public/assets/LICENSES.md` for the
// full record). Chosen by downloading + looking at the albedo previews (not
// guessed from tags alone): a lush, unmown jungle floor (not a manicured
// lawn), a mossy leaf-litter forest floor, a mossy jungle rock face (not a
// masonry-block cliff), and a warm river-mud/wet-sand tone matching the
// original `colorForHeight` waterline band (`0x8a7a55`).
//
//   jungleFloor : https://ambientcg.com/a/Grass001  (Grass001_1K-JPG.zip)
//   leafLitter  : https://ambientcg.com/a/Ground037  (Ground037_1K-JPG.zip)
//   rock        : https://ambientcg.com/a/Rock057    (Rock057_1K-JPG.zip)
//   sand        : https://ambientcg.com/a/Ground054  (Ground054_1K-JPG.zip)
//   Direct download pattern: https://ambientcg.com/get?file=<AssetID>_1K-JPG.zip
//
// Each zip is downloaded to a LOCAL CACHE outside the repo (default
// `<os.tmpdir()>/lost-idol-terrain-textures`, override with
// `TERRAIN_TEXTURE_CACHE`) — never committed; only the processed WebP output
// under `public/assets/textures/terrain/` is. Re-running the script reuses an
// already-cached zip instead of re-downloading it.
//
// Per texture: `<Stem>_Color.jpg` → resize 1024x1024 → WebP q80 → `<name>-
// albedo.webp`; `<Stem>_NormalGL.jpg` (OpenGL +Y-up convention, matching
// WebGL/three) → resize 1024x1024 → WebP q90 → `<name>-normal.webp`. The
// normal map is encoded with NO colour-space conversion — sharp's resize
// operates on the raw stored bytes (no automatic gamma/ICC re-interpretation),
// which is exactly what's wanted: normal-map channels are directional data,
// not perceptual colour, and must reach the GPU byte-for-byte. The runtime
// half of "don't colour-manage the normal map" — tagging the loaded
// `THREE.Texture.colorSpace = THREE.NoColorSpace` (never the `loadTexture`
// default `SRGBColorSpace`) — lives in `src/world/terrain.ts`, not here.
//
// Roughness/AO maps ship in the source zips too but are deliberately NOT
// processed: the design scopes the fragment cost to "4 albedo (+4 normal on
// medium/high)" samples, and the material keeps its flat `roughness: 0.96`
// scalar (unchanged by this slice) rather than adding a 3rd sampler per
// channel.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const OUT_DIR = resolve(REPO_ROOT, "public/assets/textures/terrain");
const CACHE_DIR = process.env.TERRAIN_TEXTURE_CACHE ?? join(tmpdir(), "lost-idol-terrain-textures");

const SIZE = 1024;
const ALBEDO_QUALITY = 80;
const NORMAL_QUALITY = 90;

/** The 4 splat channels, matching `SPLAT_CHANNELS` in `src/world/terrainSplat.ts`
 *  and the `TEXTURE_STEM` map in `src/world/terrain.ts` — keep all three in
 *  sync if a channel is ever renamed. */
const TEXTURES = [
  { name: "jungle-floor", assetId: "Grass001" },
  { name: "leaf-litter", assetId: "Ground037" },
  { name: "rock", assetId: "Rock057" },
  { name: "sand", assetId: "Ground054" },
];

function downloadUrl(assetId) {
  return `https://ambientcg.com/get?file=${assetId}_1K-JPG.zip`;
}

async function ensureCached(assetId) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const zipPath = join(CACHE_DIR, `${assetId}_1K-JPG.zip`);
  if (existsSync(zipPath) && statSync(zipPath).size > 0) {
    console.log(`  cached: ${zipPath}`);
    return zipPath;
  }
  const url = downloadUrl(assetId);
  console.log(`  downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await import("node:fs/promises").then((fs) => fs.writeFile(zipPath, bytes));
  return zipPath;
}

/** Extract just the Color/NormalGL source images (`unzip -j` junks the zip's
 *  internal paths so they land flat in `destDir`) — the multi-gigabyte 4K/8K
 *  variants and the .blend/.usdc/.mtlx siblings in the same zip are never
 *  touched. */
function extractSources(zipPath, assetId, destDir) {
  mkdirSync(destDir, { recursive: true });
  execFileSync(
    "unzip",
    ["-o", "-j", zipPath, `${assetId}_1K-JPG_Color.jpg`, `${assetId}_1K-JPG_NormalGL.jpg`, "-d", destDir],
    { stdio: "pipe" },
  );
  return {
    color: join(destDir, `${assetId}_1K-JPG_Color.jpg`),
    normalGL: join(destDir, `${assetId}_1K-JPG_NormalGL.jpg`),
  };
}

async function processOne({ name, assetId }) {
  console.log(`${name} (${assetId})`);
  const zipPath = await ensureCached(assetId);
  const extractDir = join(CACHE_DIR, "extracted", assetId);
  const { color, normalGL } = extractSources(zipPath, assetId, extractDir);

  mkdirSync(OUT_DIR, { recursive: true });

  const albedoOut = join(OUT_DIR, `${name}-albedo.webp`);
  await sharp(color)
    .resize(SIZE, SIZE, { fit: "cover" })
    .webp({ quality: ALBEDO_QUALITY })
    .toFile(albedoOut);

  const normalOut = join(OUT_DIR, `${name}-normal.webp`);
  await sharp(normalGL)
    .resize(SIZE, SIZE, { fit: "cover" })
    .webp({ quality: NORMAL_QUALITY })
    .toFile(normalOut);

  for (const f of [albedoOut, normalOut]) {
    const kb = (statSync(f).size / 1024).toFixed(1);
    console.log(`  -> ${f} (${kb} KB)`);
  }
}

async function main() {
  console.log(`cache: ${CACHE_DIR}`);
  console.log(`output: ${OUT_DIR}\n`);
  for (const t of TEXTURES) {
    await processOne(t);
  }
  const files = readdirSync(OUT_DIR).filter((f) => f.endsWith(".webp"));
  const total = files.reduce((sum, f) => sum + statSync(join(OUT_DIR, f)).size, 0);
  console.log(`\n${files.length} files, ${(total / 1024).toFixed(1)} KB total`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
