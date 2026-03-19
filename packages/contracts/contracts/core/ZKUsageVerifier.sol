// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "../interfaces/IZKUsageVerifier.sol";
import "../interfaces/ISessionVault.sol";
import "../interfaces/IFeeCollector.sol";
import "../interfaces/IPlanFactory.sol";
import "../interfaces/IGroth16Verifier.sol";

/// @title ZKUsageVerifier
/// @notice On-chain zk-SNARK proof verification and ZKVUB settlement
contract ZKUsageVerifier is IZKUsageVerifier, Ownable, ReentrancyGuard, Pausable {
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

    /// @notice Session ID => settlement plan routing
    mapping(bytes32 => uint256) private _sessionPlanIds;

    /// @notice Session ID => explicit payout recipient
    mapping(bytes32 => address) private _sessionProviders;

    /// @notice snarkjs-exported Groth16 verifier contract
    address public groth16Verifier;

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

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Sets the rate schedule for a plan
    /// @param planId The plan ID
    /// @param ratePerCall Price per API call in stablecoin base units
    function setRateSchedule(uint256 planId, uint256 ratePerCall) external onlyOwner {
        require(ratePerCall > 0, "ZKVerifier: zero rate");
        _rateSchedules[planId] = ratePerCall;
    }

    /// @inheritdoc IZKUsageVerifier
    function setSessionSettlementConfig(
        bytes32 sessionId,
        uint256 planId,
        address provider
    ) external onlyOwner {
        require(sessionId != bytes32(0), "ZKVerifier: zero session");
        if (provider == address(0) && planId != 0) {
            provider = planFactory.getPlan(planId).provider;
        }
        _sessionPlanIds[sessionId] = planId;
        _sessionProviders[sessionId] = provider;
        emit SessionSettlementConfigured(sessionId, planId, provider);
    }

    /// @inheritdoc IZKUsageVerifier
    function setGroth16Verifier(address verifier) external onlyOwner {
        require(verifier != address(0), "ZKVerifier: zero verifier");
        groth16Verifier = verifier;
        emit Groth16VerifierSet(verifier);
    }

    // ============================================================
    //                    PROOF VERIFICATION
    // ============================================================

    /// @inheritdoc IZKUsageVerifier
    function submitProof(
        Proof calldata proof,
        PublicInputs calldata inputs
    ) external nonReentrant whenNotPaused {
        require(groth16Verifier != address(0), "ZKVerifier: verifier not configured");

        // 1. Check nullifier hasn't been used
        require(!_usedNullifiers[inputs.nullifier], "ZKVerifier: nullifier already used");

        // 2. Verify proof validity
        require(_verifyProof(proof, inputs), "ZKVerifier: invalid proof");

        // 3. Mark nullifier as used
        _usedNullifiers[inputs.nullifier] = true;

        // 4. Calculate settlement amount
        uint256 sessionPlanId = _sessionPlanIds[inputs.sessionId];
        uint256 ratePerCall = _rateSchedules[sessionPlanId];
        if (ratePerCall == 0 && sessionPlanId != 0) {
            // Backward-compatible fallback for sessions without explicit plan rates configured.
            ratePerCall = _rateSchedules[0];
        }
        require(ratePerCall > 0, "ZKVerifier: no rate configured");

        uint256 settlementAmount = inputs.callCount * ratePerCall;

        // 5. Calculate protocol fee
        uint256 protocolFee = feeCollector.collectSettlementFee(settlementAmount);
        uint256 providerAmount = settlementAmount - protocolFee;

        // 6. Execute settlement from session vault
        address provider = _sessionProviders[inputs.sessionId];
        if (provider == address(0) && sessionPlanId != 0) {
            provider = planFactory.getPlan(sessionPlanId).provider;
        }
        require(provider != address(0), "ZKVerifier: provider not resolved");
        sessionVault.settle(inputs.sessionId, providerAmount, provider);

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

    /// @dev Groth16 proof verification using generated verifier contract
    function _verifyProof(
        Proof calldata proof,
        PublicInputs calldata inputs
    ) internal view returns (bool) {
        require(inputs.windowEnd > inputs.windowStart, "ZKVerifier: invalid window");
        require(inputs.callCount > 0, "ZKVerifier: zero calls");
        require(inputs.agentAddress != bytes32(0), "ZKVerifier: zero agent");
        require(inputs.sessionId != bytes32(0), "ZKVerifier: zero session");
        require(inputs.windowEnd <= uint64(block.timestamp), "ZKVerifier: future window");

        uint256[] memory publicSignals = new uint256[](7);
        publicSignals[0] = uint256(inputs.agentAddress);
        publicSignals[1] = uint256(inputs.sessionId);
        publicSignals[2] = inputs.callCount;
        publicSignals[3] = uint256(inputs.windowStart);
        publicSignals[4] = uint256(inputs.windowEnd);
        publicSignals[5] = uint256(inputs.merkleRoot);
        publicSignals[6] = uint256(inputs.nullifier);

        return IGroth16Verifier(groth16Verifier).verifyProof(
            proof.a,
            proof.b,
            proof.c,
            publicSignals
        );
    }
}
