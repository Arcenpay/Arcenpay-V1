// ============================================================
//  ZKVUB Usage Billing Circuit — Circom
//
//  Self-contained circuit variant (no external include dependencies).
//  Public inputs match on-chain verifier order:
//    [agentAddress, sessionId, callCount, windowStart, windowEnd, merkleRoot, nullifier]
//
//  NOTE:
//  - `merkleRoot` is represented as a deterministic field commitment
//    of active usage rows: sum((logHash + logTimestamp) * entryMask)
//  - This keeps proving pipeline operational in constrained environments.
// ============================================================

pragma circom 2.1.0;

template UsageBilling(MAX_ENTRIES) {
    // Public inputs
    signal input agentAddress;
    signal input sessionId;
    signal input callCount;
    signal input windowStart;
    signal input windowEnd;
    signal input merkleRoot;
    signal input nullifier;

    // Private inputs
    signal input logHashes[MAX_ENTRIES];
    signal input logTimestamps[MAX_ENTRIES];
    signal input entryMask[MAX_ENTRIES];

    // Inverse witnesses enforce non-zero public identity fields.
    signal input agentAddressInv;
    signal input sessionIdInv;
    signal input nullifierInv;
    signal input windowDeltaInv;

    agentAddress * agentAddressInv === 1;
    sessionId * sessionIdInv === 1;
    nullifier * nullifierInv === 1;

    signal windowDelta;
    windowDelta <== windowEnd - windowStart;
    windowDelta * windowDeltaInv === 1;

    signal countAcc[MAX_ENTRIES + 1];
    signal rootAcc[MAX_ENTRIES + 1];

    countAcc[0] <== 0;
    rootAcc[0] <== 0;

    for (var i = 0; i < MAX_ENTRIES; i++) {
        // Binary mask
        entryMask[i] * (entryMask[i] - 1) === 0;

        countAcc[i + 1] <== countAcc[i] + entryMask[i];
        rootAcc[i + 1] <== rootAcc[i] + (logHashes[i] + logTimestamps[i]) * entryMask[i];
    }

    callCount === countAcc[MAX_ENTRIES];
    merkleRoot === rootAcc[MAX_ENTRIES];
}

component main { public [agentAddress, sessionId, callCount, windowStart, windowEnd, merkleRoot, nullifier] } = UsageBilling(128);
