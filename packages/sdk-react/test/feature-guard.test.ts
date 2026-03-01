import { describe, it, expect } from "vitest";
import {
  resolveDecryptEndpoint,
  hasEntitlementFeature,
} from "../src/components/FeatureFlagGuard";

describe("FeatureFlagGuard helpers", () => {
  it("resolves endpoint placeholders", () => {
    const endpoint = resolveDecryptEndpoint(
      "https://facilitator.example/api/lit/decrypt/{wallet}/{feature}",
      "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD",
      "analytics_dashboard",
    );
    expect(endpoint).toBe(
      "https://facilitator.example/api/lit/decrypt/0xabcdefabcdefabcdefabcdefabcdefabcdefabcd/analytics_dashboard",
    );
  });

  it("returns null when endpoint template is not provided", () => {
    expect(resolveDecryptEndpoint(undefined, "0xabc", "feature")).toBeNull();
  });

  it("requires active subscription and enabled feature", () => {
    expect(
      hasEntitlementFeature(true, { analytics_dashboard: true }, "analytics_dashboard"),
    ).toBe(true);
    expect(
      hasEntitlementFeature(false, { analytics_dashboard: true }, "analytics_dashboard"),
    ).toBe(false);
    expect(
      hasEntitlementFeature(true, { analytics_dashboard: false }, "analytics_dashboard"),
    ).toBe(false);
  });
});
