import { describe, expect, it } from "vitest";
import {
  checkBundleBudget,
  type BundleVerdict,
  type MeasuredArtifact,
} from "./bundleBudget.ts";
import { PERF_BUDGET, type PerfBudget } from "./perfBudget.ts";

// All fixtures express bytes so the test owns the byte→KB math and can prove
// the divisor (decimal /1000) and the unrounded comparison, not just trust it.
// Caps under test: maxJsGzipKb = 432, maxInitialDownloadKb = 6000.

/** A JS artifact whose gzip payload is `gzipBytes`; rawBytes is irrelevant to
 *  the JS-cap and initial-download(js) sums but is set to a plausible value. */
function js(name: string, gzipBytes: number, rawBytes = gzipBytes * 3): MeasuredArtifact {
  return { name, kind: "js", gzipBytes, rawBytes };
}

function css(name: string, gzipBytes: number, rawBytes = gzipBytes * 3): MeasuredArtifact {
  return { name, kind: "css", gzipBytes, rawBytes };
}

function text(name: string, gzipBytes: number, rawBytes = gzipBytes * 3): MeasuredArtifact {
  return { name, kind: "text", gzipBytes, rawBytes };
}

function other(name: string, gzipBytes: number, rawBytes: number): MeasuredArtifact {
  return { name, kind: "other", gzipBytes, rawBytes };
}

