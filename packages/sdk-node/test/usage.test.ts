import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

  it("rejects mismatched proof artifact versions in strict mode", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "meap-usage-"));
    const proveScriptPath = path.join(tmpDir, "prove.js");
    const wasmPath = path.join(tmpDir, "UsageBilling.wasm");
    const zkeyPath = path.join(tmpDir, "circuit_final.zkey");
    const verificationKeyPath = path.join(tmpDir, "verification_key.json");
    const artifactManifestPath = path.join(tmpDir, "artifact-manifest.json");

    fs.writeFileSync(
      proveScriptPath,
      "export async function prove(){ return { proof: {}, publicSignals: [] }; }",
    );
    fs.writeFileSync(wasmPath, "");
    fs.writeFileSync(zkeyPath, "");
    fs.writeFileSync(
      verificationKeyPath,
      JSON.stringify({ protocol: "groth16", nPublic: 7 }),
    );
    fs.writeFileSync(
      artifactManifestPath,
      JSON.stringify({ version: "2026-03-09.1" }),
    );

    try {
      new UsageService({
        proofMode: "strict",
        proveScriptPath,
        circuitWasmPath: wasmPath,
        zkeyPath,
        verificationKeyPath,
        artifactManifestPath,
        artifactVersion: "2026-03-10.0",
      });
      expect.fail("Expected UsageService constructor to throw");
    } catch (err) {
      const proofErr = err as UsageProofError;
      expect(proofErr.code).toBe(
        UsageProofErrorCodes.ARTIFACT_VERSION_MISMATCH,
      );
    }
  });
});
