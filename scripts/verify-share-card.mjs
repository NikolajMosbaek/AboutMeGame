// Served-URL verifier for the social share card (#54 — T5).
//
// The earlier suites prove the artifact and the markup in isolation
// (src/branding/*.test.ts): the committed PNG is 1200x630, and index.html
// declares og:image/twitter:image via %BASE_URL%. What none of them can prove
// from a headless jsdom test is the thing a real scraper does: fetch the
// meta-resolved URL over HTTP and get back a real PNG. A %BASE_URL% typo, a
// missing public/ copy, or a wrong sub-path would leave every unit suite green
// while a pasted link unfurls blank — the exact bug this feature exists to kill.
//
// This script closes that seam end to end against the production build served by
// `vite preview` (which serves under the GitHub Pages sub-path, matching
// deploy). It:
//   1. asserts the built dist/share-card.png exists and its real IHDR pixels are
//      1200x630 (proven from the bytes, not metadata),
//   2. asserts dist/index.html rewrote the %BASE_URL% token to the sub-path
//      (the literal token must not survive into the shipped HTML),
//   3. starts `vite preview`, then fetches the meta-resolved
//      /AboutMeGame/share-card.png and asserts HTTP 200 + Content-Type
//      image/png — CITING the status line and header.
//
// Run after a build:
//   npm run build && node scripts/verify-share-card.mjs
//
// Exits non-zero on any failure so it works as a verification gate.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
// `vite preview` serves under the same base as the build. Keep this in sync
// with vite.config.ts (VITE_BASE ?? "/AboutMeGame/").
const BASE = process.env.VITE_BASE ?? "/AboutMeGame/";
const PORT = Number(process.env.PREVIEW_PORT ?? "4321");

const failures = [];
function check(label, ok, detail) {
  const tag = ok ? "PASS" : "FAIL";
  console.log(`[${tag}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

/** Parse width/height from a PNG's IHDR chunk, proving the bytes are a real PNG. */
function readPngDimensions(buf) {
  if (buf.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("not a PNG (bad signature)");
  }
  if (buf.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("PNG missing IHDR chunk");
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// --- 1. Built PNG exists with the right real pixels -------------------------
const distPng = resolve(root, "dist/share-card.png");
if (existsSync(distPng)) {
  const { width, height } = readPngDimensions(readFileSync(distPng));
  check(
    "dist/share-card.png is 1200x630 (real IHDR pixels)",
    width === 1200 && height === 630,
    `${width}x${height}`,
  );
} else {
  check("dist/share-card.png exists in the build output", false, "missing — run `npm run build` first");
}

// --- 2. dist/index.html rewrote the %BASE_URL% token ------------------------
const distHtml = existsSync(resolve(root, "dist/index.html"))
  ? readFileSync(resolve(root, "dist/index.html"), "utf8")
  : "";
const expectedImg = `${BASE}share-card.png`;
check(
  "dist/index.html no longer contains the literal %BASE_URL% token",
  distHtml.length > 0 && !distHtml.includes("%BASE_URL%"),
  distHtml.length === 0 ? "dist/index.html missing" : undefined,
);
check(
  `dist/index.html og:image resolves to ${expectedImg}`,
  distHtml.includes(`property="og:image" content="${expectedImg}"`),
);
check(
  `dist/index.html twitter:image resolves to ${expectedImg}`,
  distHtml.includes(`name="twitter:image" content="${expectedImg}"`),
);

// --- 3. Served fetch over the running preview -------------------------------
let preview;
try {
  preview = spawn(
    "npx",
    ["vite", "preview", "--port", String(PORT), "--strictPort"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: process.env },
  );
  preview.stderr.on("data", (d) => process.stderr.write(`[preview] ${d}`));

  const assetUrl = `http://localhost:${PORT}${BASE}share-card.png`;
  const res = await waitForServer(assetUrl, 20_000);

  const status = res.status;
  const contentType = res.headers.get("content-type") ?? "";
  // CITE the served evidence — the whole point of this check.
  console.log(`\n  GET ${assetUrl}`);
  console.log(`  HTTP ${status}`);
  console.log(`  Content-Type: ${contentType}\n`);

  check("served share-card.png returns HTTP 200", status === 200, `status ${status}`);
  check(
    "served share-card.png Content-Type is image/png",
    contentType.includes("image/png"),
    contentType || "(none)",
  );

  // The served bytes are themselves a 1200x630 PNG (end-to-end, not just dist/).
  const servedBytes = Buffer.from(await res.arrayBuffer());
  const { width, height } = readPngDimensions(servedBytes);
  check(
    "served share-card.png bytes are a 1200x630 PNG",
    width === 1200 && height === 630,
    `${width}x${height}`,
  );
} catch (err) {
  check("preview server responds at the meta-resolved asset URL", false, String(err));
} finally {
  if (preview) preview.kill("SIGTERM");
}

/** Poll the asset URL until the preview server answers (or time out). */
async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      return res;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`preview never answered ${url}: ${lastErr}`);
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\nAll share-card served-URL checks passed.");
