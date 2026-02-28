// ============================================================
//  ZKVUB Usage Billing Circuit — Circom
//  PRD ZKVUB-004 — zk-SNARK Proof Generation
//
//  Circuit proves:
//    1. Prover knows N signed usage log entries
//    2. Entries hash to the committed Merkle root
//    3. Call count matches the number of leaves
//    4. All entries fall within the claimed billing window
//    5. Public inputs align with on-chain verifier expectations
//
//  Compile:  circom UsageBilling.circom --r1cs --wasm --sym
//  Setup:    snarkjs groth16 setup usage_billing.r1cs pot12_final.ptau circuit_0000.zkey
//  Prove:    snarkjs groth16 prove circuit_final.zkey witness.wtns proof.json public.json
//  Verify:   snarkjs groth16 verify verification_key.json public.json proof.json
// ============================================================

pragma circom 2.1.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/mux1.circom";

// Maximum number of usage log entries per proof
// Adjust based on gas cost analysis of on-chain verification
template UsageBilling(MAX_ENTRIES) {

    // ─── Public Inputs ───
    signal input agentAddress;        // Agent wallet (left-padded bytes32)
    signal input merkleRoot;          // Root of usage log Merkle tree
    signal input callCount;           // Number of API calls in this window
    signal input windowStart;         // Unix timestamp — billing window start
    signal input windowEnd;           // Unix timestamp — billing window end
    signal input sessionId;           // Session vault identifier
    signal input nullifier;           // Prevents double-settlement

    // ─── Private Inputs ───
    signal input logHashes[MAX_ENTRIES];     // Poseidon hash of each signed log entry
    signal input logTimestamps[MAX_ENTRIES]; // Timestamp of each log entry
    signal input entryMask[MAX_ENTRIES];     // 1 if entry is real, 0 if padding

    // Basic non-zero guards for key identity fields
    component agentIsZero = IsEqual();
    agentIsZero.in[0] <== agentAddress;
    agentIsZero.in[1] <== 0;
    agentIsZero.out === 0;

    component sessionIsZero = IsEqual();
    sessionIsZero.in[0] <== sessionId;
    sessionIsZero.in[1] <== 0;
    sessionIsZero.out === 0;

    component nullifierIsZero = IsEqual();
    nullifierIsZero.in[0] <== nullifier;
    nullifierIsZero.in[1] <== 0;
    nullifierIsZero.out === 0;

    // ─── Constraint 1: Verify call count matches active entries ───
    var actualCount = 0;
    for (var i = 0; i < MAX_ENTRIES; i++) {
        actualCount += entryMask[i];
        // Ensure mask is binary
        entryMask[i] * (1 - entryMask[i]) === 0;
    }
    actualCount === callCount;

    // ─── Constraint 2: All active timestamps within billing window ───
    component geStart[MAX_ENTRIES];
    component leEnd[MAX_ENTRIES];

    for (var i = 0; i < MAX_ENTRIES; i++) {
        geStart[i] = GreaterEqThan(64);
        geStart[i].in[0] <== logTimestamps[i];
        geStart[i].in[1] <== windowStart;

        leEnd[i] = LessEqThan(64);
        leEnd[i].in[0] <== logTimestamps[i];
        leEnd[i].in[1] <== windowEnd;

        // If entry is active (mask=1), timestamps must be in window
        // If entry is inactive (mask=0), constraint is trivially satisfied
        entryMask[i] * (1 - geStart[i].out) === 0;
        entryMask[i] * (1 - leEnd[i].out) === 0;
    }

    // ─── Constraint 3: Compute Merkle root from log hashes ───
    // Simplified: hash all active entries together using Poseidon chain
    // Production: use proper Merkle tree with inclusion proofs
    component hashChain[MAX_ENTRIES];

    hashChain[0] = Poseidon(2);
    hashChain[0].inputs[0] <== logHashes[0];
    hashChain[0].inputs[1] <== entryMask[0];

    for (var i = 1; i < MAX_ENTRIES; i++) {
        hashChain[i] = Poseidon(2);
        hashChain[i].inputs[0] <== hashChain[i-1].out;
        hashChain[i].inputs[1] <== logHashes[i] * entryMask[i];
    }

    // Final hash must equal the committed Merkle root
    merkleRoot === hashChain[MAX_ENTRIES - 1].out;

    // Nullifier is a committed public input and is enforced on-chain for one-time use.
}

// Default instantiation: 128 max entries per proof
component main { public [agentAddress, sessionId, callCount, windowStart, windowEnd, merkleRoot, nullifier] } = UsageBilling(128);
