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
}
