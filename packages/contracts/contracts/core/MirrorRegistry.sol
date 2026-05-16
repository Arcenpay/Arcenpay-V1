// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "../interfaces/ISubscriptionRegistry.sol";

/// @title MirrorRegistry
/// @notice Cross-chain entitlement state mirror
/// @dev Receives GMP messages and mirrors subscription state from primary chain
/// @dev Supports Axelar GMP (primary) and Chainlink CCIP (fallback) transport routes
contract MirrorRegistry is Initializable, OwnableUpgradeable, PausableUpgradeable, UUPSUpgradeable {
    uint8 public constant ROUTE_AXELAR = 1;
    uint8 public constant ROUTE_CCIP = 2;

    // ============================================================
    //                          STRUCTS
    // ============================================================

    struct MirroredSubscription {
        address subscriber;
        uint256 planId;
        string planTier;
        uint64 expiration;
        uint256 sourceChainId;
        uint256 sourceTokenId;
        uint64 sourceUpdatedAt;
        uint64 lastUpdated;
    }

    // ============================================================
    //                          EVENTS
    // ============================================================

    event SubscriptionMirrored(
        address indexed subscriber,
        uint256 indexed sourceTokenId,
        uint256 sourceChainId,
        uint64 expiration
    );

    event BridgeAuthorized(address indexed bridge, uint256 sourceChainId);
    event MirrorRouteConfigured(uint8 indexed route, address indexed transport);
    event TrustedSourceConfigured(uint256 indexed sourceChainId, bytes32 indexed sourceHash);
    event RoutedMessageProcessed(bytes32 indexed messageId, uint8 indexed route);

    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Source chain ID => bridge address => authorized
    mapping(uint256 => mapping(address => bool)) public authorizedBridges;

    /// @notice Source chain ID => trusted source registry hash
    mapping(uint256 => bytes32) public trustedSources;

    /// @notice Processed message IDs for duplicate suppression
    mapping(bytes32 => bool) public processedMessages;

    /// @notice Axelar gateway contract
    address public axelarGateway;

    /// @notice CCIP router contract
    address public ccipRouter;

    /// @notice Subscriber address => mirrored subscription
    mapping(address => MirroredSubscription) private _mirrors;

    /// @notice Source chain ID + token ID hash => subscriber address
    mapping(bytes32 => address) private _sourceToSubscriber;

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) external initializer {
        __Ownable_init(initialOwner);
        __Pausable_init();
    }

    // ============================================================
    //                      ADMIN FUNCTIONS
    // ============================================================

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Authorizes a bridge for a specific source chain
    function authorizeBridge(address bridge, uint256 sourceChainId) external onlyOwner {
        require(bridge != address(0), "MirrorRegistry: zero bridge");
        require(sourceChainId > 0, "MirrorRegistry: invalid source chain");
        authorizedBridges[sourceChainId][bridge] = true;
        emit BridgeAuthorized(bridge, sourceChainId);
    }

    /// @notice Configures the Axelar transport gateway
    function setAxelarGateway(address gateway) external onlyOwner {
        require(gateway != address(0), "MirrorRegistry: zero gateway");
        axelarGateway = gateway;
        emit MirrorRouteConfigured(ROUTE_AXELAR, gateway);
    }

    /// @notice Configures the CCIP transport router
    function setCCIPRouter(address router) external onlyOwner {
        require(router != address(0), "MirrorRegistry: zero router");
        ccipRouter = router;
        emit MirrorRouteConfigured(ROUTE_CCIP, router);
    }

    /// @notice Clears the Axelar transport gateway after routing is disabled operationally
    function clearAxelarGateway() external onlyOwner {
        axelarGateway = address(0);
        emit MirrorRouteConfigured(ROUTE_AXELAR, address(0));
    }

    /// @notice Clears the CCIP transport router after routing is disabled operationally
    function clearCCIPRouter() external onlyOwner {
        ccipRouter = address(0);
        emit MirrorRouteConfigured(ROUTE_CCIP, address(0));
    }

    /// @notice Registers trusted source subscription registry per source chain
    function setTrustedSource(uint256 sourceChainId, bytes calldata sourceAddress) external onlyOwner {
        require(sourceChainId > 0, "MirrorRegistry: invalid source chain");
        bytes32 sourceHash = keccak256(sourceAddress);
        trustedSources[sourceChainId] = sourceHash;
        emit TrustedSourceConfigured(sourceChainId, sourceHash);
    }

    // ============================================================
    //                    MIRROR FUNCTIONS
    // ============================================================

    /// @notice Receives and processes a cross-chain subscription update
    /// @dev Called by authorized GMP bridges. Verifies trusted source and deduplicates messages.
    function onGMPReceived(
        uint256 sourceChainId,
        bytes calldata sourceAddress,
        bytes32 messageId,
        bytes calldata payload
    ) external whenNotPaused {
        require(
            authorizedBridges[sourceChainId][msg.sender],
            "MirrorRegistry: unauthorized bridge"
        );

        // Trusted source verification (parity with _processRoutedMessage)
        require(messageId != bytes32(0), "MirrorRegistry: zero message id");
        require(!processedMessages[messageId], "MirrorRegistry: duplicate message");

        bytes32 trustedSourceHash = trustedSources[sourceChainId];
        require(trustedSourceHash != bytes32(0), "MirrorRegistry: source not configured");
        require(keccak256(sourceAddress) == trustedSourceHash, "MirrorRegistry: invalid source");

        processedMessages[messageId] = true;

        (
            address subscriber,
            uint256 sourceTokenId,
            uint256 planId,
            string memory planTier,
            uint64 expiration,
            uint64 sourceUpdatedAt
        ) = abi.decode(payload, (address, uint256, uint256, string, uint64, uint64));

        _applyMirrorUpdate(
            subscriber,
            sourceTokenId,
            planId,
            planTier,
            expiration,
            sourceChainId,
            sourceUpdatedAt
        );

        emit RoutedMessageProcessed(messageId, 0);
    }

    /// @notice Axelar-routed update entrypoint (primary route)
    function onAxelarMessage(
        uint256 sourceChainId,
        bytes calldata sourceAddress,
        bytes32 messageId,
        bytes calldata payload
    ) external whenNotPaused {
        require(msg.sender == axelarGateway, "MirrorRegistry: unauthorized axelar");
        _processRoutedMessage(ROUTE_AXELAR, sourceChainId, sourceAddress, messageId, payload);
    }

    /// @notice CCIP-routed update entrypoint (fallback route)
    function onCCIPMessage(
        uint256 sourceChainId,
        bytes calldata sourceAddress,
        bytes32 messageId,
        bytes calldata payload
    ) external whenNotPaused {
        require(msg.sender == ccipRouter, "MirrorRegistry: unauthorized ccip");
        _processRoutedMessage(ROUTE_CCIP, sourceChainId, sourceAddress, messageId, payload);
    }

    // ============================================================
    //                    QUERY FUNCTIONS
    // ============================================================

    /// @notice Checks if a subscriber has a valid mirrored subscription
    function isValid(address subscriber) external view returns (bool) {
        MirroredSubscription storage mirror = _mirrors[subscriber];
        return mirror.expiration > block.timestamp;
    }

    /// @notice Returns the mirrored subscription for a subscriber
    function getMirror(address subscriber) external view returns (MirroredSubscription memory) {
        return _mirrors[subscriber];
    }

    /// @notice Returns the expiration for a subscriber's mirrored subscription
    function expiresAt(address subscriber) external view returns (uint64) {
        return _mirrors[subscriber].expiration;
    }

    /// @notice Returns the plan tier for a subscriber
    function getPlanTier(address subscriber) external view returns (string memory) {
        return _mirrors[subscriber].planTier;
    }

    function _processRoutedMessage(
        uint8 route,
        uint256 sourceChainId,
        bytes calldata sourceAddress,
        bytes32 messageId,
        bytes calldata payload
    ) internal {
        require(messageId != bytes32(0), "MirrorRegistry: zero message id");
        require(!processedMessages[messageId], "MirrorRegistry: duplicate message");

        bytes32 trustedSourceHash = trustedSources[sourceChainId];
        require(trustedSourceHash != bytes32(0), "MirrorRegistry: source not configured");
        require(keccak256(sourceAddress) == trustedSourceHash, "MirrorRegistry: invalid source");

        processedMessages[messageId] = true;

        (
            address subscriber,
            uint256 sourceTokenId,
            uint256 planId,
            string memory planTier,
            uint64 expiration,
            uint64 sourceUpdatedAt
        ) = abi.decode(payload, (address, uint256, uint256, string, uint64, uint64));

        _applyMirrorUpdate(
            subscriber,
            sourceTokenId,
            planId,
            planTier,
            expiration,
            sourceChainId,
            sourceUpdatedAt
        );

        emit RoutedMessageProcessed(messageId, route);
    }

    function _applyMirrorUpdate(
        address subscriber,
        uint256 sourceTokenId,
        uint256 planId,
        string memory planTier,
        uint64 expiration,
        uint256 sourceChainId,
        uint64 sourceUpdatedAt
    ) internal {
        MirroredSubscription storage existing = _mirrors[subscriber];
        bool sameSource = existing.sourceChainId == sourceChainId &&
            existing.sourceTokenId == sourceTokenId;
        if (sameSource && existing.sourceUpdatedAt > sourceUpdatedAt) {
            return;
        }

        _mirrors[subscriber] = MirroredSubscription({
            subscriber: subscriber,
            planId: planId,
            planTier: planTier,
            expiration: expiration,
            sourceChainId: sourceChainId,
            sourceTokenId: sourceTokenId,
            sourceUpdatedAt: sourceUpdatedAt,
            lastUpdated: uint64(block.timestamp)
        });

        bytes32 sourceKey = keccak256(abi.encodePacked(sourceChainId, sourceTokenId));
        _sourceToSubscriber[sourceKey] = subscriber;

        emit SubscriptionMirrored(subscriber, sourceTokenId, sourceChainId, expiration);
    }

    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        (newImplementation);
    }
}
