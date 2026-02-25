// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISessionVault
/// @notice Interface for ZKVUB pre-funded billing session vaults
interface ISessionVault {
    // ============================================================
    //                          EVENTS
    // ============================================================

    /// @notice Emitted when a session is funded
    event SessionFunded(
        address indexed agent,
        bytes32 indexed sessionId,
        uint256 amount,
        address token
    );

    /// @notice Emitted when usage is settled from a session
    event SessionSettled(
        bytes32 indexed sessionId,
        uint256 amount,
        address indexed provider
    );

    /// @notice Emitted when remaining balance is withdrawn
    event SessionWithdrawn(
        bytes32 indexed sessionId,
        uint256 amount,
        address indexed agent
    );

    // ============================================================
    //                     CORE FUNCTIONS
    // ============================================================

    /// @notice Creates and funds a new billing session
    /// @param amount The amount to deposit
    /// @param token The stablecoin address
    /// @return sessionId The unique session identifier
    function fundSession(
        uint256 amount,
        address token
    ) external returns (bytes32 sessionId);

    /// @notice Settles usage from a session vault (called by verifier)
    /// @param sessionId The session ID
    /// @param amount The settlement amount
    /// @param provider The provider to pay
    function settle(bytes32 sessionId, uint256 amount, address provider) external;

    /// @notice Withdraws remaining balance from a session
    /// @param sessionId The session ID
    function withdraw(bytes32 sessionId) external;

    /// @notice Returns the current balance of a session
    /// @param sessionId The session ID
    /// @return The remaining balance
    function getBalance(bytes32 sessionId) external view returns (uint256);

    /// @notice Returns the balance for an agent across all sessions
    /// @param agent The agent address
    /// @return The total balance
    function getAgentBalance(address agent) external view returns (uint256);
}
