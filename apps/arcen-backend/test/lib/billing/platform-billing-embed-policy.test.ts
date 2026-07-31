import { describe, expect, it } from "vitest";
import {
  canInitializePlatformBilling,
  requestedPlatformBillingSetup,
} from "../../../src/lib/billing/platform-billing-embed-policy.js";

describe("platform billing embed policy", () => {
  it("does not initialize billing for a normal token request", () => {
    expect(requestedPlatformBillingSetup(undefined)).toBe(false);
    expect(requestedPlatformBillingSetup({})).toBe(false);
    expect(requestedPlatformBillingSetup({ initialize: "true" })).toBe(false);
  });

  it("only treats an explicit boolean opt-in as setup", () => {
    expect(requestedPlatformBillingSetup({ initialize: true })).toBe(true);
  });

  it("limits setup to workspace administrators", () => {
    expect(canInitializePlatformBilling("OWNER")).toBe(true);
    expect(canInitializePlatformBilling("ADMIN")).toBe(true);
    expect(canInitializePlatformBilling("MEMBER")).toBe(false);
  });
});
