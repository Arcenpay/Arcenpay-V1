// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IERC5643 - Subscription NFT Standard
/// @notice Interface for ERC-5643 subscription-based NFTs
interface IERC5643 {
    /// @notice Emitted when a subscription is renewed
    event SubscriptionUpdate(uint256 indexed tokenId, uint64 expiration);

    /// @notice Renews the subscription for a given token
    /// @param tokenId The token ID to renew
    /// @param duration The duration to extend the subscription by (in seconds)
    function renewSubscription(uint256 tokenId, uint64 duration) external payable;

    /// @notice Cancels the subscription for a given token
    /// @param tokenId The token ID to cancel
    function cancelSubscription(uint256 tokenId) external payable;

    /// @notice Returns the expiration date of a subscription
    /// @param tokenId The token ID to check
    /// @return The expiration timestamp
    function expiresAt(uint256 tokenId) external view returns (uint64);

    /// @notice Returns whether a subscription is currently valid
    /// @param tokenId The token ID to check
    /// @return True if the subscription is active
    function isRenewable(uint256 tokenId) external view returns (bool);
}
