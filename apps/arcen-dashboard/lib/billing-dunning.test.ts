import { describe, expect, it } from "vitest";
import { shouldEnforceDunning } from "@/lib/billing-dunning";

describe("billing dunning policy", () => {
  const now = new Date("2026-04-21T12:00:00.000Z");

  it("enforces only past-due subscriptions whose grace period has expired", () => {
    expect(
      shouldEnforceDunning({
        status: "PAST_DUE",
        graceEndsAt: new Date("2026-04-21T11:59:59.000Z"),
        now,
      }),
    ).toBe(true);

    expect(
      shouldEnforceDunning({
        status: "PAST_DUE",
        graceEndsAt: new Date("2026-04-21T12:00:01.000Z"),
        now,
      }),
    ).toBe(false);
  });

  it("does not enforce active or cancelled subscriptions", () => {
    expect(
      shouldEnforceDunning({
        status: "ACTIVE",
        graceEndsAt: new Date("2026-04-21T11:59:59.000Z"),
        now,
      }),
    ).toBe(false);

    expect(
      shouldEnforceDunning({
        status: "CANCELLED",
        graceEndsAt: new Date("2026-04-21T11:59:59.000Z"),
        now,
      }),
    ).toBe(false);
  });
});
