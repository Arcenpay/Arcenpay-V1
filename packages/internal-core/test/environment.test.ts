import { afterEach, describe, expect, it } from "vitest";
import { isSupportedChainId } from "../src/chains";
import {
  getChainEnvironment,
  isZeroAddress,
  validateChainEnvironment,
} from "../src/environment";

const originalNodeEnv = process.env.NODE_ENV;

function resetEnv(...keys: string[]) {
  for (const key of keys) {
    delete process.env[key];
  }
}

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  resetEnv(
    "MEAP_RPC_URL_11155111",
    "MEAP_RPC_URL_84532",
    "MEAP_CONTRACT_84532_planFactory",
    "SEPOLIA_RPC_URL",
  );
});

describe("environment", () => {
  it("resolves chain environment with default service URL", () => {
    const env = getChainEnvironment(11155111);
    expect(env.chainId).toBe(11155111);
    expect(env.services.rpcUrl).toContain("http");
  });

  it("accepts Base Sepolia in non-production with deployed contracts", () => {
    expect(() =>
      validateChainEnvironment(84532, {
        production: false,
        requiredServices: ["rpcUrl"],
      }),
    ).not.toThrow();
  });

  it("accepts Base Sepolia in production with deployed contracts", () => {
    process.env.NODE_ENV = "production";
    expect(() =>
      validateChainEnvironment(84532, {
        production: true,
      }),
    ).not.toThrow();
  });

  it("rejects Base mainnet in production while contracts are still placeholders", () => {
    process.env.NODE_ENV = "production";
    expect(() =>
      validateChainEnvironment(8453, {
        production: true,
      }),
    ).toThrow(/no deployed contracts/i);
  });

  it("fails validation when rpcUrl env override is invalid", () => {
    process.env.MEAP_RPC_URL_11155111 = "not-a-url";
    expect(() =>
      validateChainEnvironment(11155111, {
        requiredServices: ["rpcUrl"],
      }),
    ).toThrow(/invalid services/i);
  });

  it("accepts legacy chain alias rpc env names", () => {
    process.env.SEPOLIA_RPC_URL = "https://ethereum-sepolia.example.org";
    const env = getChainEnvironment(11155111);
    expect(env.services.rpcUrl).toBe("https://ethereum-sepolia.example.org");
  });

  it("detects zero addresses correctly", () => {
    expect(isZeroAddress("0x0000000000000000000000000000000000000000")).toBe(
      true,
    );
    expect(isZeroAddress("0x1111111111111111111111111111111111111111")).toBe(
      false,
    );
  });

  it("recognizes supported runtime chains", () => {
    expect(isSupportedChainId(5042002)).toBe(true);
    expect(isSupportedChainId(84532)).toBe(true);
    expect(isSupportedChainId(1)).toBe(false);
  });
});
