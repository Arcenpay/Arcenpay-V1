import { beforeEach, describe, expect, it, vi } from "vitest";

const viemMocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  createWalletClient: vi.fn(),
  http: vi.fn(() => ({})),
}));

const accountMocks = vi.hoisted(() => ({
  privateKeyToAccount: vi.fn(() => ({
    address: "0x1234567890123456789012345678901234567890",
  })),
}));

vi.mock("viem", () => viemMocks);
vi.mock("viem/accounts", () => accountMocks);
vi.mock("@arcenpay/sdk", () => ({
  DEFAULT_CHAIN_ID: 84532,
  SubscriptionRegistryABI: [],
  ERC7579AutopayModuleABI: [],
  getContractAddresses: vi.fn(() => ({
    subscriptionRegistry: "0x0000000000000000000000000000000000000001",
    autopayModule: "0x0000000000000000000000000000000000000002",
  })),
}));

import { BillingKeeper } from "./keeper";

describe("BillingKeeper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scans all enumerable subscription tokens instead of relying on recent mint logs", async () => {
    const readContract = vi.fn(async ({ functionName, args }: {
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
    });

    viemMocks.createPublicClient.mockReturnValue({
      readContract,
    });
    viemMocks.createWalletClient.mockReturnValue({});

    const keeper = new BillingKeeper({
      rpcUrl: "http://localhost:8545",
      privateKey: `0x${"1".repeat(64)}`,
      chainId: 84532,
    });

    const result = await (keeper as any).findExpiringSubscriptions(100n, 220n);

    expect(result).toEqual([12n]);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: "totalSupply" }),
    );
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "tokenByIndex",
        args: [0n],
      }),
    );
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "tokenByIndex",
        args: [2n],
      }),
    );
  });
});
