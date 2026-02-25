// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IZKUsageVerifier
/// @notice Interface for on-chain zk-SNARK proof verification and settlement
interface IZKUsageVerifier {
    // ============================================================
    //                          STRUCTS
    // ============================================================

    /// @notice Groth16 proof components
    struct Proof {
        uint256[2] a;    // Point A
        uint256[2][2] b; // Point B
        uint256[2] c;    // Point C
    }

    /// @notice Public inputs to the zk-SNARK circuit
    struct PublicInputs {
        bytes32 agentAddress;   // The consuming agent's wallet
        bytes32 sessionId;      // Unique session identifier
        uint256 callCount;      // Total API calls consumed
        uint64 windowStart;     // Billing window start timestamp
        uint64 windowEnd;       // Billing window end timestamp
        bytes32 merkleRoot;     // Root of Merkle tree of consumption logs
        bytes32 nullifier;      // Unique nullifier (prevents reuse)
    }

    // ============================================================
    //                          EVENTS
    // ============================================================

    /// @notice Emitted when a billing proof is verified and settled
    event BillingSettled(
        bytes32 indexed sessionId,
        bytes32 indexed agentAddress,
        uint256 callCount,
        uint256 settlementAmount,
        uint64 windowStart,
        uint64 windowEnd
    );

    // ============================================================
    //                     CORE FUNCTIONS
    // ============================================================

    /// @notice Main settlement entry point — verifies zk-SNARK and triggers payment
    /// @param proof The Groth16 proof
    /// @param inputs The public inputs
    function submitProof(Proof calldata proof, PublicInputs calldata inputs) external;

    /// @notice Checks if a nullifier has been used
    /// @param nullifier The nullifier to check
    /// @return True if already used
    function isNullifierUsed(bytes32 nullifier) external view returns (bool);

    /// @notice Returns the rate schedule for a plan
    /// @param planId The plan ID
    /// @return ratePerCall Price per API call in stablecoin base units
    function getRateSchedule(uint256 planId) external view returns (uint256 ratePerCall);

    /// @notice Returns the pending session balance for an agent
    /// @param agent The agent address
    /// @return The current session vault balance
    function getPendingBalance(address agent) external view returns (uint256);
}
