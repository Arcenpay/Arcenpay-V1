// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IFeeCollector
/// @notice Interface for protocol fee collection and distribution
interface IFeeCollector {
    // ============================================================
    //                          EVENTS
    // ============================================================

    /// @notice Emitted when a fee is collected
    event FeeCollected(
        address indexed from,
        uint256 amount,
        uint256 feeAmount,
        string feeType
    );

    /// @notice Emitted when fees are withdrawn to treasury
    event FeesWithdrawn(address indexed treasury, uint256 amount);

    /// @notice Emitted when a provider's fee override is set
    event ProviderFeeRateSet(
        address indexed provider,
        uint256 subFeeBps,
        uint256 settleFeeBps
    );

    /// @notice Emitted when a provider's tier is synced
    event ProviderTierSynced(
        address indexed provider,
        uint8 tier,
        uint256 subFeeBps,
        uint256 settleFeeBps
    );

    // ============================================================
    //                     CORE FUNCTIONS
    // ============================================================

    /// @notice Calculates and collects the subscription fee
    /// @param amount The total transaction amount
    /// @return feeAmount The fee amount collected
    function collectSubscriptionFee(uint256 amount) external returns (uint256 feeAmount);

    /// @notice Calculates and collects the ZKVUB settlement fee
    /// @param amount The total settlement amount
    /// @return feeAmount The fee amount collected
    function collectSettlementFee(uint256 amount) external returns (uint256 feeAmount);

    /// @notice Returns the current subscription fee rate (in basis points)
    /// @return The fee rate (e.g., 50 = 0.5%)
    function subscriptionFeeRate() external view returns (uint256);

    /// @notice Returns the current ZKVUB settlement fee rate (in basis points)
    /// @return The fee rate (e.g., 30 = 0.3%)
    function settlementFeeRate() external view returns (uint256);

    /// @notice Returns accumulated fees for a token
    /// @param token The token address
    /// @return The accumulated fee balance
    function accumulatedFees(address token) external view returns (uint256);

    /// @notice Receives fee tokens from billing contracts
    /// @param token The token address
    /// @param amount The fee amount received
    function receiveFee(address token, uint256 amount) external;

    /// @notice Withdraws accumulated fees to the protocol treasury
    /// @param token The token address to withdraw
    function withdrawFees(address token) external;

    // ============================================================
    //                  PROVIDER-SPECIFIC FEES
    // ============================================================

    /// @notice Collects subscription fee using the provider-specific rate override
    /// @param amount The total transaction amount
    /// @param provider The provider whose rate to use
    /// @return feeAmount The fee amount collected
    function collectSubscriptionFeeFor(uint256 amount, address provider) external returns (uint256 feeAmount);

    /// @notice Collects settlement fee using the provider-specific rate override
    /// @param amount The total settlement amount
    /// @param provider The provider whose rate to use
    /// @return feeAmount The fee amount collected
    function collectSettlementFeeFor(uint256 amount, address provider) external returns (uint256 feeAmount);

    /// @notice Returns the effective subscription fee rate for a provider
    /// @param provider The provider wallet address
    /// @return The fee rate in basis points
    function getProviderSubFeeBps(address provider) external view returns (uint256);

    /// @notice Returns the effective settlement fee rate for a provider
    /// @param provider The provider wallet address
    /// @return The fee rate in basis points
    function getProviderSettleFeeBps(address provider) external view returns (uint256);

    // ============================================================
    //                     TIER MANAGEMENT
    // ============================================================

    /// @notice Sets fee rate overrides for a specific provider
    /// @param provider The provider wallet address
    /// @param subFeeBps Subscription fee in basis points
    /// @param settleFeeBps Settlement fee in basis points
    function setProviderFeeRates(address provider, uint256 subFeeBps, uint256 settleFeeBps) external;

    /// @notice Syncs a provider's fee rates based on their platform tier
    /// @param provider The provider wallet address
    /// @param tier The platform tier (0=FREE, 1=PLUS, 2=PRO)
    function syncProviderTier(address provider, uint8 tier) external;

    /// @notice Updates the default fee rates for a platform tier
    /// @param tier The tier (0=FREE, 1=PLUS, 2=PRO)
    /// @param subFeeBps Subscription fee in basis points
    /// @param settleFeeBps Settlement fee in basis points
    function setTierFeeRates(uint8 tier, uint256 subFeeBps, uint256 settleFeeBps) external;
}