describe("checkBundleBudget", () => {
  it("flags a jsGzip breach with a self-consistent 1-dp measured-vs-cap delta message (sub-1-KB-over)", () => {
    // 432,400 B gzip = 432.4 KB > 432 KB cap, over by 0.4 KB. A whole-KB
    // message would read "432 KB > cap 432 KB (over by 0 KB)" — a contradiction.
    // The 1-dp rendering must keep it legible and truthful.
    const verdict = checkBundleBudget([js("index.js", 432_400)]);

    expect(verdict.overBudget).toBe(true);
    expect(verdict.jsGzipKb).toBeCloseTo(432.4, 6);

    expect(verdict.breaches).toHaveLength(1);
    const breach = verdict.breaches[0];
    expect(breach.metric).toBe("jsGzip");
    expect(breach.measuredKb).toBeCloseTo(432.4, 6);
    expect(breach.capKb).toBe(432);
    expect(breach.overByKb).toBeCloseTo(0.4, 6);
    expect(breach.message).toBe(
      "JS gzip 432.4 KB > cap 432 KB (over by 0.4 KB)",
    );

    // Self-consistency: the message must never read "X KB > cap X KB (over by 0 KB)".
    expect(breach.message).not.toMatch(/(\d+(?:\.\d+)?) KB > cap \1 KB/);
    expect(breach.message).not.toMatch(/over by 0 KB\b/);
  });

  it("sums gzipBytes of kind==='js' artifacts only for the JS cap (css/text/other excluded)", () => {
    // 216 KB js + 216.05 KB js = 432.05 KB > 432 cap. The css/text/other
    // artifacts, despite huge gzip/raw payloads, must NOT count toward jsGzip.
    const verdict = checkBundleBudget([
      js("a.js", 216_000),
      js("b.js", 216_050),
      css("style.css", 500_000),
      text("index.html", 500_000),
      other("model.glb", 1_000, 500_000),
    ]);

    expect(verdict.jsGzipKb).toBeCloseTo(432.05, 6);
    expect(verdict.overBudget).toBe(true);
    expect(verdict.breaches.some((b) => b.metric === "jsGzip")).toBe(true);
  });

  it("walks EVERY artifact for initial-download; an 'other' artifact is counted by rawBytes (binary branch)", () => {
    // JS is small (within cap). The 'other' artifact has tiny gzipBytes but a
    // huge rawBytes — already-compressed binary ships at raw size. If the walk
    // (wrongly) used gzipBytes for 'other', the total would be ~0.3 MB and pass.
    // Using rawBytes, it is 6.2 MB > 6000 KB cap. This proves the binary branch.
    const verdict = checkBundleBudget([
      js("index.js", 100_000),
      other("audio-bed.opus", 5_000, 6_200_000),
    ]);

    // JS branch must NOT breach (100 KB < 432 cap).
    expect(verdict.breaches.some((b) => b.metric === "jsGzip")).toBe(false);

    // 100,000 (js gzip) + 6,200,000 (other raw) = 6,300,000 B = 6300 KB.
    expect(verdict.initialDownloadKb).toBeCloseTo(6300, 6);
    expect(verdict.overBudget).toBe(true);

    const breach = verdict.breaches.find((b) => b.metric === "initialDownload");
    expect(breach).toBeDefined();
    expect(breach!.measuredKb).toBeCloseTo(6300, 6);
    expect(breach!.capKb).toBe(6000);
    expect(breach!.overByKb).toBeCloseTo(300, 6);
    expect(breach!.message).toBe(
      "initial download 6300.0 KB > cap 6000 KB (over by 300.0 KB)",
    );
  });

  it("counts a 'text' artifact by gzipBytes in the initial-download walk", () => {
    // A 'text' entry doc (HTML/SVG) ships gzipped. With js+text gzip summing
    // over the cap, the text artifact must be counted by its gzipBytes, not raw.
    const verdict = checkBundleBudget([
      js("index.js", 5_900_000),
      text("index.html", 200_000), // gzip; rawBytes default 600_000 must be ignored
    ]);

    // 5,900,000 + 200,000 = 6,100,000 B = 6100 KB (gzip for text, not raw).
    expect(verdict.initialDownloadKb).toBeCloseTo(6100, 6);
    expect(verdict.overBudget).toBe(true);
    expect(
      verdict.breaches.some((b) => b.metric === "initialDownload"),
    ).toBe(true);
  });

  it("reports overBudget=false with headroom derivable from the verdict numbers when both checks are under", () => {
    const verdict: BundleVerdict = checkBundleBudget([
      js("index.js", 150_000),
      css("style.css", 10_000),
      text("index.html", 2_000),
      other("model.glb", 1_000, 500_000),
    ]);

    expect(verdict.overBudget).toBe(false);
    expect(verdict.breaches).toEqual([]);

    // jsGzip = 150 KB; initial = 150 + 10 + 2 + 500 (other by raw) = 662 KB.
    expect(verdict.jsGzipKb).toBeCloseTo(150, 6);
    expect(verdict.initialDownloadKb).toBeCloseTo(662, 6);

    // Headroom is derivable from the exposed numeric fields (no convenience field).
    expect(PERF_BUDGET.maxJsGzipKb - verdict.jsGzipKb).toBeCloseTo(282, 6);
    expect(
      PERF_BUDGET.maxInitialDownloadKb - verdict.initialDownloadKb,
    ).toBeCloseTo(5338, 6);
  });

  it("returns 0/0 with no breach for an empty artifact list (no NaN, no false breach)", () => {
    const verdict = checkBundleBudget([]);
    expect(verdict.jsGzipKb).toBe(0);
    expect(verdict.initialDownloadKb).toBe(0);
    expect(verdict.overBudget).toBe(false);
    expect(verdict.breaches).toEqual([]);
    expect(Number.isNaN(verdict.jsGzipKb)).toBe(false);
    expect(Number.isNaN(verdict.initialDownloadKb)).toBe(false);
  });

  it("orders breaches deterministically: jsGzip first, then initialDownload", () => {
    // Breach BOTH caps at once: a single huge JS artifact blows the JS cap and,
    // counted into the walk, also blows the initial-download cap.
    const verdict = checkBundleBudget([js("index.js", 7_000_000)]);

    expect(verdict.overBudget).toBe(true);
    expect(verdict.breaches.map((b) => b.metric)).toEqual([
      "jsGzip",
      "initialDownload",
    ]);
  });

  it("uses a strict greater-than boundary: measured == cap is within budget", () => {
    // Exactly at both caps: jsGzip 400 KB, initial download 6000 KB.
    // 400,000 B js = 400 KB == cap; pad to exactly 6000 KB total with 'other' raw.
    const verdict = checkBundleBudget([
      js("index.js", 400_000), // exactly 400 KB jsGzip and 400 KB in the walk
      other("assets.bin", 0, 5_600_000), // + 5600 KB raw = 6000 KB total
    ]);

    expect(verdict.jsGzipKb).toBeCloseTo(400, 6);
    expect(verdict.initialDownloadKb).toBeCloseTo(6000, 6);
    expect(verdict.overBudget).toBe(false);
    expect(verdict.breaches).toEqual([]);
  });

  it("uses decimal /1000 (KB), not /1024 (KiB), for both checks", () => {
    // 1,500,000 B => 1500.0 KB decimal (not 1464.84 KiB). Asserting the exact
    // decimal value pins the divisor.
    const verdict = checkBundleBudget([js("index.js", 1_500_000)]);
    expect(verdict.jsGzipKb).toBeCloseTo(1500, 6);
    expect(verdict.initialDownloadKb).toBeCloseTo(1500, 6);
  });

  it("compares on unrounded KB so a sub-1-KB-over chunk is not rounded away", () => {
    // 432,001 B = 432.001 KB > 432 cap by 0.001 KB. A rounded-to-whole-KB
    // comparison (432 == 432) would miss this; the unrounded compare must catch it.
    const verdict = checkBundleBudget([js("index.js", 432_001)]);
    expect(verdict.overBudget).toBe(true);
    expect(verdict.breaches.some((b) => b.metric === "jsGzip")).toBe(true);
  });

  it("single-sources the caps from the budget argument (mutate budget flips the verdict)", () => {
    const artifacts = [js("index.js", 200_000)]; // 200 KB jsGzip, 200 KB initial

    // Default budget (432 KB cap): within.
    expect(checkBundleBudget(artifacts).overBudget).toBe(false);

    // A tiny JS cap over the SAME artifacts flips pass -> breach.
    const tight: PerfBudget = { ...PERF_BUDGET, maxJsGzipKb: 100 };
    const tightVerdict = checkBundleBudget(artifacts, tight);
    expect(tightVerdict.overBudget).toBe(true);
    expect(tightVerdict.breaches.some((b) => b.metric === "jsGzip")).toBe(true);

    // Lifting the cap back up clears it again — proving the cap comes from the
    // argument, not a hardcoded constant.
    const loose: PerfBudget = { ...PERF_BUDGET, maxJsGzipKb: 100_000 };
    expect(checkBundleBudget(artifacts, loose).overBudget).toBe(false);
  });
});
