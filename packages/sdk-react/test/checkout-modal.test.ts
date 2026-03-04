import { describe, it, expect } from "vitest";
import { getCheckoutStepOrder } from "../src/components/CheckoutModal";

describe("CheckoutModal flow", () => {
  it("keeps email step between connect and account", () => {
    const order = getCheckoutStepOrder();
    const connectIndex = order.indexOf("connect");
    const emailIndex = order.indexOf("email");
    const accountIndex = order.indexOf("account");

    expect(connectIndex).toBeGreaterThanOrEqual(0);
    expect(emailIndex).toBe(connectIndex + 1);
    expect(accountIndex).toBe(emailIndex + 1);
  });

  it("reaches approve after autopay in the canonical flow", () => {
    const order = getCheckoutStepOrder();
    expect(order.indexOf("approve")).toBe(order.indexOf("autopay") + 1);
  });
});
