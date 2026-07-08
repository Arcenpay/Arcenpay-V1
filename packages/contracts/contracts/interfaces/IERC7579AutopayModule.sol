// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IERC7579Module
/// @notice Minimal interface for ERC-7579 modules (Executor type)
interface IERC7579Module {
    /// @notice Called when the module is installed on a smart account
    /// @param data Initialization data (abi-encoded config)
    function onInstall(bytes calldata data) external;

    /// @notice Called when the module is uninstalled from a smart account
    /// @param data De-initialization data
    function onUninstall(bytes calldata data) external;

    /// @notice Returns whether this module is of a certain type
    /// @param moduleTypeId The module type ID (1 = Validator, 2 = Executor, 3 = Fallback, 4 = Hook)
    /// @return True if this module matches the given type
    function isModuleType(uint256 moduleTypeId) external pure returns (bool);

    /// @notice Returns whether the module is initialized for a given smart account
    /// @param smartAccount The smart account address
    /// @return True if initialized
    function isInitialized(address smartAccount) external view returns (bool);
}

/// @title IERC7579AutopayModule
/// @notice Interface for the ArcenPay Autopay Executor Module
interface IERC7579AutopayModule is IERC7579Module {
    // ============================================================
    //                          STRUCTS
    // ============================================================

    /// @notice Configuration for the autopay module
    struct AutopayConfig {
        address merchant;      // Provider's billing contract address
        uint256 maxAmount;     // Max pull amount per interval (in token base units)
        address token;         // Approved stablecoin address (USDC)
        uint32 interval;       // Billing interval in seconds (e.g., 2,592,000 for monthly)
        uint64 startTime;      // Billing start timestamp
        uint256 planId;        // Reference to PlanFactory plan ID
        uint256 maxTotalAmount; // Maximum total amount pullable over config lifetime (0 = unlimited)
    }

    enum BillingReason {
        ACTIVATION,
        RENEWAL,
        PLAN_CHANGE_UPGRADE
    }

    // ============================================================
    //                          EVENTS
    // ============================================================

    /// @notice Emitted when autopay is configured for an account
    event AutopayConfigured(
        address indexed account,
        address indexed merchant,
        uint256 maxAmount,
        address token,
        uint32 interval
    );

    /// @notice Emitted when autopay config is updated for an account
    event AutopayConfigUpdated(
        address indexed account,
        uint256 indexed previousPlanId,
        uint256 indexed newPlanId,
        uint256 maxAmount,
        uint32 interval
    );

    /// @notice Emitted on successful payment pull
    event PaymentExecuted(
        address indexed account,
        address indexed merchant,
        uint256 amount,
        uint256 timestamp
    );

    /// @notice Emitted with authoritative billing details for an executed charge
    event BillingExecuted(
        address indexed account,
        address indexed merchant,
        uint256 indexed tokenId,
        uint256 planId,
        BillingReason reason,
        uint256 grossAmount,
        uint256 merchantAmount,
        uint256 protocolFee,
        uint256 timestamp
    );

    /// @notice Emitted when autopay is revoked
    event AutopayRevoked(address indexed account);

    /// @notice Emitted when an account pauses its autopay
    event AccountAutopayPaused(address indexed account);

    /// @notice Emitted when an account unpauses its autopay
    event AccountAutopayUnpaused(address indexed account);

    /// @notice Emitted when a failed cross-chain dispatch is successfully retried
    event CrossChainDispatchRetried(address indexed account, uint256 tokenId, uint256 destinationChainId);

    /// @notice Emitted when the module admin address changes
    event AdminUpdated(address indexed previousAdmin, address indexed newAdmin);

    /// @notice Emitted when a cross-chain dispatch succeeds from the module layer
    event CrossChainDispatchSucceeded(
        address indexed account,
        uint256 indexed tokenId,
        uint256 indexed destinationChainId,
        bytes32 messageId,
        uint8 routeUsed
    );

    /// @notice Emitted when a cross-chain dispatch fails
    event CrossChainDispatchFailed(
        address indexed account,
        uint256 destinationChainId
    );

    /// @notice Emitted when a live account state is imported during migration
    event AccountStateImported(
        address indexed account,
        uint256 indexed planId,
        uint64 lastPullTime
    );

    /// @notice Emitted when migration imports are permanently finalized
    event MigrationFinalized();

    // ============================================================
    //                     CORE FUNCTIONS
    // ============================================================

    /// @notice Executes a billing pull on the smart account
    /// @param account The smart account address to pull from
    /// @param amount The amount to pull (must be <= maxAmount)
    function execute(address account, uint256 amount) external;

    /// @notice Returns the autopay configuration for an account
    /// @param account The smart account address
    /// @return config The autopay configuration
    function getConfig(address account) external view returns (AutopayConfig memory config);

    /// @notice Updates the autopay configuration for an already initialized account
    /// @param config The new autopay configuration
    function updateConfig(AutopayConfig calldata config) external;

    /// @notice Returns the timestamp of the last successful pull
    /// @param account The smart account address
    /// @return The last pull timestamp
    function lastPullTime(address account) external view returns (uint64);

    /// @notice Checks if a pull is currently allowed (interval elapsed)
    /// @param account The smart account address
    /// @return True if a pull can be executed
    function canExecute(address account) external view returns (bool);

    /// @notice Allows the smart account to pause its own autopay
    function pauseAccount() external;

    /// @notice Allows the smart account to unpause its own autopay
    function unpauseAccount() external;

    /// @notice Returns total amount pulled for an account
    function totalPulled(address account) external view returns (uint256);

    /// @notice Returns the configured mirror destination chain ID for an account
    function mirrorDestinationChainId(address account) external view returns (uint256);

    /// @notice Returns whether an account has paused its autopay
    function isAccountPaused(address account) external view returns (bool);

    /// @notice Imports a live account state during a one-time migration window
    function importAccountState(
        address account,
        AutopayConfig calldata config,
        uint64 lastPullTime_,
        uint256 totalPulled_,
        uint256 mirrorDestinationChainId_,
        bool accountPaused_
    ) external;

    /// @notice Permanently disables migration imports
    function finalizeMigration() external;
}
