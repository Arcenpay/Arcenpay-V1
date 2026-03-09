import { describe, expect, it } from "vitest";
import {
  CHECKOUT_ERROR_CODES,
  CheckoutFlowError,
} from "../src/components/CheckoutModal";
import {
  ENTITLEMENT_ERROR_CODES,
  EntitlementError,
} from "../src/hooks/useEntitlement";

describe("sdk-react deterministic error codes", () => {
  it("exposes checkout error code constants", () => {
    expect(CHECKOUT_ERROR_CODES.INVALID_EMAIL).toBe("INVALID_EMAIL");
    expect(CHECKOUT_ERROR_CODES.SUBSCRIPTION_MINT_FAILED).toBe(
      "SUBSCRIPTION_MINT_FAILED",
    );
  });

  it("CheckoutFlowError carries stable code and message", () => {
    const err = new CheckoutFlowError(
      CHECKOUT_ERROR_CODES.WALLET_NOT_CONNECTED,
      "Wallet missing",
    );
    expect(err.code).toBe("WALLET_NOT_CONNECTED");
    expect(err.message).toBe("Wallet missing");
  });

  it("EntitlementError carries stable code and message", () => {
    const err = new EntitlementError(
      ENTITLEMENT_ERROR_CODES.ONCHAIN_READ_FAILED,
      "RPC failed",
    );
    expect(err.code).toBe("ONCHAIN_READ_FAILED");
    expect(err.message).toBe("RPC failed");
  });
});

