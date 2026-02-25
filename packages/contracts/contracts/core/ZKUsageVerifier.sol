// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IZKUsageVerifier.sol";
import "../interfaces/ISessionVault.sol";
import "../interfaces/IFeeCollector.sol";
import "../interfaces/IPlanFactory.sol";

/// @title ZKUsageVerifier
/// @notice On-chain zk-SNARK proof verification and ZKVUB settlement
/// @dev MVP stub — Groth16 verifier will be generated from Circom circuit in Phase 5
contract ZKUsageVerifier is IZKUsageVerifier, Ownable, ReentrancyGuard {
    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Reference to SessionVault
    ISessionVault public immutable sessionVault;

    /// @notice Reference to FeeCollector
    IFeeCollector public immutable feeCollector;

    /// @notice Reference to PlanFactory
    IPlanFactory public immutable planFactory;

    /// @notice Used nullifiers (prevents double-spend)
    mapping(bytes32 => bool) private _usedNullifiers;

    /// @notice Plan ID => rate per API call (in stablecoin base units)
    mapping(uint256 => uint256) private _rateSchedules;

    /// @notice Groth16 verification key (set after circuit compilation)
    /// @dev Placeholder — will be populated from snarkjs trusted setup
    bool public verificationKeySet;

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    constructor(
        address _sessionVault,
        address _feeCollector,
        address _planFactory
    ) Ownable(msg.sender) {
        require(_sessionVault != address(0), "ZKVerifier: zero SessionVault");
        require(_feeCollector != address(0), "ZKVerifier: zero FeeCollector");
        require(_planFactory != address(0), "ZKVerifier: zero PlanFactory");

        sessionVault = ISessionVault(_sessionVault);
        feeCollector = IFeeCollector(_feeCollector);
        planFactory = IPlanFactory(_planFactory);
    }

    // ============================================================
    //                      ADMIN FUNCTIONS
    // ============================================================

    /// @notice Sets the rate schedule for a plan
    /// @param planId The plan ID
    /// @param ratePerCall Price per API call in stablecoin base units
    function setRateSchedule(uint256 planId, uint256 ratePerCall) external onlyOwner {
        require(ratePerCall > 0, "ZKVerifier: zero rate");
        _rateSchedules[planId] = ratePerCall;
    }

    /// @notice Sets the verification key (called after Circom trusted setup)
    function setVerificationKey(bytes calldata /* vkData */) external onlyOwner {
        // TODO: Parse and store Groth16 verification key from snarkjs export
        verificationKeySet = true;
    }

    // ============================================================
    //                    PROOF VERIFICATION
    // ============================================================

    /// @inheritdoc IZKUsageVerifier
    function submitProof(
        Proof calldata proof,
        PublicInputs calldata inputs
    ) external nonReentrant {
        // 1. Check nullifier hasn't been used
        require(!_usedNullifiers[inputs.nullifier], "ZKVerifier: nullifier already used");

        // 2. Verify proof validity
        require(_verifyProof(proof, inputs), "ZKVerifier: invalid proof");

        // 3. Mark nullifier as used
        _usedNullifiers[inputs.nullifier] = true;

        // 4. Calculate settlement amount
        // For MVP, we use a simplified approach — will be replaced with proper
        // plan-specific rate lookup once PlanFactory is fully integrated
        uint256 ratePerCall = _rateSchedules[0]; // Default rate
        require(ratePerCall > 0, "ZKVerifier: no rate configured");

        uint256 settlementAmount = inputs.callCount * ratePerCall;

        // 5. Calculate protocol fee
        uint256 protocolFee = feeCollector.collectSettlementFee(settlementAmount);
        uint256 providerAmount = settlementAmount - protocolFee;

        // 6. Execute settlement from session vault
        // The provider address is derived from the session configuration
        // For MVP, settlement goes to contract owner (provider)
        sessionVault.settle(inputs.sessionId, providerAmount, owner());

        // 7. Emit settlement event
        emit BillingSettled(
            inputs.sessionId,
            inputs.agentAddress,
            inputs.callCount,
            settlementAmount,
            inputs.windowStart,
            inputs.windowEnd
        );
    }

    /// @inheritdoc IZKUsageVerifier
    function isNullifierUsed(bytes32 nullifier) external view returns (bool) {
        return _usedNullifiers[nullifier];
    }

    /// @inheritdoc IZKUsageVerifier
    function getRateSchedule(uint256 planId) external view returns (uint256 ratePerCall) {
        return _rateSchedules[planId];
    }

    /// @inheritdoc IZKUsageVerifier
    function getPendingBalance(address agent) external view returns (uint256) {
        return sessionVault.getAgentBalance(agent);
    }

    // ============================================================
    //                    INTERNAL FUNCTIONS
    // ============================================================

    /// @dev Groth16 proof verification
    /// @notice MVP STUB — always returns true. Real verification from Circom in Phase 5.
    function _verifyProof(
        Proof calldata /* proof */,
        PublicInputs calldata inputs
    ) internal view returns (bool) {
        // Basic sanity checks
        require(inputs.windowEnd > inputs.windowStart, "ZKVerifier: invalid window");
        require(inputs.callCount > 0, "ZKVerifier: zero calls");
        require(inputs.agentAddress != bytes32(0), "ZKVerifier: zero agent");
        require(inputs.sessionId != bytes32(0), "ZKVerifier: zero session");

        // TODO: Implement actual Groth16 pairing check
        // This will be auto-generated by snarkjs after circuit compilation:
        //   snarkjs groth16 export solidityverifier circuit.zkey verifier.sol
        //
        // The generated verifier performs:
        //   1. Scalar field validation of proof elements
        //   2. Elliptic curve pairing check: e(A, B) = e(alpha, beta) * e(IC, gamma) * e(C, delta)
        //   3. Gas cost: ~200,000 gas

        if (!verificationKeySet) {
            // In development mode without VK, allow trusted submissions from owner
            return msg.sender == owner();
        }

        return true; // Placeholder
    }
}
