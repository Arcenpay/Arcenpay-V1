import { describe, it, expect } from "vitest";
import {
  UsageService,
  UsageProofError,
  UsageProofErrorCodes,
} from "../src/services/usage";

describe("UsageService proof modes", () => {
  it("fails fast in strict mode when artifacts are missing", () => {
    expect(
      () =>
        new UsageService({
          proofMode: "strict",
          circuitWasmPath: "/tmp/does-not-exist/UsageBilling.wasm",
          zkeyPath: "/tmp/does-not-exist/circuit_final.zkey",
          verificationKeyPath: "/tmp/does-not-exist/verification_key.json",
        }),
    ).toThrowError(UsageProofError);

    try {
      new UsageService({
        proofMode: "strict",
        circuitWasmPath: "/tmp/does-not-exist/UsageBilling.wasm",
        zkeyPath: "/tmp/does-not-exist/circuit_final.zkey",
        verificationKeyPath: "/tmp/does-not-exist/verification_key.json",
      });
    } catch (err) {
      const proofErr = err as UsageProofError;
      expect(proofErr.code).toBe(UsageProofErrorCodes.ARTIFACTS_MISSING);
    }
  });

  it("returns deterministic public inputs in dev fallback mode", async () => {
    const usage = new UsageService({
      proofMode: "dev",
      circuitWasmPath: "/tmp/does-not-exist/UsageBilling.wasm",
      zkeyPath: "/tmp/does-not-exist/circuit_final.zkey",
      verificationKeyPath: "/tmp/does-not-exist/verification_key.json",
    });

    await usage.logUsage("session-alpha", {
      endpoint: "/api/premium/data",
      method: "GET",
      timestamp: 1_700_000_000,
      responseSize: 42,
    });
    await usage.logUsage("session-alpha", {
      endpoint: "/api/premium/data",
      method: "GET",
      timestamp: 1_700_000_010,
      responseSize: 21,
    });

    const { proof, publicInputs } = await usage.generateProof(
      "session-alpha",
      1_700_000_020,
    );

    expect(proof.a).toEqual([0n, 0n]);
    expect(proof.c).toEqual([0n, 0n]);
    expect(publicInputs.callCount).toBe(2n);
    expect(publicInputs.sessionId).toMatch(/^0x[a-f0-9]{64}$/);
    expect(publicInputs.agentAddress).toMatch(/^0x[a-f0-9]{64}$/);
    expect(publicInputs.merkleRoot).toMatch(/^0x[a-f0-9]{64}$/);
    expect(publicInputs.nullifier).toMatch(/^0x[a-f0-9]{64}$/);
  });
});
