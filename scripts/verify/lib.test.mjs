// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { resolveVerifyUrl, waitForReady } from "./lib.mjs";

describe("resolveVerifyUrl", () => {
  it("pins the default preview URL: port 4173 under /AboutMeGame/", () => {
    // Drift pin: must match `VITE_BASE ?? "/AboutMeGame/"` in vite.config.ts.
    expect(resolveVerifyUrl({ port: 4173, env: {} })).toBe(
      "http://localhost:4173/AboutMeGame/",
    );
  });

  it("honours the VITE_BASE env override", () => {
    expect(resolveVerifyUrl({ port: 4173, env: { VITE_BASE: "/other/" } })).toBe(
      "http://localhost:4173/other/",
    );
  });

  it('normalizes VITE_BASE="/" without a double slash', () => {
    expect(resolveVerifyUrl({ port: 4173, env: { VITE_BASE: "/" } })).toBe(
      "http://localhost:4173/",
    );
  });

  it("normalizes a base missing its leading/trailing slashes", () => {
    expect(resolveVerifyUrl({ port: 4173, env: { VITE_BASE: "other" } })).toBe(
      "http://localhost:4173/other/",
    );
  });

  it("prefers an explicit base over the env", () => {
    expect(
      resolveVerifyUrl({
        port: 5000,
        base: "/explicit/",
        env: { VITE_BASE: "/ignored/" },
      }),
    ).toBe("http://localhost:5000/explicit/");
  });
});

describe("waitForReady", () => {
  const URL = "http://localhost:4173/AboutMeGame/";
  /** Injected sleep that yields the microtask queue but never waits. */
  const instantSleep = async () => {};

  it("resolves when the full base URL answers 2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await expect(
      waitForReady(URL, { fetchImpl, sleep: instantSleep }),
    ).resolves.toBeUndefined();
    // The poll must hit the FULL base URL — never the root.
    expect(fetchImpl).toHaveBeenCalledWith(URL);
  });

  it("keeps polling through connection errors, then resolves on 2xx", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: true, status: 200 });
    await expect(
      waitForReady(URL, { fetchImpl, sleep: instantSleep }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("treats a 404 as not-ready and rejects at timeoutMs naming URL and status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(
      waitForReady(URL, {
        fetchImpl,
        sleep: instantSleep,
        timeoutMs: 50,
        intervalMs: 10,
      }),
    ).rejects.toThrow(
      // Message must name the polled URL, the elapsed bound, and the last
      // observed state — the 404-vs-ready guard this poller exists for.
      /http:\/\/localhost:4173\/AboutMeGame\/.*50\s*ms.*404/s,
    );
    // Deterministic under injected sleep: attempts at 0,10,20,30,40 ms elapsed.
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it("rejects at timeoutMs naming the connection error when nothing listens", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(
        new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }),
      );
    await expect(
      waitForReady(URL, {
        fetchImpl,
        sleep: instantSleep,
        timeoutMs: 30,
        intervalMs: 10,
      }),
    ).rejects.toThrow(/http:\/\/localhost:4173\/AboutMeGame\/.*ECONNREFUSED/s);
  });
});
