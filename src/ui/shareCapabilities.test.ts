import { describe, expect, it } from "vitest";
import { shareCapabilitiesFrom } from "./shareCapabilities.ts";

describe("shareCapabilitiesFrom", () => {
  it("arrow-wraps share so a this-sensitive navigator method keeps its receiver", async () => {
    // Real navigator.share throws "Illegal invocation" when invoked with the
    // wrong `this`. This fake reproduces that exact footgun: its share method
    // rejects unless called on the fake itself.
    const received: Array<{ url: string }> = [];
    const fake = {
      share(data: { url: string }): Promise<void> {
        if (this !== fake) {
          return Promise.reject(new TypeError("Illegal invocation"));
        }
        received.push(data);
        return Promise.resolve();
      },
    };

    // Extract the built share as a bare reference before calling it — the
    // strongest proof: an unwrapped `share: nav.share` passthrough would lose
    // `this` entirely here and reject.
    const { share } = shareCapabilitiesFrom(fake);
    expect(typeof share).toBe("function");
    await expect(share!({ url: "https://example.test/" })).resolves.toBeUndefined();
    expect(received).toEqual([{ url: "https://example.test/" }]);
  });

  it("leaves share undefined when the navigator lacks it", () => {
    const capabilities = shareCapabilitiesFrom({
      clipboard: { writeText: () => Promise.resolve() },
    });
    expect(capabilities.share).toBeUndefined();
  });

  it("passes clipboard through unchanged (same reference)", () => {
    const clipboard = { writeText: () => Promise.resolve() };
    const capabilities = shareCapabilitiesFrom({ clipboard });
    expect(capabilities.clipboard).toBe(clipboard);
  });
});
