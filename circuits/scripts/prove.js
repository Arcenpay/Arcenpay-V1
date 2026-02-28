// ============================================================
//  ZKVUB Proving Pipeline — Generate Groth16 proofs from
//  aggregated usage data for on-chain settlement
//  PRD ZKVUB-004 — zk-SNARK Proof Generation
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const PROOF_DIR = path.join(__dirname, '..', 'proof');
const FIELD_SAFE_BYTES = 31;

function toFieldString(value) {
    const normalized = `${value}`.trim();

    if (/^0x[a-fA-F0-9]+$/.test(normalized)) {
        return BigInt(normalized).toString();
    }
    if (/^[0-9]+$/.test(normalized)) {
        return BigInt(normalized).toString();
    }

    throw new Error(`Invalid field element input: ${normalized}`);
}

function deriveNullifierSecret(overrideValue) {
    const raw = overrideValue ?? process.env.ZKVUB_NULLIFIER_SECRET;
    if (raw !== undefined && raw !== null && `${raw}`.trim().length > 0) {
        const normalized = `${raw}`.trim();
        if (/^0x[a-fA-F0-9]+$/.test(normalized)) {
            return BigInt(normalized).toString();
        }
        if (/^[0-9]+$/.test(normalized)) {
            return BigInt(normalized).toString();
        }
        throw new Error('nullifierSecret must be a base-10 or 0x-prefixed integer string');
    }

    // Keep the generated value in a conservative range for field arithmetic.
    const randomHex = crypto.randomBytes(FIELD_SAFE_BYTES).toString('hex');
    return BigInt(`0x${randomHex}`).toString();
}

function normalizeProofForContract(proof) {
    if (proof && proof.a && proof.b && proof.c) {
        return {
            a: [toFieldString(proof.a[0]), toFieldString(proof.a[1])],
            b: [
                [toFieldString(proof.b[0][0]), toFieldString(proof.b[0][1])],
                [toFieldString(proof.b[1][0]), toFieldString(proof.b[1][1])],
            ],
            c: [toFieldString(proof.c[0]), toFieldString(proof.c[1])],
        };
    }

    if (proof && proof.pi_a && proof.pi_b && proof.pi_c) {
        return {
            a: [toFieldString(proof.pi_a[0]), toFieldString(proof.pi_a[1])],
            b: [
                [toFieldString(proof.pi_b[0][1]), toFieldString(proof.pi_b[0][0])],
                [toFieldString(proof.pi_b[1][1]), toFieldString(proof.pi_b[1][0])],
            ],
            c: [toFieldString(proof.pi_c[0]), toFieldString(proof.pi_c[1])],
        };
    }

    throw new Error('Unsupported proof format from snarkjs');
}

/**
 * Generate a Groth16 proof for a billing window
 *
 * @param {Object} circuitInputs - The circuit inputs from AggregatorService
 * @param {string} circuitInputs.agentAddress
 * @param {number} circuitInputs.callCount
 * @param {string} circuitInputs.merkleRoot
 * @param {number} circuitInputs.windowStart
 * @param {number} circuitInputs.windowEnd
 * @param {string} circuitInputs.sessionId
 * @param {string} circuitInputs.nullifier
 * @param {string[]} circuitInputs.logHashes
 * @param {string[]} [circuitInputs.logTimestamps]
 * @param {string} [circuitInputs.nullifierSecret]
 */
async function prove(circuitInputs) {
    const snarkjs = require('snarkjs');
    console.log('[Prover] Generating Groth16 proof...');
    console.log('[Prover] Call count:', circuitInputs.callCount);
    console.log('[Prover] Window:', circuitInputs.windowStart, '-', circuitInputs.windowEnd);

    const wasmPath = path.join(BUILD_DIR, 'UsageBilling_js', 'UsageBilling.wasm');
    const zkeyPath = path.join(BUILD_DIR, 'circuit_final.zkey');

    if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
        throw new Error('[Prover] Missing build artifacts. Run `npm run compile` and `npm run setup` first.');
    }

    // Pad inputs to MAX_ENTRIES (128)
    const MAX_ENTRIES = 128;
    const logHashes = [...circuitInputs.logHashes].map((value) => toFieldString(value));
    const entryMask = logHashes.map(() => 1);
    const providedTimestamps = Array.isArray(circuitInputs.logTimestamps)
        ? circuitInputs.logTimestamps.map((value) => toFieldString(value))
        : [];
    const logTimestamps = logHashes.map((_, idx) => {
        if (providedTimestamps[idx] !== undefined) {
            return providedTimestamps[idx];
        }
        return toFieldString(circuitInputs.windowStart);
    });

    while (logHashes.length < MAX_ENTRIES) {
        logHashes.push('0');
        entryMask.push(0);
        logTimestamps.push(0);
    }

    const input = {
        agentAddress: toFieldString(circuitInputs.agentAddress || '0'),
        merkleRoot: toFieldString(circuitInputs.merkleRoot),
        callCount: toFieldString(circuitInputs.callCount),
        windowStart: toFieldString(circuitInputs.windowStart),
        windowEnd: toFieldString(circuitInputs.windowEnd),
        sessionId: toFieldString(circuitInputs.sessionId || '0'),
        nullifier: toFieldString(circuitInputs.nullifier || '0'),
        logHashes,
        logTimestamps,
        entryMask,
        nullifierSecret: deriveNullifierSecret(circuitInputs.nullifierSecret),
    };

    try {
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);
        const contractProof = normalizeProofForContract(proof);

        // Save proof and public signals
        fs.mkdirSync(PROOF_DIR, { recursive: true });
        fs.writeFileSync(path.join(PROOF_DIR, 'proof.json'), JSON.stringify(proof, null, 2));
        fs.writeFileSync(path.join(PROOF_DIR, 'public.json'), JSON.stringify(publicSignals, null, 2));
        fs.writeFileSync(path.join(PROOF_DIR, 'proof-contract.json'), JSON.stringify(contractProof, null, 2));

        console.log('[Prover] ✅ Proof generated successfully!');
        console.log('[Prover] Proof file:', path.join(PROOF_DIR, 'proof.json'));
        console.log('[Prover] Public signals:', publicSignals);

        return { proof, publicSignals, contractProof };
    } catch (err) {
        console.error('[Prover] ❌ Proof generation failed:', err.message);
        throw err;
    }
}

// CLI execution
if (require.main === module) {
    const inputFile = process.argv[2];
    if (!inputFile) {
        console.log('Usage: node prove.js <circuit-inputs.json>');
        process.exit(1);
    }

    const inputs = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
    prove(inputs).catch((err) => {
        console.error(err);
        process.exitCode = 1;
    });
}

module.exports = {
    prove,
    deriveNullifierSecret,
    normalizeProofForContract,
    toFieldString,
};
