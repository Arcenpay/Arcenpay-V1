import { describe, expect, it } from "vitest";
import {
  ENTITLEMENT_ERROR_CODES,
  EntitlementError,
} from "../src/hooks/useEntitlement";

describe("sdk-react deterministic error codes", () => {
  it("EntitlementError carries stable code and message", () => {
    const err = new EntitlementError(
      ENTITLEMENT_ERROR_CODES.ONCHAIN_READ_FAILED,
      "RPC failed",
    );
    expect(err.code).toBe("ONCHAIN_READ_FAILED");
    expect(err.message).toBe("RPC failed");
  });
});
