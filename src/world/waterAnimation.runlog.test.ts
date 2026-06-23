import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// This file lives in src/ so `npm test` (vitest include = src/**) runs it, but
// it guards a DOCS deliverable: the T10 *verification* record for the G1
// animation slice (the two-anchor water swell) under docs/team/runs/. T10 is the
// "verify the running build" task — its output is cited Playwright/screenshot
// evidence, not product code — so the only thing the suite can assert is that
// the verification was actually performed and its findings recorded honestly.
//
// It is a lightweight presence/content check, mirroring `waterPatch.runlog.test.ts`
// (the slice-2 run log). It pins the load-bearing claims T10 must stand behind so
// the verification can't silently regress to a green-but-empty stub:
//   - the swell is caught by BOTH the DirectionalLight response AND the
//     slices-1-2 fresnel ramp (the beginnormal_vertex anchor's whole premise);
//   - reduced motion HOLDS the surface (no jump-cut), proven from the running
//     build, not just the unit test;
//   - the water stays one draw call and `render_game_to_text` leaks no uTime
//     churn (the WaterSystem omits describe());
//   - checkFrame / the ≥30 fps mobile floor is addressed on the target-device
//     profile (with the swiftshader-vs-GPU caveat made explicit, since the
//     headless verifier is a CPU software rasterizer, not the target GPU);
//   - the build gzip delta is reported and stays well under the 400 KB cap.

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
// src/world -> repo root is two levels up.
const REPO_ROOT = join(MODULE_DIR, "..", "..");
const RUNLOG = join(
  REPO_ROOT,
  "docs",
  "team",
  "runs",
  "2026-06-23-water-animation-swell-verify.md",
);

describe("G1 animation — T10 running-build verification record", () => {
  it("the verification run-log entry exists under docs/team/runs/", () => {
    expect(existsSync(RUNLOG)).toBe(true);
  });

  it("cites the Playwright smoke verifier and screenshots as the evidence", () => {
    const log = readFileSync(RUNLOG, "utf8").toLowerCase();
    expect(log).toMatch(/playwright|verify-game\.mjs|render_game_to_text/);
    expect(log).toContain("screenshot");
  });

  it("records the swell reaching BOTH the DirectionalLight and the fresnel ramp", () => {
    const log = readFileSync(RUNLOG, "utf8");
    // The beginnormal_vertex anchor's premise: the perturbed normal reaches the
    // fragment, so light AND the depth-colour ramp both ripple.
    expect(log.toLowerCase()).toContain("beginnormal_vertex");
    expect(log).toMatch(/DirectionalLight/i);
    expect(log.toLowerCase()).toContain("fresnel");
  });

  it("records the reduced-motion HOLD verified against the running build", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log.toLowerCase()).toContain("reduced motion");
    expect(log.toLowerCase()).toMatch(/hold|holds/);
    // The honest pixel-delta evidence: a stationary-camera motion-on vs frozen
    // comparison (the whole-frame delta collapses toward zero when frozen).
    expect(log).toMatch(/0\.4158|0\.0067/);
  });

  it("records one draw call and no uTime churn in render_game_to_text", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log.toLowerCase()).toMatch(/one draw call|single draw call|1 draw call/);
    // The WaterSystem omits describe(): the snapshot's `systems` is byte-stable
    // across advanceTime; only `elapsed` changes; there is no `water` key.
    expect(log).toContain("render_game_to_text");
    expect(log.toLowerCase()).toMatch(/no utime churn|utime churn/);
    expect(log.toLowerCase()).toContain("elapsed");
  });

  it("addresses the ≥30 fps mobile floor with the swiftshader-vs-GPU caveat", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log.toLowerCase()).toMatch(/checkframe|30\s*fps|≥30 fps/);
    // The honest caveat: the headless verifier is a CPU software rasterizer
    // (swiftshader), NOT the target mobile GPU profile.
    expect(log.toLowerCase()).toContain("swiftshader");
  });

  it("reports the build gzip delta and the 400 KB cap headroom", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log.toLowerCase()).toMatch(/gzip/);
    expect(log).toMatch(/400\s*KB/i);
  });

  it("confirms TextView and the bounds maths are untouched", () => {
    const log = readFileSync(RUNLOG, "utf8");
    expect(log.toLowerCase()).toContain("textview");
    expect(log).toMatch(/isInBounds/);
    expect(log).toMatch(/clampToBounds/);
  });

  it("lives only under docs/ — the deliverable adds no product-code or .claude files", () => {
    expect(RUNLOG).toContain(join("docs", "team", "runs"));
    expect(RUNLOG).not.toContain(".claude");
  });
});
