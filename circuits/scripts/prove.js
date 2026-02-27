// ============================================================
//  ZKVUB Proving Pipeline — Generate Groth16 proofs from
//  aggregated usage data for on-chain settlement
//  PRD ZKVUB-004 — zk-SNARK Proof Generation
// ============================================================

const snarkjs = require('snarkjs');
const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, '..', 'build');
const PROOF_DIR = path.join(__dirname, '..', 'proof');

/**
 * Generate a Groth16 proof for a billing window
 *
 * @param {Object} circuitInputs - The circuit inputs from AggregatorService
 * @param {number} circuitInputs.callCount
 * @param {string} circuitInputs.merkleRoot
 * @param {number} circuitInputs.windowStart
 * @param {number} circuitInputs.windowEnd
 * @param {string} circuitInputs.sessionId
 * @param {string[]} circuitInputs.logHashes
 */
async function prove(circuitInputs) {
    console.log('[Prover] Generating Groth16 proof...');
    console.log('[Prover] Call count:', circuitInputs.callCount);
    console.log('[Prover] Window:', circuitInputs.windowStart, '-', circuitInputs.windowEnd);

    const wasmPath = path.join(BUILD_DIR, 'UsageBilling_js', 'UsageBilling.wasm');
    const zkeyPath = path.join(BUILD_DIR, 'circuit_final.zkey');

    if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
        console.error('[Prover] ❌ Missing build artifacts. Run `npm run compile` and `npm run setup` first.');
        process.exit(1);
    }

    // Pad inputs to MAX_ENTRIES (128)
    const MAX_ENTRIES = 128;
    const logHashes = [...circuitInputs.logHashes];
    const entryMask = logHashes.map(() => 1);
    const logTimestamps = logHashes.map(() => circuitInputs.windowStart);

    while (logHashes.length < MAX_ENTRIES) {
        logHashes.push('0');
        entryMask.push(0);
        logTimestamps.push(0);
    }

    const input = {
        merkleRoot: circuitInputs.merkleRoot,
        callCount: circuitInputs.callCount,
        windowStart: circuitInputs.windowStart,
        windowEnd: circuitInputs.windowEnd,
        sessionId: circuitInputs.sessionId || '0',
        nullifier: '0',
        logHashes,
        logTimestamps,
        entryMask,
        nullifierSecret: '12345', // TODO: Use secure random
    };

    try {
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasmPath, zkeyPath);

        // Save proof and public signals
        fs.mkdirSync(PROOF_DIR, { recursive: true });
        fs.writeFileSync(path.join(PROOF_DIR, 'proof.json'), JSON.stringify(proof, null, 2));
        fs.writeFileSync(path.join(PROOF_DIR, 'public.json'), JSON.stringify(publicSignals, null, 2));

        console.log('[Prover] ✅ Proof generated successfully!');
        console.log('[Prover] Proof file:', path.join(PROOF_DIR, 'proof.json'));
        console.log('[Prover] Public signals:', publicSignals);

        return { proof, publicSignals };
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
    prove(inputs).catch(console.error);
}

module.exports = { prove };
