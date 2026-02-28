// ============================================================
//  ZKVUB Proving Pipeline — Generate Groth16 proofs from
//  aggregated usage data for on-chain settlement
//  PRD ZKVUB-004 — zk-SNARK Proof Generation
// ============================================================

const snarkjs = require("snarkjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { buildPoseidon } = require("circomlibjs");

const BUILD_DIR = path.join(__dirname, "..", "build");
const PROOF_DIR = path.join(__dirname, "..", "proof");

const MAX_ENTRIES = 128;

let poseidon;

/**
 * Initialize Poseidon hash function
 */
async function getPoseidon() {
  if (!poseidon) {
    poseidon = await buildPoseidon();
  }
  return poseidon;
}

/**
 * Convert a hex string or Buffer to a decimal string suitable for
 * Circom field elements (BN128 scalar field).
 */
function toFieldElement(hexOrBuffer) {
  const hex =
    typeof hexOrBuffer === "string"
      ? hexOrBuffer.replace(/^0x/, "")
      : hexOrBuffer.toString("hex");
  // Truncate to 31 bytes (248 bits) to stay within the BN128 scalar field
  const truncated = hex.slice(0, 62);
  return BigInt("0x" + truncated).toString();
}

/**
 * Generate a cryptographically strong nullifier secret.
 */
function generateNullifierSecret() {
  return toFieldElement(crypto.randomBytes(31));
}

/**
 * Generate a Groth16 proof for a billing window.
 *
 * @param {Object} circuitInputs - The circuit inputs from AggregatorService
 */
async function prove(circuitInputs) {
  console.log("[Prover] Generating Groth16 proof...");
  const poseidon = await getPoseidon();

  const wasmPath = path.join(BUILD_DIR, "UsageBilling_js", "UsageBilling.wasm");
  const zkeyPath = path.join(BUILD_DIR, "circuit_final.zkey");

  if (!fs.existsSync(wasmPath)) {
    console.error(
      "[Prover] ❌ Missing WASM artifact:",
      wasmPath,
      "\n   Run `npm run setup` first.",
    );
    process.exit(1);
  }
  if (!fs.existsSync(zkeyPath)) {
    console.error(
      "[Prover] ❌ Missing zkey artifact:",
      zkeyPath,
      "\n   Run `npm run setup` first.",
    );
    process.exit(1);
  }

  // ── Prepare log hashes ─────────────────────────────────────
  const rawLogHashes = (circuitInputs.logHashes || []).map((h) =>
    toFieldElement(h),
  );
  const actualCount = rawLogHashes.length;

  if (actualCount > MAX_ENTRIES) {
    throw new Error(
      `[Prover] Too many entries: ${actualCount} > MAX_ENTRIES(${MAX_ENTRIES})`,
    );
  }

  // Pad to MAX_ENTRIES
  const logHashes = [...rawLogHashes];
  const rawTimestamps = circuitInputs.logTimestamps
    ? circuitInputs.logTimestamps.slice(0, actualCount)
    : Array(actualCount).fill(Number(circuitInputs.windowStart));
  const logTimestamps = [...rawTimestamps];
  const entryMask = rawLogHashes.map(() => "1");

  while (logHashes.length < MAX_ENTRIES) {
    logHashes.push("0");
    logTimestamps.push("0");
    entryMask.push("0");
  }

  // ── Pre-compute Merkle Root (Poseidon Chain) ───────────────
  // The circuit implements a hash chain:
  // hashChain[0] = Poseidon(logHashes[0], entryMask[0])
  // hashChain[i] = Poseidon(hashChain[i-1], logHashes[i] * entryMask[i])
  let currentHash = poseidon([BigInt(logHashes[0]), BigInt(entryMask[0])]);

  for (let i = 1; i < MAX_ENTRIES; i++) {
    const val = BigInt(logHashes[i]) * BigInt(entryMask[i]);
    currentHash = poseidon([poseidon.F.toObject(currentHash), val]);
  }
  const merkleRoot = poseidon.F.toObject(currentHash).toString();

  // ── Pre-compute Nullifier ──────────────────────────────────
  const sessionId = circuitInputs.sessionId
    ? toFieldElement(circuitInputs.sessionId)
    : "0";
  const nullifierSecret =
    circuitInputs.nullifierSecret || generateNullifierSecret();

  const nullifierRaw = poseidon([BigInt(sessionId), BigInt(nullifierSecret)]);
  const nullifier = poseidon.F.toObject(nullifierRaw).toString();

  // ── Assemble circuit input ─────────────────────────────────
  const input = {
    merkleRoot,
    callCount: String(circuitInputs.callCount),
    windowStart: String(circuitInputs.windowStart),
    windowEnd: String(circuitInputs.windowEnd),
    sessionId,
    nullifier,
    logHashes,
    logTimestamps: logTimestamps.map(String),
    entryMask,
    nullifierSecret: String(nullifierSecret),
  };

  console.log("[Prover] Session ID:", sessionId);
  console.log("[Prover] Merkle Root:", merkleRoot);
  console.log("[Prover] Nullifier:", nullifier);

  try {
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
  } catch (err) {
    console.error("[Prover] ❌ Proof generation failed:", err.message);
    throw err;
  }
}

/**
 * Format proof for Solidity contract submission.
 */
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

// CLI execution
if (require.main === module) {
  const inputFile = process.argv[2];
  if (!inputFile) {
    console.log("Usage: node prove.js <circuit-inputs.json>");
    process.exit(1);
  }

  const inputs = JSON.parse(fs.readFileSync(inputFile, "utf-8"));
  prove(inputs)
    .then(({ proof, publicSignals }) => {
      console.log("");
      console.log("Solidity calldata:");
      console.log(JSON.stringify(formatProofForSolidity(proof), null, 2));
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = {
  prove,
  formatProofForSolidity,
  toFieldElement,
  MAX_ENTRIES,
  getPoseidon,
};
