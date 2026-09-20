import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOSTED_SMART_ACCOUNT_SUPPORTED_CHAIN_IDS,
  hasSmartAccountInfrastructure,
  isHostedSmartAccountUrlForUnsupportedChain,
  isSmartAccountProviderUnavailableError,
} from "../src/lib/smart-account-core";

/**
 * Regression tests for the BOT Chain (677) failure reported from production:
 *
 *   URL: https://api.pimlico.io/v2/677/rpc?apikey=…
 *   body: {"method":"pimlico_getUserOperationGasPrice","params":[]}
 *   Details: chain "677" is not supported
 *
 * The root cause was that a configured Pimlico API key made
 * `hasSmartAccountInfrastructure()` return true for EVERY chain, so the SDK
 * attempted a sponsored execution that could never succeed and surfaced a raw
 * provider error to the user instead of falling back to self-paid gas.
 */
describe("hosted smart-account chain support", () => {
  it("flags a Pimlico endpoint for a chain Pimlico does not serve", () => {
    expect(
      isHostedSmartAccountUrlForUnsupportedChain(
        "https://api.pimlico.io/v2/677/rpc?apikey=pim_test",
      ),
    ).toBe(true);
    expect(
      isHostedSmartAccountUrlForUnsupportedChain(
        "https://api.pimlico.io/v2/968/rpc?apikey=pim_test",
      ),
    ).toBe(true);
  });

  it("accepts Pimlico endpoints for supported chains", () => {
    for (const chainId of [8453, 84532, 11155111, 5042, 5042002]) {
      expect(
        isHostedSmartAccountUrlForUnsupportedChain(
          `https://api.pimlico.io/v2/${chainId}/rpc?apikey=pim_test`,
        ),
      ).toBe(false);
    }
  });

  it("never second-guesses a non-Pimlico bundler", () => {
    // A self-hosted or third-party bundler may legitimately support any chain.
    expect(
      isHostedSmartAccountUrlForUnsupportedChain(
        "https://bundler.mydomain.dev/rpc",
      ),
    ).toBe(false);
    expect(isHostedSmartAccountUrlForUnsupportedChain(undefined)).toBe(false);
    // Slug form cannot be validated, so it is left alone.
    expect(
      isHostedSmartAccountUrlForUnsupportedChain("https://api.pimlico.io/v2/base/rpc"),
    ).toBe(false);
  });

  it("documents 677 and 968 as unsupported", () => {
    expect(HOSTED_SMART_ACCOUNT_SUPPORTED_CHAIN_IDS.has(677)).toBe(false);
    expect(HOSTED_SMART_ACCOUNT_SUPPORTED_CHAIN_IDS.has(968)).toBe(false);
    expect(HOSTED_SMART_ACCOUNT_SUPPORTED_CHAIN_IDS.has(5042002)).toBe(true);
  });
});

describe("hasSmartAccountInfrastructure with a hosted API key", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports NO infrastructure on chain 677 even when a Pimlico key is set", () => {
    // The exact production condition: a key is present, so the old code
    // synthesised a Pimlico URL and claimed infrastructure existed.
    vi.stubEnv("NEXT_PUBLIC_PIMLICO_API_KEY", "pim_Px3kpqmF1TJKuqCDcRyNdo");

    expect(
      hasSmartAccountInfrastructure({ chainId: 677 }),
    ).toBe(false);
  });

  it("still reports infrastructure on a supported chain", () => {
    vi.stubEnv("NEXT_PUBLIC_PIMLICO_API_KEY", "pim_Px3kpqmF1TJKuqCDcRyNdo");
    expect(hasSmartAccountInfrastructure({ chainId: 84532 })).toBe(true);
  });
});

describe("isSmartAccountProviderUnavailableError", () => {
  it("matches the exact Pimlico error from the bug report", () => {
    const exact = new Error(
      'Missing or invalid parameters. Double check you have provided the correct parameters. ' +
        'URL: https://api.pimlico.io/v2/677/rpc?apikey=pim_test ' +
        'Request body: {"method":"pimlico_getUserOperationGasPrice","params":[]} ' +
        'Details: chain "677" is not supported, see https://docs.pimlico.io/guides/supported-chains ' +
        "Version: viem@2.56.8",
    );
    expect(isSmartAccountProviderUnavailableError(exact)).toBe(true);
  });

  it("matches common provider/transport failures", () => {
    expect(isSmartAccountProviderUnavailableError(new Error("chain \"677\" is not supported"))).toBe(true);
    expect(isSmartAccountProviderUnavailableError(new Error("Method not found"))).toBe(true);
    expect(isSmartAccountProviderUnavailableError(new Error("Failed to fetch"))).toBe(true);
    expect(isSmartAccountProviderUnavailableError(new Error("paymaster rejected the userOperation"))).toBe(true);
    expect(isSmartAccountProviderUnavailableError(new Error("bundler returned 429 rate limit"))).toBe(true);
  });

  it("NEVER falls back when the user declined in their wallet", () => {
    // Silently re-submitting after an explicit rejection would be a serious bug.
    expect(isSmartAccountProviderUnavailableError(new Error("User rejected the request"))).toBe(false);
    expect(isSmartAccountProviderUnavailableError(new Error("user denied transaction signature"))).toBe(false);
  });

  it("does not treat an ordinary business revert as a provider outage", () => {
    expect(
      isSmartAccountProviderUnavailableError(new Error("execution reverted: ERC20: insufficient allowance")),
    ).toBe(false);
  });
});
