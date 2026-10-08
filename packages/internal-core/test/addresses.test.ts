import { afterEach, describe, expect, it } from "vitest";
import { getContractAddresses, setContractAddresses } from "../src/addresses";

const originalNodeEnv = process.env.NODE_ENV;
const originalSepolia = getContractAddresses(11155111);
const originalBaseSepolia = (() => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  const value = getContractAddresses(84532);
  process.env.NODE_ENV = prev;
  return value;
})();

function resetEnv(...keys: string[]) {
  for (const key of keys) {
    delete process.env[key];
  }
}

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  resetEnv(
    "MEAP_CONTRACT_11155111_planFactory",
    "MEAP_CONTRACT_84532_planFactory",
    "MEAP_CONTRACT_84532_subscriptionRegistry",
    "MEAP_CONTRACT_84532_autopayModule",
    "MEAP_CONTRACT_84532_feeCollector",
    "MEAP_CONTRACT_84532_sessionVault",
    "MEAP_CONTRACT_84532_zkUsageVerifier",
    "MEAP_CONTRACT_84532_mirrorRegistry",
    "MEAP_CONTRACT_8453_planFactory",
  );
  setContractAddresses(11155111, originalSepolia);
  setContractAddresses(84532, originalBaseSepolia);
});

describe("addresses", () => {
  it("returns configured Sepolia addresses", () => {
    const addresses = getContractAddresses(11155111);
    expect(addresses.subscriptionRegistry).toBeTruthy();
    expect(addresses.planFactory).toBeTruthy();
    expect(addresses.feeCollector).toBeTruthy();
    expect(addresses.subscriptionRegistry).not.toBe(
      "0x0000000000000000000000000000000000000000",
    );
  });

  it("applies env override for a specific contract key", () => {
    const override = "0x1111111111111111111111111111111111111111";
    process.env.MEAP_CONTRACT_11155111_planFactory = override;
    const addresses = getContractAddresses(11155111);
    expect(addresses.planFactory).toBe(override);
  });

  it("returns configured Base Sepolia addresses", () => {
    const addresses = getContractAddresses(84532);
    expect(addresses.subscriptionRegistry).toBeTruthy();
    expect(addresses.planFactory).toBeTruthy();
    expect(addresses.subscriptionRegistry).not.toBe(
      "0x0000000000000000000000000000000000000000",
    );
  });

  it("throws in production when all core addresses are zero placeholders", () => {
    process.env.NODE_ENV = "production";
    expect(() => getContractAddresses(8453)).toThrow(
      /has no deployed contracts/i,
    );
  });

  it("does not throw in production when at least one core address is overridden", () => {
    process.env.NODE_ENV = "production";
    process.env.MEAP_CONTRACT_8453_planFactory =
      "0x2222222222222222222222222222222222222222";
    expect(() => getContractAddresses(8453)).not.toThrow();
    const addresses = getContractAddresses(8453);
    expect(addresses.planFactory).toBe(
      "0x2222222222222222222222222222222222222222",
    );
  });

  it("supports runtime updates via setContractAddresses", () => {
    const next = "0x3333333333333333333333333333333333333333";
    setContractAddresses(11155111, { feeCollector: next });
    const addresses = getContractAddresses(11155111);
    expect(addresses.feeCollector).toBe(next);
  });

  it("returns registered program ID D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3 for all roles on Solana Mainnet (9100000)", () => {
    process.env.NODE_ENV = "production";
    const addresses = getContractAddresses(9100000);
    const expectedProgramId = "D4ECHyomENvFHrdXWHcRncTwwQ1EQbyY4ga3CkcaYCP3";
    expect(addresses.subscriptionRegistry).toBe(expectedProgramId);
    expect(addresses.autopayModule).toBe(expectedProgramId);
    expect(addresses.planFactory).toBe(expectedProgramId);
    expect(addresses.feeCollector).toBe(expectedProgramId);
    expect(addresses.sessionVault).toBe(expectedProgramId);
    expect(addresses.zkUsageVerifier).toBe(expectedProgramId);
    expect(addresses.mirrorRegistry).toBe(expectedProgramId);
  });
});
