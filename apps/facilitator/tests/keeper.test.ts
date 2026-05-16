import test from "node:test";
import assert from "node:assert/strict";
import { BillingKeeper } from "../src/services/keeper.js";

test("BillingKeeper scans all enumerable subscription tokens", async () => {
  const keeper = new BillingKeeper({
    rpcUrl: "http://localhost:8545",
    privateKey: `0x${"1".repeat(64)}`,
    chainId: 84532,
  });

  const readContract = async ({
    functionName,
    args,
  }: {
    functionName: string;
    args?: unknown[];
  }) => {
    if (functionName === "totalSupply") return 3n;
    if (functionName === "tokenByIndex") {
      return [11n, 12n, 13n][Number(args?.[0] ?? 0)];
    }
    if (functionName === "expiresAt") {
      const tokenId = args?.[0] as bigint;
      if (tokenId === 11n) return 90n;
      if (tokenId === 12n) return 150n;
      return 260n;
    }
    throw new Error(`Unexpected function ${functionName}`);
  };

  (keeper as any).publicClient = { readContract };

  const result = await (keeper as any).findExpiringSubscriptions(100n, 220n);
  assert.deepEqual(result, [12n]);
});
