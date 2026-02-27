// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IGroth16Verifier
/// @notice Interface implemented by snarkjs-exported Groth16 verifier contracts
interface IGroth16Verifier {
    /// @notice Verifies a Groth16 proof against public inputs
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata input
    ) external view returns (bool);
}
