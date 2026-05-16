// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IERC7579AutopayModule.sol";
import "../interfaces/IPlanFactory.sol";
import "../interfaces/ISubscriptionRegistry.sol";
import "../interfaces/IFeeCollector.sol";
import "../utils/UpgradeableReentrancyGuard.sol";

/// @title ERC7579AutopayModule
/// @notice Automated recurring billing module for ERC-7579 smart accounts
/// @dev Implements the Executor module type (typeId = 2)
contract ERC7579AutopayModule is
    Initializable,
    IERC7579AutopayModule,
    OwnableUpgradeable,
    UpgradeableReentrancyGuard,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============================================================
    //                         CONSTANTS
    // ============================================================

    /// @notice ERC-7579 module type: Executor = 2
    uint256 public constant MODULE_TYPE_EXECUTOR = 2;

    /// @notice Minimum billing interval: 30 days in seconds
    uint32 public constant MIN_INTERVAL = 2_592_000;

    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Admin address for global pause control
    address public admin;

    /// @notice Reference to PlanFactory
    IPlanFactory public planFactory;

    /// @notice Reference to SubscriptionRegistry
    ISubscriptionRegistry public subscriptionRegistry;

    /// @notice Reference to FeeCollector
    IFeeCollector public feeCollector;

    /// @notice Account address => autopay configuration
    mapping(address => AutopayConfig) private _configs;

    /// @notice Account address => last successful pull timestamp
    mapping(address => uint64) private _lastPullTimes;

    /// @notice Account address => whether the first successful pull has occurred
    mapping(address => bool) private _hasPulled;

    /// @notice Account address => initialization status
    mapping(address => bool) private _initialized;

    /// @notice Account address => destination chain ID for cross-chain mirror updates (0 = disabled)
    mapping(address => uint256) private _mirrorDestinationChainIds;

    /// @notice Account address => total amount pulled over lifetime of this config
    mapping(address => uint256) private _totalPulled;

    /// @notice Account address => paused by account owner
    mapping(address => bool) private _accountPaused;

    /// @notice Pending failed dispatch tracking
    struct PendingDispatch {
        uint256 tokenId;
        uint256 destinationChainId;
        address refundAddress;
        uint64 timestamp;
    }

    /// @notice Account => pending dispatch (stores latest failure per account)
    mapping(address => PendingDispatch) private _pendingDispatches;

    /// @notice Emitted when cross-chain dispatch fails (non-reverting)
    event CrossChainDispatchFailed(address indexed account, uint256 destinationChainId);

    /// @notice Emitted when an account state is imported during migration
    event AccountStateImported(address indexed account, uint256 indexed planId, uint64 lastPullTime);

    /// @notice Emitted when migration imports are permanently disabled
    event MigrationFinalized();

    bool public migrationEnabled;

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address initialOwner,
        address _planFactory,
        address _subscriptionRegistry,
        address _feeCollector,
        address _admin
    ) external initializer {
        __Ownable_init(initialOwner);
        __UpgradeableReentrancyGuard_init();
        __Pausable_init();

        require(_planFactory != address(0), "AutopayModule: zero PlanFactory");
        require(_subscriptionRegistry != address(0), "AutopayModule: zero Registry");
        require(_feeCollector != address(0), "AutopayModule: zero FeeCollector");
        require(_admin != address(0), "AutopayModule: zero admin");

        planFactory = IPlanFactory(_planFactory);
        subscriptionRegistry = ISubscriptionRegistry(_subscriptionRegistry);
        feeCollector = IFeeCollector(_feeCollector);
        admin = _admin;
        migrationEnabled = true;
    }

    function pause() external { require(msg.sender == admin, "AutopayModule: not admin"); _pause(); }
    function unpause() external { require(msg.sender == admin, "AutopayModule: not admin"); _unpause(); }

    modifier onlyAdmin() {
        require(msg.sender == admin, "AutopayModule: not admin");
        _;
    }

    function setAdmin(address newAdmin) external onlyOwner {
        require(newAdmin != address(0), "AutopayModule: zero admin");
        emit AdminUpdated(admin, newAdmin);
        admin = newAdmin;
    }

    // ============================================================
    //                  ERC-7579 MODULE INTERFACE
    // ============================================================

    /// @inheritdoc IERC7579Module
    function onInstall(bytes calldata data) external {
        require(!_initialized[msg.sender], "AutopayModule: already initialized");

        // Decode initialization data
        AutopayConfig memory config = abi.decode(data, (AutopayConfig));

        // Validate configuration
        _validateConfig(config, false);

        // Store config
        _configs[msg.sender] = config;
        _initialized[msg.sender] = true;
        _hasPulled[msg.sender] = false;

        emit AutopayConfigured(
            msg.sender,
            config.merchant,
            config.maxAmount,
            config.token,
            config.interval
        );
    }

    /// @inheritdoc IERC7579AutopayModule
    function updateConfig(AutopayConfig calldata config) external {
        require(_initialized[msg.sender], "AutopayModule: not initialized");

        AutopayConfig memory nextConfig = config;
        _validateConfig(nextConfig, true);

        AutopayConfig storage currentConfig = _configs[msg.sender];
        uint256 previousPlanId = currentConfig.planId;

        currentConfig.merchant = nextConfig.merchant;
        currentConfig.maxAmount = nextConfig.maxAmount;
        currentConfig.token = nextConfig.token;
        currentConfig.interval = nextConfig.interval;
        currentConfig.startTime = nextConfig.startTime;
        currentConfig.planId = nextConfig.planId;
        currentConfig.maxTotalAmount = nextConfig.maxTotalAmount;

        // A new config defines a new lifetime budget window.
        _totalPulled[msg.sender] = 0;

        emit AutopayConfigUpdated(
            msg.sender,
            previousPlanId,
            nextConfig.planId,
            nextConfig.maxAmount,
            nextConfig.interval
        );
    }

    /// @inheritdoc IERC7579Module
    function onUninstall(bytes calldata) external {
        require(_initialized[msg.sender], "AutopayModule: not initialized");

        delete _configs[msg.sender];
        delete _lastPullTimes[msg.sender];
        delete _hasPulled[msg.sender];
        delete _totalPulled[msg.sender];
        delete _accountPaused[msg.sender];
        delete _pendingDispatches[msg.sender];
        _initialized[msg.sender] = false;

        emit AutopayRevoked(msg.sender);
    }

    /// @inheritdoc IERC7579Module
    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR;
    }

    /// @inheritdoc IERC7579Module
    function isInitialized(address smartAccount) external view returns (bool) {
        return _initialized[smartAccount];
    }

    // ============================================================
    //                    BILLING EXECUTION
    // ============================================================

    /// @inheritdoc IERC7579AutopayModule
    function execute(address account, uint256 amount) external nonReentrant whenNotPaused {
        require(_initialized[account], "AutopayModule: not initialized");

        AutopayConfig storage config = _configs[account];
        IPlanFactory.Plan memory plan = _getCurrentPlan(config);

        // Verify caller is the authorized merchant
        require(msg.sender == config.merchant, "AutopayModule: not merchant");

        // Verify amount is within limits
        require(amount > 0 && amount <= config.maxAmount, "AutopayModule: amount out of range");
        require(amount <= plan.price, "AutopayModule: amount exceeds active plan price");

        // Per-account pause check
        require(!_accountPaused[account], "AutopayModule: account paused");

        // Lifetime total amount cap
        if (config.maxTotalAmount > 0) {
            require(
                _totalPulled[account] + amount <= config.maxTotalAmount,
                "AutopayModule: total amount exceeded"
            );
        }

        // Verify interval has elapsed (velocity limit)
        uint64 lastPull = _lastPullTimes[account];
        if (_hasPulled[account]) {
            require(
                block.timestamp >= lastPull + config.interval,
                "AutopayModule: interval not elapsed"
            );
        } else {
            // First pull — verify start time has been reached
            require(block.timestamp >= config.startTime, "AutopayModule: not started");
        }

        // Update last pull time BEFORE external calls (checks-effects-interactions)
        _lastPullTimes[account] = uint64(block.timestamp);
        _hasPulled[account] = true;
        _totalPulled[account] += amount;

        // Calculate protocol fee using provider-specific tier rate
        uint256 protocolFee = feeCollector.collectSubscriptionFeeFor(amount, config.merchant);
        uint256 merchantAmount = amount - protocolFee;

        // Execute token transfer from smart account
        // In production, this would be called via the smart account's execution framework
        // For MVP, we assume the smart account has approved this contract
        IERC20 token = IERC20(config.token);
        token.safeTransferFrom(account, config.merchant, merchantAmount);

        // Transfer protocol fee
        if (protocolFee > 0) {
            token.safeTransferFrom(account, address(feeCollector), protocolFee);
            // Notify fee collector
            IFeeCollector(feeCollector).receiveFee(config.token, protocolFee);
        }

        (uint256 tokenId, bool mintedNow) = _getOrMintToken(account, config.planId);
        if (!mintedNow) {
            subscriptionRegistry.renew(tokenId, uint64(config.interval));
        }

        emit PaymentExecuted(account, config.merchant, amount, block.timestamp);
        emit BillingExecuted(
            account,
            config.merchant,
            tokenId,
            config.planId,
            mintedNow ? BillingReason.ACTIVATION : BillingReason.RENEWAL,
            amount,
            merchantAmount,
            protocolFee,
            block.timestamp
        );

        // Dispatch cross-chain GMP update to MirrorRegistry if destination is configured
        uint256 destinationChainId = _mirrorDestinationChainIds[account];
        if (destinationChainId != 0) {
            if (tokenId != 0) {
                try subscriptionRegistry.dispatchCrossChainUpdate{value: 0}(
                    tokenId,
                    destinationChainId,
                    account
                ) returns (bytes32 messageId, uint8 routeUsed) {
                    // Success — clear any pending dispatch
                    delete _pendingDispatches[account];
                    emit CrossChainDispatchSucceeded(
                        account,
                        tokenId,
                        destinationChainId,
                        messageId,
                        routeUsed
                    );
                } catch {
                    // GMP dispatch failure should not revert the payment, but track for retry
                    _pendingDispatches[account] = PendingDispatch({
                        tokenId: tokenId,
                        destinationChainId: destinationChainId,
                        refundAddress: account,
                        timestamp: uint64(block.timestamp)
                    });
                    emit CrossChainDispatchFailed(account, destinationChainId);
                }
            }
        }
    }

    /// @notice Sets the destination chain ID for cross-chain mirror updates
    /// @param chainId The destination chain ID (0 to disable)
    function setMirrorDestination(uint256 chainId) external {
        require(_initialized[msg.sender], "AutopayModule: not initialized");
        _mirrorDestinationChainIds[msg.sender] = chainId;
    }

    // ============================================================
    //                    QUERY FUNCTIONS
    // ============================================================

    /// @inheritdoc IERC7579AutopayModule
    function getConfig(address account) external view returns (AutopayConfig memory config) {
        require(_initialized[account], "AutopayModule: not initialized");
        return _configs[account];
    }

    /// @inheritdoc IERC7579AutopayModule
    function lastPullTime(address account) external view returns (uint64) {
        return _lastPullTimes[account];
    }

    /// @inheritdoc IERC7579AutopayModule
    function canExecute(address account) external view returns (bool) {
        if (!_initialized[account]) return false;
        if (paused() || _accountPaused[account]) return false;

        AutopayConfig storage config = _configs[account];
        IPlanFactory.Plan memory plan = _getCurrentPlan(config);
        if (!plan.active || plan.provider != config.merchant || plan.acceptedToken != config.token) {
            return false;
        }
        uint64 lastPull = _lastPullTimes[account];

        if (!_hasPulled[account]) {
            return block.timestamp >= config.startTime;
        }

        return block.timestamp >= lastPull + config.interval;
    }

    // ============================================================
    //                  ACCOUNT PAUSE CONTROLS
    // ============================================================

    /// @inheritdoc IERC7579AutopayModule
    function pauseAccount() external {
        require(_initialized[msg.sender], "AutopayModule: not initialized");
        _accountPaused[msg.sender] = true;
        emit AccountAutopayPaused(msg.sender);
    }

    /// @inheritdoc IERC7579AutopayModule
    function unpauseAccount() external {
        require(_initialized[msg.sender], "AutopayModule: not initialized");
        _accountPaused[msg.sender] = false;
        emit AccountAutopayUnpaused(msg.sender);
    }

    /// @inheritdoc IERC7579AutopayModule
    function totalPulled(address account) external view returns (uint256) {
        return _totalPulled[account];
    }

    /// @inheritdoc IERC7579AutopayModule
    function mirrorDestinationChainId(address account) external view returns (uint256) {
        return _mirrorDestinationChainIds[account];
    }

    /// @inheritdoc IERC7579AutopayModule
    function isAccountPaused(address account) external view returns (bool) {
        return _accountPaused[account];
    }

    /// @inheritdoc IERC7579AutopayModule
    function importAccountState(
        address account,
        AutopayConfig calldata config,
        uint64 lastPullTime_,
        uint256 totalPulled_,
        uint256 mirrorDestinationChainId_,
        bool accountPaused_
    ) external onlyAdmin whenNotPaused {
        require(migrationEnabled, "AutopayModule: migration closed");
        require(account != address(0), "AutopayModule: zero account");
        require(!_initialized[account], "AutopayModule: already initialized");
        require(lastPullTime_ <= block.timestamp, "AutopayModule: future last pull");

        AutopayConfig memory importedConfig = config;
        _validateConfig(importedConfig, true);
        if (importedConfig.maxTotalAmount > 0) {
            require(
                totalPulled_ <= importedConfig.maxTotalAmount,
                "AutopayModule: imported total exceeds max"
            );
        }
        if (totalPulled_ > 0) {
            require(lastPullTime_ != 0, "AutopayModule: missing pull timestamp");
        }

        _configs[account] = importedConfig;
        _lastPullTimes[account] = lastPullTime_;
        _hasPulled[account] = lastPullTime_ != 0;
        _totalPulled[account] = totalPulled_;
        _mirrorDestinationChainIds[account] = mirrorDestinationChainId_;
        _accountPaused[account] = accountPaused_;
        _initialized[account] = true;

        emit AccountStateImported(account, importedConfig.planId, lastPullTime_);
    }

    /// @inheritdoc IERC7579AutopayModule
    function finalizeMigration() external onlyAdmin {
        require(migrationEnabled, "AutopayModule: migration closed");
        migrationEnabled = false;
        emit MigrationFinalized();
    }

    // ============================================================
    //                   DISPATCH RETRY
    // ============================================================

    /// @notice Retries a previously failed cross-chain dispatch
    /// @param account The account whose dispatch failed
    function retryDispatch(address account) external nonReentrant {
        require(_initialized[account], "AutopayModule: not initialized");
        AutopayConfig storage config = _configs[account];
        require(
            msg.sender == account ||
            msg.sender == config.merchant ||
            msg.sender == admin ||
            msg.sender == owner(),
            "AutopayModule: unauthorized retry"
        );
        PendingDispatch storage pending = _pendingDispatches[account];
        require(pending.timestamp != 0, "AutopayModule: no pending dispatch");

        uint256 tokenId = pending.tokenId;
        uint256 destChainId = pending.destinationChainId;
        address refundAddress = pending.refundAddress;

        // Clear before external call (CEI pattern)
        delete _pendingDispatches[account];

        // Attempt dispatch — reverts on failure so caller knows
        (bytes32 messageId, uint8 routeUsed) = subscriptionRegistry.dispatchCrossChainUpdate{value: 0}(
            tokenId,
            destChainId,
            refundAddress
        );

        emit CrossChainDispatchSucceeded(account, tokenId, destChainId, messageId, routeUsed);
        emit CrossChainDispatchRetried(account, tokenId, destChainId);
    }

    /// @notice Returns the pending dispatch for an account (if any)
    function getPendingDispatch(address account) external view returns (
        uint256 tokenId,
        uint256 destinationChainId,
        address refundAddress,
        uint64 timestamp
    ) {
        PendingDispatch storage p = _pendingDispatches[account];
        return (p.tokenId, p.destinationChainId, p.refundAddress, p.timestamp);
    }

    // ============================================================
    //                    INTERNAL FUNCTIONS
    // ============================================================

    function _validateConfig(AutopayConfig memory config, bool allowPastStartTime) internal view {
        require(config.merchant != address(0), "AutopayModule: zero merchant");
        require(config.maxAmount > 0, "AutopayModule: zero maxAmount");
        require(config.token != address(0), "AutopayModule: zero token");
        require(config.interval >= MIN_INTERVAL, "AutopayModule: interval too short");
        if (!allowPastStartTime) {
            require(config.startTime >= block.timestamp, "AutopayModule: start in past");
        }

        // Verify plan exists and is active
        IPlanFactory.Plan memory plan = _getCurrentPlan(config);
        require(config.maxAmount <= plan.price, "AutopayModule: amount exceeds plan price");

        // If maxTotalAmount is set, it must allow at least one pull
        if (config.maxTotalAmount > 0) {
            require(config.maxTotalAmount >= config.maxAmount, "AutopayModule: maxTotal < maxAmount");
        }
    }

    function _getOrMintToken(address account, uint256 planId) internal returns (uint256 tokenId, bool mintedNow) {
        uint256 walletToken = subscriptionRegistry.getWalletSubscription(account);
        if (walletToken != 0) {
            uint256 tokenPlanId = subscriptionRegistry.getPlanId(walletToken);
            if (tokenPlanId == planId) {
                return (walletToken, false);
            }

            subscriptionRegistry.changePlan(walletToken, planId);
            return (walletToken, false);
        }

        tokenId = subscriptionRegistry.mint(account, planId, uint64(_configs[account].interval));
        return (tokenId, true);
    }

    function _getCurrentPlan(AutopayConfig memory config) internal view returns (IPlanFactory.Plan memory plan) {
        plan = planFactory.getPlan(config.planId);
        require(plan.active, "AutopayModule: plan inactive");
        require(plan.provider == config.merchant, "AutopayModule: merchant mismatch");
        require(plan.acceptedToken == config.token, "AutopayModule: token mismatch");
    }

    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        (newImplementation);
    }
}
