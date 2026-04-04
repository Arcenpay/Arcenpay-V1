import { describe, expect, it } from "vitest";
import {
  entitlementsToFeatures,
  mergeActivationHeaders,
  resolveActivationEndpoint,
} from "../src/lib/api";
import { resolveSubscriptionExecutor } from "../src/components/CheckoutModal";

describe("sdk-react api helpers", () => {
  it("prefers callback subscriptions over the built-in activation adapter", () => {
    const executor = resolveSubscriptionExecutor(async () => ({ tokenId: 1n }), "/api/v1/subscriptions/activate");
    expect(executor).toBe("callback");
  });

  it("falls back to the built-in activation adapter when configured", () => {
    const executor = resolveSubscriptionExecutor(undefined, "/api/v1/subscriptions/activate");
    expect(executor).toBe("built_in");
  });

  it("returns none when no subscription execution path is available", () => {
    const executor = resolveSubscriptionExecutor(undefined, null);
    expect(executor).toBe("none");
  });

  it("keeps caller-provided authorization headers intact", () => {
    const headers = mergeActivationHeaders(
      { Authorization: "Bearer custom" },
      "embedded_token",
    );
    expect(headers.Authorization).toBe("Bearer custom");
  });

  it("adds the Arcen session token when authorization is not provided", () => {
    const headers = mergeActivationHeaders(undefined, "embedded_token");
    expect(headers.Authorization).toBe("Bearer embedded_token");
  });

  it("maps numeric entitlements to numeric feature values", () => {
    expect(
      entitlementsToFeatures({
        seats: {
          key: "seats",
          enabled: true,
          reason: "Plan entitlement",
          allocation: 10,
          usage: 2,
          exceeded: false,
        },
      }),
    ).toEqual({ seats: 10 });
  });

  it("maps boolean entitlements to boolean feature values", () => {
    expect(
      entitlementsToFeatures({
        analytics: {
          key: "analytics",
          enabled: true,
          reason: "Rule 1 matched",
          allocation: null,
          usage: 0,
          exceeded: false,
        },
      }),
    ).toEqual({ analytics: true });
  });

  it("resolves an explicit activation endpoint directly", () => {
    expect(resolveActivationEndpoint("https://example.com/activate")).toBe(
      "https://example.com/activate",
    );
  });
});
