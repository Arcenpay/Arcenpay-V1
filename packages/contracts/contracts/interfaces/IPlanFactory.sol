// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPlanFactory
/// @notice Interface for SaaS provider plan configuration and deployment
interface IPlanFactory {
    // ============================================================
    //                          STRUCTS
    // ============================================================

    /// @notice Plan tier configuration
    struct Plan {
        uint256 id;               // Unique plan ID
        address provider;         // SaaS provider address
        string name;              // Plan name (e.g., "Pro", "Enterprise")
        string tier;              // Tier identifier (e.g., "starter", "pro", "enterprise")
        uint256 price;            // Price per interval in stablecoin base units
        uint32 billingInterval;   // Interval in seconds (e.g., 2,592,000 for monthly)
        address acceptedToken;    // Stablecoin address (USDC)
        bool active;              // Whether the plan is currently available
        string metadataURI;       // IPFS or Tableland URI for additional plan metadata
    }

    // ============================================================
    //                          EVENTS
    // ============================================================

    /// @notice Emitted when a new plan is created
    event PlanCreated(
        uint256 indexed planId,
        address indexed provider,
        string name,
        uint256 price,
        uint32 billingInterval
    );

    /// @notice Emitted when a plan is updated
    event PlanUpdated(uint256 indexed planId);

    /// @notice Emitted when a plan is deactivated
    event PlanDeactivated(uint256 indexed planId);

    /// @notice Emitted when a new provider is registered
    event ProviderRegistered(address indexed provider);

    // ============================================================
    //                     CORE FUNCTIONS
    // ============================================================

    /// @notice Registers a new SaaS provider
    /// @param provider The provider's address
    function registerProvider(address provider) external;

    /// @notice Creates a new subscription plan
    /// @param name The plan name
    /// @param tier The plan tier identifier
    /// @param price Price per interval in stablecoin base units
    /// @param billingInterval Billing interval in seconds
    /// @param acceptedToken Stablecoin address
    /// @param metadataURI Plan metadata URI
    /// @return planId The created plan ID
    function createPlan(
        string calldata name,
        string calldata tier,
        uint256 price,
        uint32 billingInterval,
        address acceptedToken,
        string calldata metadataURI
    ) external returns (uint256 planId);

    /// @notice Returns plan details by ID
    /// @param planId The plan ID
    /// @return plan The plan configuration
    function getPlan(uint256 planId) external view returns (Plan memory plan);

    /// @notice Updates an existing plan's configuration
    /// @param planId The plan ID to update
    /// @param price New price (0 = no change)
    /// @param metadataURI New metadata URI (empty = no change)
    function updatePlan(
        uint256 planId,
        uint256 price,
        string calldata metadataURI
    ) external;

    /// @notice Deactivates a plan (no new subscriptions)
    /// @param planId The plan ID to deactivate
    function deactivatePlan(uint256 planId) external;

    /// @notice Returns all plans for a provider
    /// @param provider The provider address
    /// @return planIds Array of plan IDs
    function getProviderPlans(address provider) external view returns (uint256[] memory planIds);

    /// @notice Checks if an address is a registered provider
    /// @param provider The address to check
    /// @return True if registered
    function isProvider(address provider) external view returns (bool);
}
