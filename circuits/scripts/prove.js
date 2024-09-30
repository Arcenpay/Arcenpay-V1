// ============================================================
//  ZKVUB Proving Pipeline — Generate Groth16 proofs from
//  aggregated usage data for on-chain settlement
// ============================================================

const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { buildPoseidon } = require("circomlibjs");

const BUILD_DIR = path.join(__dirname, "..", "build");
const PROOF_DIR = path.join(__dirname, "..", "proof");
const DEFAULT_INPUT_FILE = path.join(__dirname, "..", "input", "sample_input.json");

const MAX_ENTRIES = 128;

let poseidon;

async function getPoseidon() {
  if (!poseidon) {
    poseidon = await buildPoseidon();
  }
  return poseidon;
}

function toFieldElement(hexOrBuffer) {
  const hex =
    typeof hexOrBuffer === "string"
      ? hexOrBuffer.replace(/^0x/, "")
      : hexOrBuffer.toString("hex");
  const normalized = hex.length === 0 ? "0" : hex;
  const truncated = normalized.slice(0, 62);
  return BigInt("0x" + (truncated || "0")).toString();
}

function isHexString(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}

function sessionIdToField(sessionId) {
  if (!sessionId) return "0";
  if (isHexString(sessionId)) return toFieldElement(sessionId);
  const digest = crypto.createHash("sha256").update(String(sessionId)).digest();
  return toFieldElement(digest);
}

function addressToField(address) {
  if (!address) return "0";
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error(`[Prover] Invalid agentAddress: ${address}`);
  }
  return BigInt(address).toString();
}

async function computeMerkleRoot(logHashes, entryMask) {
  const poseidon = await getPoseidon();
  let currentHash = poseidon([BigInt(logHashes[0]), BigInt(entryMask[0])]);

  for (let i = 1; i < MAX_ENTRIES; i++) {
    const val = BigInt(logHashes[i]) * BigInt(entryMask[i]);
    currentHash = poseidon([poseidon.F.toObject(currentHash), val]);
  }

  return poseidon.F.toObject(currentHash).toString();
}

async function deriveNullifier(sessionIdField, windowEnd) {
  const poseidon = await getPoseidon();
  const raw = poseidon([BigInt(sessionIdField), BigInt(windowEnd)]);
  return poseidon.F.toObject(raw).toString();
}

function ensureArtifacts() {
  const wasmPath = path.join(BUILD_DIR, "UsageBilling_js", "UsageBilling.wasm");
  const zkeyPath = path.join(BUILD_DIR, "circuit_final.zkey");

  if (!fs.existsSync(wasmPath)) {
    console.error("[Prover] ❌ Missing WASM artifact:", wasmPath);
    console.error("   Run `npm --prefix circuits run setup` first.");
    process.exit(1);
  }
  if (!fs.existsSync(zkeyPath)) {
    console.error("[Prover] ❌ Missing zkey artifact:", zkeyPath);
    console.error("   Run `npm --prefix circuits run setup` first.");
    process.exit(1);
  }

  return { wasmPath, zkeyPath };
}

async function prove(circuitInputs) {
  console.log("[Prover] Generating Groth16 proof...");
  const { wasmPath, zkeyPath } = ensureArtifacts();

  const rawLogHashes = (circuitInputs.logHashes || []).map((hash) =>
    toFieldElement(hash),
  );
  const actualCount = rawLogHashes.length;

  if (actualCount !== Number(circuitInputs.callCount || 0)) {
    throw new Error(
      `[Prover] callCount mismatch: ${circuitInputs.callCount} !== ${actualCount}`,
    );
  }
  if (actualCount > MAX_ENTRIES) {
    throw new Error(
      `[Prover] Too many entries: ${actualCount} > MAX_ENTRIES(${MAX_ENTRIES})`,
    );
  }

  const rawTimestamps = circuitInputs.logTimestamps
    ? circuitInputs.logTimestamps.slice(0, actualCount).map((value) => String(value))
    : Array(actualCount).fill(String(circuitInputs.windowStart || 0));
  if (rawTimestamps.length !== actualCount) {
    throw new Error("[Prover] logTimestamps length must match logHashes length");
  }

  const logHashes = [...rawLogHashes];
  const logTimestamps = [...rawTimestamps];
  const entryMask = rawLogHashes.map(() => "1");

  while (logHashes.length < MAX_ENTRIES) {
    logHashes.push("0");
    logTimestamps.push("0");
    entryMask.push("0");
  }

  const sessionId = sessionIdToField(circuitInputs.sessionId);
  const agentAddress = addressToField(circuitInputs.agentAddress || "0x0000000000000000000000000000000000000000");
  const merkleRoot = await computeMerkleRoot(logHashes, entryMask);
  const nullifier = await deriveNullifier(sessionId, circuitInputs.windowEnd);

  const input = {
    agentAddress,
    merkleRoot,
    callCount: String(circuitInputs.callCount),
    windowStart: String(circuitInputs.windowStart),
    windowEnd: String(circuitInputs.windowEnd),
    sessionId,
    nullifier,
    logHashes,
    logTimestamps,
    entryMask,
  };

  console.log("[Prover] Agent Address (field):", agentAddress);
  console.log("[Prover] Session ID (field):", sessionId);
  console.log("[Prover] Merkle Root:", merkleRoot);
  console.log("[Prover] Nullifier:", nullifier);

  const startTime = Date.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    wasmPath,
    zkeyPath,
  );
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  fs.mkdirSync(PROOF_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(PROOF_DIR, "proof.json"),
    JSON.stringify(proof, null, 2),
  );
  fs.writeFileSync(
    path.join(PROOF_DIR, "public.json"),
    JSON.stringify(publicSignals, null, 2),
  );

  console.log(`[Prover] ✅ Proof generated in ${elapsed}s`);
  return { proof, publicSignals };
}

function formatProofForSolidity(proof) {
  return {
    a: [proof.pi_a[0], proof.pi_a[1]],
    b: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    c: [proof.pi_c[0], proof.pi_c[1]],
  };
}

if (require.main === module) {
  const inputFile = process.argv[2] || DEFAULT_INPUT_FILE;
  if (!fs.existsSync(inputFile)) {
    console.error(
      `[Prover] Input file not found: ${inputFile}\nUsage: node scripts/prove.js <circuit-inputs.json>`,
    );
    process.exit(1);
  }

  const inputs = JSON.parse(fs.readFileSync(inputFile, "utf-8"));
  prove(inputs)
    .then(({ proof }) => {
      console.log("");
      console.log("Solidity calldata:");
      console.log(JSON.stringify(formatProofForSolidity(proof), null, 2));
    })
    .catch((err) => {
      console.error("[Prover] ❌ Proof generation failed:", err?.message || err);
      process.exit(1);
    });
}

module.exports = {
  prove,
  formatProofForSolidity,
  toFieldElement,
  sessionIdToField,
  deriveNullifier,
  computeMerkleRoot,
  MAX_ENTRIES,
  getPoseidon,
};
