import { describe, expect, it } from "vitest";
import {
  PROTOCOL_EVENT_SCHEMA_VERSION,
  buildEventIdempotencyKey,
  createProtocolEvent,
  mapProtocolEventToBillingType,
} from "../src/services/event-contracts";

describe("event contracts", () => {
  it("builds stable idempotency keys", () => {
    const key = buildEventIdempotencyKey("subscription.renewed", [
      "0xabc:def",
      42,
    ]);
    expect(key).toBe("subscription.renewed:0xabc-def:42");
  });

  it("creates typed protocol event envelope", () => {
    const event = createProtocolEvent(
      "subscription.minted",
      { tokenId: "1" },
      {
        source: "facilitator",
        idempotencyKey: "subscription.minted:1",
        chainId: 11155111,
        occurredAt: 1_700_000_000_000,
      },
    );

    expect(event.schemaVersion).toBe(PROTOCOL_EVENT_SCHEMA_VERSION);
    expect(event.name).toBe("subscription.minted");
    expect(event.chainId).toBe(11155111);
    expect(event.payload).toEqual({ tokenId: "1" });
    expect(event.occurredAt).toBe("2023-11-14T22:13:20.000Z");
  });

  it("maps subscription events to dashboard billing types", () => {
    expect(mapProtocolEventToBillingType("subscription.minted")).toBe(
      "SUBSCRIPTION_MINTED",
    );
    expect(mapProtocolEventToBillingType("subscription.renewed")).toBe(
      "SUBSCRIPTION_RENEWED",
    );
    expect(mapProtocolEventToBillingType("subscription.renewal_failed")).toBe(
      "PAYMENT_FAILED",
    );
    expect(mapProtocolEventToBillingType("subscription.cancelled")).toBe(
      "SUBSCRIPTION_CANCELLED",
    );
  });
});
