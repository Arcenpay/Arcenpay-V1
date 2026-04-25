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

    /// @notice Emitted when an existing subscription token switches plans
    event SubscriptionPlanChanged(
        uint256 indexed tokenId,
        uint256 indexed previousPlanId,
        uint256 indexed newPlanId,
        uint64 expiration
    );

    /// @notice Emitted on successful billing cycle
    event BillingSuccess(
        uint256 indexed tokenId,
        uint256 indexed planId,
        uint256 amount,
        uint256 timestamp
    );

    /// @notice Emitted when a cross-chain sync message is dispatched
    event CrossChainDispatchRequested(
        uint256 indexed tokenId,
        uint256 indexed destinationChainId,
        uint8 indexed route,
        bytes32 messageId
    );

    /// @notice Emitted when primary route fails and fallback is attempted
    event CrossChainFallbackTriggered(
        uint256 indexed tokenId,
        uint256 indexed destinationChainId,
        bytes primaryError
    );

    /// @notice Emitted when an existing live subscription is imported during migration
    event SubscriptionImported(
        address indexed subscriber,
        uint256 indexed tokenId,
        uint256 indexed planId,
        uint64 expiration
    );

    /// @notice Emitted when migration imports are permanently disabled
    event RegistryMigrationFinalized();

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

    /// @notice Changes the active plan for an existing subscription token.
    /// @dev Biller-only so subscribers cannot self-upgrade access without payment.
    /// @param tokenId The token ID to update
    /// @param newPlanId The new plan identifier
    function changePlan(uint256 tokenId, uint256 newPlanId) external;

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

    /// @notice Configure Axelar/CCIP transport adapter contracts
    /// @param axelarTransport Address of Axelar adapter (primary)
    /// @param ccipTransport Address of CCIP adapter (fallback)
    function setCrossChainTransports(address axelarTransport, address ccipTransport) external;

    /// @notice Dispatches subscription state to a mirror chain
    /// @param tokenId Subscription token to sync
    /// @param destinationChainId Target chain id
    /// @param refundAddress Native-gas refund receiver for adapter
    /// @return messageId Transport-level message id
    /// @return routeUsed 1=Axelar, 2=CCIP
    function dispatchCrossChainUpdate(
        uint256 tokenId,
        uint256 destinationChainId,
        address refundAddress
    ) external payable returns (bytes32 messageId, uint8 routeUsed);

    /// @notice Returns active subscription token ID for a wallet
    /// @param wallet The wallet address
    /// @return tokenId The token ID (0 if none)
    function getWalletSubscription(address wallet) external view returns (uint256 tokenId);

    /// @notice Imports a live subscription during a one-time migration window
    function importSubscription(
        address to,
        uint256 tokenId,
        uint256 planId,
        uint64 expiration
    ) external;

    /// @notice Permanently disables migration imports
    function finalizeMigration() external;
}
