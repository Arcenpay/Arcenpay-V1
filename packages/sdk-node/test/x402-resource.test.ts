import { describe, it, expect } from "vitest";
import { normalizeResourceUrl } from "../src/middleware/x402";

describe("x402 resource normalization", () => {
  it("normalizes valid URLs to origin+path+query", () => {
    const value = normalizeResourceUrl(
      "https://api.example.com/premium/data?x=1",
    );
    expect(value).toBe("https://api.example.com/premium/data?x=1");
  });

  it("returns null for invalid URL values", () => {
    expect(normalizeResourceUrl("/relative/path")).toBeNull();
    expect(normalizeResourceUrl("not-a-url")).toBeNull();
  });

  it("removes hash fragments from canonical resource comparison", () => {
    const value = normalizeResourceUrl(
      "https://api.example.com/premium/data?x=1#ignore",
    );
    expect(value).toBe("https://api.example.com/premium/data?x=1");
  });
});
