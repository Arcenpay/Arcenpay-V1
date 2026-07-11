import { describe, expect, it } from "vitest";
import {
  applyCreditDebitsToGrantBalances,
  CreditLedgerError,
  planCreditGrantIdempotencyKey,
  readPlanCreditGrants,
} from "../../../src/lib/billing/usage-credits.js";

describe("usage credit accounting", () => {
  it("reads only valid integer plan credit grants from metadata", () => {
    expect(
      readPlanCreditGrants({
        creditGrants: [
          { creditTypeId: "ct_scan", amount: 100, resetPeriod: "monthly" },
          { creditTypeId: "ct_bad_fraction", amount: 1.5 },
          { creditTypeId: "", amount: 10 },
          { creditTypeId: "ct_string", amount: "25" },
        ],
      }),
    ).toEqual([
      {
        creditTypeId: "ct_scan",
        amount: 100,
        resetPeriod: "monthly",
        autoTopUp: false,
      },
      {
        creditTypeId: "ct_string",
        amount: 25,
        resetPeriod: null,
        autoTopUp: false,
      },
    ]);
  });

  it("burns earliest expiring grants first and can span multiple grants", () => {
    const debits = applyCreditDebitsToGrantBalances(
      [
        {
          id: "never-expires",
          remainingAmount: 100,
          grantedAt: new Date("2026-01-01T00:00:00Z"),
          expiresAt: null,
        },
        {
          id: "expires-first",
          remainingAmount: 40,
          grantedAt: new Date("2026-02-01T00:00:00Z"),
          expiresAt: new Date("2026-03-01T00:00:00Z"),
        },
      ],
      75,
    );

    expect(debits).toEqual([
      { grantId: "expires-first", amount: 40, balanceAfter: 0 },
      { grantId: "never-expires", amount: 35, balanceAfter: 65 },
    ]);
  });

  it("rejects insufficient balances without returning partial debits", () => {
    expect(() =>
      applyCreditDebitsToGrantBalances(
        [
          {
            id: "small",
            remainingAmount: 3,
            grantedAt: new Date("2026-01-01T00:00:00Z"),
            expiresAt: null,
          },
        ],
        4,
      ),
    ).toThrowError(CreditLedgerError);
  });

  it("uses deterministic plan grant idempotency keys", () => {
    expect(
      planCreditGrantIdempotencyKey({
        companyId: "company_1",
        planId: "plan_pro",
        creditTypeId: "ct_scan",
        billingPeriod: "monthly",
        periodStartedAt: new Date("2026-06-10T08:00:00Z"),
      }),
    ).toBe("plan-credit:company_1:plan_pro:ct_scan:monthly:2026-06-10");
  });
});
