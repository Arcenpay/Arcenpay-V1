import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  UsageService,
  UsageProofError,
  UsageProofErrorCodes,
} from "../src/services/usage.js";

test("UsageService fails fast in strict mode when artifacts are missing", () => {
  assert.throws(
    () =>
      new UsageService({
        proofMode: "strict",
        circuitWasmPath: "/tmp/does-not-exist/UsageBilling.wasm",
        zkeyPath: "/tmp/does-not-exist/circuit_final.zkey",
        verificationKeyPath: "/tmp/does-not-exist/verification_key.json",
      }),
    (error) =>
      error instanceof UsageProofError &&
      error.code === UsageProofErrorCodes.ARTIFACTS_MISSING,
  );
});

test("UsageService returns deterministic public inputs in dev fallback mode", async () => {
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

  assert.deepEqual(proof.a, [0n, 0n]);
  assert.deepEqual(proof.c, [0n, 0n]);
  assert.equal(publicInputs.callCount, 2n);
  assert.match(publicInputs.sessionId, /^0x[a-f0-9]{64}$/);
  assert.match(publicInputs.agentAddress, /^0x[a-f0-9]{64}$/);
  assert.match(publicInputs.merkleRoot, /^0x[a-f0-9]{64}$/);
  assert.match(publicInputs.nullifier, /^0x[a-f0-9]{64}$/);
});

test("UsageService rejects mismatched proof artifact versions in strict mode", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "arcenpay-usage-"));
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

  assert.throws(
    () =>
      new UsageService({
        proofMode: "strict",
        proveScriptPath,
        circuitWasmPath: wasmPath,
        zkeyPath,
        verificationKeyPath,
        artifactManifestPath,
        artifactVersion: "2026-03-10.0",
      }),
    (error) =>
      error instanceof UsageProofError &&
      error.code === UsageProofErrorCodes.ARTIFACT_VERSION_MISMATCH,
  );
});
