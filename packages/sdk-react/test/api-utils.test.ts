import { describe, expect, it } from "vitest";
import {
  createPaymentLinkCheckoutUrl,
  resolveAppBaseUrl,
  entitlementsToFeatures,
} from "../src/lib/api";

describe("sdk-react api helpers", () => {
  it("builds payment-link URLs from the current resolved app URL", () => {
    expect(createPaymentLinkCheckoutUrl("starter plan")).toBe(
      `${resolveAppBaseUrl()}/pay/starter%20plan`,
    );
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

});
