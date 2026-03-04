// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IERC7579AutopayModule.sol";
import "../interfaces/IPlanFactory.sol";
import "../interfaces/ISubscriptionRegistry.sol";
import "../interfaces/IFeeCollector.sol";

/// @title ERC7579AutopayModule
/// @notice Automated recurring billing module for ERC-7579 smart accounts
/// @dev Implements the Executor module type (typeId = 2)
contract ERC7579AutopayModule is IERC7579AutopayModule, ReentrancyGuard {
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

    /// @notice Reference to PlanFactory
    IPlanFactory public immutable planFactory;

    /// @notice Reference to SubscriptionRegistry
    ISubscriptionRegistry public immutable subscriptionRegistry;

    /// @notice Reference to FeeCollector
    IFeeCollector public immutable feeCollector;

    /// @notice Account address => autopay configuration
    mapping(address => AutopayConfig) private _configs;

    /// @notice Account address => last successful pull timestamp
    mapping(address => uint64) private _lastPullTimes;

    /// @notice Account address => initialization status
    mapping(address => bool) private _initialized;

    /// @notice Destination chain ID for cross-chain GMP mirror updates (0 = disabled)
    uint256 private _mirrorDestinationChainId;

    /// @notice Emitted when cross-chain dispatch fails (non-reverting)
    event CrossChainDispatchFailed(address indexed account, uint256 destinationChainId);

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    constructor(
        address _planFactory,
        address _subscriptionRegistry,
        address _feeCollector
    ) {
        require(_planFactory != address(0), "AutopayModule: zero PlanFactory");
        require(_subscriptionRegistry != address(0), "AutopayModule: zero Registry");
        require(_feeCollector != address(0), "AutopayModule: zero FeeCollector");

        planFactory = IPlanFactory(_planFactory);
        subscriptionRegistry = ISubscriptionRegistry(_subscriptionRegistry);
        feeCollector = IFeeCollector(_feeCollector);
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
        _validateConfig(config);

        // Store config
        _configs[msg.sender] = config;
        _initialized[msg.sender] = true;

        emit AutopayConfigured(
            msg.sender,
            config.merchant,
            config.maxAmount,
            config.token,
            config.interval
        );
    }

    /// @inheritdoc IERC7579Module
    function onUninstall(bytes calldata) external {
        require(_initialized[msg.sender], "AutopayModule: not initialized");

        delete _configs[msg.sender];
        delete _lastPullTimes[msg.sender];
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
    function execute(address account, uint256 amount) external nonReentrant {
        require(_initialized[account], "AutopayModule: not initialized");

        AutopayConfig storage config = _configs[account];

        // Verify caller is the authorized merchant
        require(msg.sender == config.merchant, "AutopayModule: not merchant");

        // Verify amount is within limits
        require(amount > 0 && amount <= config.maxAmount, "AutopayModule: amount out of range");

        // Verify interval has elapsed (velocity limit)
        uint64 lastPull = _lastPullTimes[account];
        if (lastPull != 0) {
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

        // Calculate protocol fee
        uint256 protocolFee = feeCollector.collectSubscriptionFee(amount);
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

        // Dispatch cross-chain GMP update to MirrorRegistry if destination is configured
        if (_mirrorDestinationChainId != 0) {
            if (tokenId != 0) {
                try subscriptionRegistry.dispatchCrossChainUpdate{value: 0}(
                    tokenId,
                    _mirrorDestinationChainId,
                    config.merchant
                ) {} catch {
                    // GMP dispatch failure should not revert the payment
                    emit CrossChainDispatchFailed(account, _mirrorDestinationChainId);
                }
            }
        }
    }

    /// @notice Sets the destination chain ID for cross-chain mirror updates
    /// @param chainId The destination chain ID (0 to disable)
    function setMirrorDestination(uint256 chainId) external {
        require(_initialized[msg.sender], "AutopayModule: not initialized");
        _mirrorDestinationChainId = chainId;
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

        AutopayConfig storage config = _configs[account];
        uint64 lastPull = _lastPullTimes[account];

        if (lastPull == 0) {
            return block.timestamp >= config.startTime;
        }

        return block.timestamp >= lastPull + config.interval;
    }

    // ============================================================
    //                    INTERNAL FUNCTIONS
    // ============================================================

    function _validateConfig(AutopayConfig memory config) internal view {
        require(config.merchant != address(0), "AutopayModule: zero merchant");
        require(config.maxAmount > 0, "AutopayModule: zero maxAmount");
        require(config.token != address(0), "AutopayModule: zero token");
        require(config.interval >= MIN_INTERVAL, "AutopayModule: interval too short");
        require(config.startTime >= block.timestamp, "AutopayModule: start in past");

        // Verify plan exists and is active
        IPlanFactory.Plan memory plan = planFactory.getPlan(config.planId);
        require(plan.active, "AutopayModule: plan inactive");
        require(plan.provider == config.merchant, "AutopayModule: merchant mismatch");
        require(config.maxAmount <= plan.price, "AutopayModule: amount exceeds plan price");
    }

    function _getOrMintToken(address account, uint256 planId) internal returns (uint256 tokenId, bool mintedNow) {
        uint256 walletToken = subscriptionRegistry.getWalletSubscription(account);
        if (walletToken != 0) {
            (uint256 tokenPlanId,) = subscriptionRegistry.getPlanFeatures(walletToken);
            if (tokenPlanId == planId) {
                return (walletToken, false);
            }
        }

        tokenId = subscriptionRegistry.mint(account, planId, uint64(_configs[account].interval));
        return (tokenId, true);
    }
}
