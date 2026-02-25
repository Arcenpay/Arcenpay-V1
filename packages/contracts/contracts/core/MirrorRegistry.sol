// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/ISubscriptionRegistry.sol";

/// @title MirrorRegistry
/// @notice Cross-chain entitlement state mirror
/// @dev Receives GMP messages and mirrors subscription state from primary chain
/// @dev Phase 3 stub — will integrate Axelar GMP and Chainlink CCIP
contract MirrorRegistry is Ownable {
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

    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Source chain ID => bridge address => authorized
    mapping(uint256 => mapping(address => bool)) public authorizedBridges;

    /// @notice Subscriber address => mirrored subscription
    mapping(address => MirroredSubscription) private _mirrors;

    /// @notice Source chain ID + token ID hash => subscriber address
    mapping(bytes32 => address) private _sourceToSubscriber;

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    constructor() Ownable(msg.sender) {}

    // ============================================================
    //                      ADMIN FUNCTIONS
    // ============================================================

    /// @notice Authorizes a bridge for a specific source chain
    function authorizeBridge(address bridge, uint256 sourceChainId) external onlyOwner {
        authorizedBridges[sourceChainId][bridge] = true;
        emit BridgeAuthorized(bridge, sourceChainId);
    }

    // ============================================================
    //                    MIRROR FUNCTIONS
    // ============================================================

    /// @notice Receives and processes a cross-chain subscription update
    /// @dev Called by authorized GMP bridges
    function onGMPReceived(
        uint256 sourceChainId,
        bytes calldata payload
    ) external {
        require(
            authorizedBridges[sourceChainId][msg.sender],
            "MirrorRegistry: unauthorized bridge"
        );

        // Decode payload
        (
            address subscriber,
            uint256 sourceTokenId,
            uint256 planId,
            string memory planTier,
            uint64 expiration
        ) = abi.decode(payload, (address, uint256, uint256, string, uint64));

        // Update mirror
        _mirrors[subscriber] = MirroredSubscription({
            subscriber: subscriber,
            planId: planId,
            planTier: planTier,
            expiration: expiration,
            sourceChainId: sourceChainId,
            sourceTokenId: sourceTokenId,
            lastUpdated: uint64(block.timestamp)
        });

        // Map source token to subscriber
        bytes32 sourceKey = keccak256(abi.encodePacked(sourceChainId, sourceTokenId));
        _sourceToSubscriber[sourceKey] = subscriber;

        emit SubscriptionMirrored(subscriber, sourceTokenId, sourceChainId, expiration);
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
}
