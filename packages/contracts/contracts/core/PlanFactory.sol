// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IPlanFactory.sol";

/// @title PlanFactory
/// @notice SaaS provider plan configuration and deployment
/// @dev Manages provider registration and plan tier CRUD operations
contract PlanFactory is IPlanFactory, Ownable, ReentrancyGuard {
    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Counter for plan IDs
    uint256 private _nextPlanId;

    /// @notice Registered providers
    mapping(address => bool) private _providers;

    /// @notice Plan storage by ID
    mapping(uint256 => Plan) private _plans;

    /// @notice Provider address => array of plan IDs
    mapping(address => uint256[]) private _providerPlans;

    /// @notice Approved stablecoin tokens
    mapping(address => bool) public approvedTokens;

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    constructor(address[] memory _approvedTokens) Ownable(msg.sender) {
        _nextPlanId = 1; // Start plan IDs at 1
        for (uint256 i = 0; i < _approvedTokens.length; i++) {
            approvedTokens[_approvedTokens[i]] = true;
        }
    }

    // ============================================================
    //                      ADMIN FUNCTIONS
    // ============================================================

    /// @notice Adds a token to the approved list
    /// @param token The token address to approve
    function approveToken(address token) external onlyOwner {
        approvedTokens[token] = true;
    }

    /// @notice Removes a token from the approved list
    /// @param token The token address to remove
    function revokeToken(address token) external onlyOwner {
        approvedTokens[token] = false;
    }

    // ============================================================
    //                    PROVIDER FUNCTIONS
    // ============================================================

    /// @inheritdoc IPlanFactory
    function registerProvider(address provider) external onlyOwner {
        require(provider != address(0), "PlanFactory: zero address");
        require(!_providers[provider], "PlanFactory: already registered");
        _providers[provider] = true;
        emit ProviderRegistered(provider);
    }

    /// @inheritdoc IPlanFactory
    function createPlan(
        string calldata name,
        string calldata tier,
        uint256 price,
        uint32 billingInterval,
        address acceptedToken,
        string calldata metadataURI
    ) external returns (uint256 planId) {
        require(_providers[msg.sender], "PlanFactory: not a provider");
        require(price > 0, "PlanFactory: price must be > 0");
        require(billingInterval >= 2_592_000, "PlanFactory: interval must be >= 30 days");
        require(approvedTokens[acceptedToken], "PlanFactory: token not approved");
        require(bytes(name).length > 0, "PlanFactory: empty name");

        planId = _nextPlanId++;

        _plans[planId] = Plan({
            id: planId,
            provider: msg.sender,
            name: name,
            tier: tier,
            price: price,
            billingInterval: billingInterval,
            acceptedToken: acceptedToken,
            active: true,
            metadataURI: metadataURI
        });

        _providerPlans[msg.sender].push(planId);

        emit PlanCreated(planId, msg.sender, name, price, billingInterval);
    }

    /// @inheritdoc IPlanFactory
    function getPlan(uint256 planId) external view returns (Plan memory plan) {
        require(_plans[planId].id != 0, "PlanFactory: plan not found");
        return _plans[planId];
    }

    /// @inheritdoc IPlanFactory
    function updatePlan(
        uint256 planId,
        uint256 price,
        string calldata metadataURI
    ) external {
        Plan storage plan = _plans[planId];
        require(plan.id != 0, "PlanFactory: plan not found");
        require(plan.provider == msg.sender, "PlanFactory: not plan owner");

        if (price > 0) {
            plan.price = price;
        }
        if (bytes(metadataURI).length > 0) {
            plan.metadataURI = metadataURI;
        }

        emit PlanUpdated(planId);
    }

    /// @inheritdoc IPlanFactory
    function deactivatePlan(uint256 planId) external {
        Plan storage plan = _plans[planId];
        require(plan.id != 0, "PlanFactory: plan not found");
        require(plan.provider == msg.sender || msg.sender == owner(), "PlanFactory: unauthorized");
        require(plan.active, "PlanFactory: already inactive");

        plan.active = false;
        emit PlanDeactivated(planId);
    }

    /// @inheritdoc IPlanFactory
    function getProviderPlans(address provider) external view returns (uint256[] memory planIds) {
        return _providerPlans[provider];
    }

    /// @inheritdoc IPlanFactory
    function isProvider(address provider) external view returns (bool) {
        return _providers[provider];
    }
}
