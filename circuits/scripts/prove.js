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
const SNARK_FIELD =
    21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function modField(value) {
    let normalized = value % SNARK_FIELD;
    if (normalized < 0n) normalized += SNARK_FIELD;
    return normalized;
}

function modInverse(value, modulus = SNARK_FIELD) {
    let a = modField(value);
    if (a === 0n) {
        throw new Error('Cannot invert zero in field');
    }

    let t = 0n;
    let newT = 1n;
    let r = modulus;
    let newR = a;

    while (newR !== 0n) {
        const q = r / newR;
        [t, newT] = [newT, t - q * newT];
        [r, newR] = [newR, r - q * newR];
    }

    if (r > 1n) {
        throw new Error('Value is not invertible in field');
    }
    if (t < 0n) {
        t += modulus;
    }
    return t;
}

function toFieldString(value) {
    const normalized = `${value}`.trim();
    let asBigInt;

    if (/^0x[a-fA-F0-9]+$/.test(normalized)) {
        asBigInt = BigInt(normalized);
    } else if (/^[0-9]+$/.test(normalized)) {
        asBigInt = BigInt(normalized);
    } else {
        throw new Error(`Invalid field element input: ${normalized}`);
    }

    return modField(asBigInt).toString();
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

function computeCommitment(logHashes, logTimestamps, entryMask) {
    let acc = 0n;
    for (let i = 0; i < logHashes.length; i++) {
        const mask = BigInt(entryMask[i] || 0);
        const hash = BigInt(logHashes[i] || '0');
        const ts = BigInt(logTimestamps[i] || '0');
        acc = modField(acc + modField(hash + ts) * mask);
    }
    return acc.toString();
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

    const agentAddress = toFieldString(circuitInputs.agentAddress || '0');
    const sessionId = toFieldString(circuitInputs.sessionId || '0');
    const nullifier = toFieldString(circuitInputs.nullifier || '0');
    const windowStart = toFieldString(circuitInputs.windowStart);
    const windowEnd = toFieldString(circuitInputs.windowEnd);
    const callCount = toFieldString(circuitInputs.callCount);
    const commitment = computeCommitment(logHashes, logTimestamps, entryMask);

    if (
        circuitInputs.merkleRoot !== undefined
        && toFieldString(circuitInputs.merkleRoot) !== commitment
    ) {
        throw new Error('Provided merkleRoot does not match computed circuit commitment.');
    }

    const input = {
        agentAddress,
        sessionId,
        callCount,
        windowStart,
        windowEnd,
        merkleRoot: commitment,
        nullifier,
        logHashes,
        logTimestamps,
        entryMask,
        agentAddressInv: modInverse(BigInt(agentAddress)).toString(),
        sessionIdInv: modInverse(BigInt(sessionId)).toString(),
        nullifierInv: modInverse(BigInt(nullifier)).toString(),
        windowDeltaInv: modInverse(modField(BigInt(windowEnd) - BigInt(windowStart))).toString(),
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
