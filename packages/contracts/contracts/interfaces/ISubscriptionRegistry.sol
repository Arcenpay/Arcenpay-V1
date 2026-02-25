// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISubscriptionRegistry
/// @notice Interface for the MEAP Subscription Registry
/// @dev Extends ERC-5643 with plan management and cross-chain support
interface ISubscriptionRegistry {
    // ============================================================
    //                          EVENTS
    // ============================================================

    /// @notice Emitted when a new subscription NFT is minted
    event SubscriptionMinted(
        address indexed subscriber,
        uint256 indexed tokenId,
        uint256 indexed planId,
        uint64 expiration
    );

    /// @notice Emitted when a subscription is renewed
    event SubscriptionRenewed(
        uint256 indexed tokenId,
        uint64 newExpiration,
        uint256 amountPaid
    );

    /// @notice Emitted when a subscription is cancelled
    event SubscriptionCancelled(uint256 indexed tokenId);

    /// @notice Emitted on successful billing cycle
    event BillingSuccess(
        uint256 indexed tokenId,
        uint256 indexed planId,
        uint256 amount,
        uint256 timestamp
    );

    // ============================================================
    //                     CORE FUNCTIONS
    // ============================================================

    /// @notice Mints a new subscription NFT for a user
    /// @param to The address to mint the NFT to
    /// @param planId The plan tier ID
    /// @param duration The subscription duration in seconds
    /// @return tokenId The minted token ID
    function mint(
        address to,
        uint256 planId,
        uint64 duration
    ) external returns (uint256 tokenId);

    /// @notice Extends an existing subscription's expiry
    /// @param tokenId The token ID to renew
    /// @param extension The duration to extend by (in seconds)
    function renew(uint256 tokenId, uint64 extension) external;

    /// @notice Cancels a subscription
    /// @param tokenId The token ID to cancel
    function cancel(uint256 tokenId) external;

    /// @notice Returns true if subscription is currently active
    /// @param tokenId The token ID to check
    /// @return True if active (not expired)
    function isValid(uint256 tokenId) external view returns (bool);

    /// @notice Returns plan tier and feature data reference
    /// @param tokenId The token ID to query
    /// @return planId The plan ID
    /// @return planTier The plan tier name
    function getPlanFeatures(uint256 tokenId) external view returns (uint256 planId, string memory planTier);

    /// @notice Updates state from cross-chain GMP message
    /// @param tokenId The token ID to update
    /// @param gmMessage The GMP message payload
    function updateCrossChain(uint256 tokenId, bytes calldata gmMessage) external;
}
