// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IFeeCollector.sol";
import "../utils/UpgradeableReentrancyGuard.sol";

/// @title FeeCollector
/// @notice Protocol fee collection and distribution
/// @dev Collects 0.5% on subscriptions and 0.3% on ZKVUB settlements
contract FeeCollector is
    Initializable,
    IFeeCollector,
    OwnableUpgradeable,
    UpgradeableReentrancyGuard,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============================================================
    //                         CONSTANTS
    // ============================================================

    /// @notice Subscription fee rate: 50 basis points = 0.5%
    uint256 public constant SUBSCRIPTION_FEE_BPS = 50;

    /// @notice ZKVUB settlement fee rate: 30 basis points = 0.3%
    uint256 public constant SETTLEMENT_FEE_BPS = 30;

    /// @notice Basis points denominator
    uint256 public constant BPS_DENOMINATOR = 10_000;

    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Protocol treasury address
    address public treasury;

    /// @notice Accumulated fees per token
    mapping(address => uint256) private _accumulatedFees;

    /// @notice Authorized fee collectors (billing contracts)
    mapping(address => bool) public authorizedCollectors;

    /// @notice Per-provider subscription fee overrides (0 = use default)
    mapping(address => uint256) private _providerSubFeeOverrides;

    /// @notice Per-provider settlement fee overrides (0 = use default)
    mapping(address => uint256) private _providerSettleFeeOverrides;

    /// @notice Platform tier identifiers for fee mapping
    uint8 public constant TIER_FREE = 0;
    uint8 public constant TIER_PLUS = 1;
    uint8 public constant TIER_PRO  = 2;

    /// @notice Default fee rates per platform tier (subscription bps)
    /// FREE = 200 (2.0%), PLUS = 100 (1.0%), PRO = 50 (0.5%)
    mapping(uint8 => uint256) public tierSubFeeBps;
    mapping(uint8 => uint256) public tierSettleFeeBps;

    // Events ProviderFeeRateSet and ProviderTierSynced are inherited from IFeeCollector

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address _treasury) external initializer {
        __Ownable_init(initialOwner);
        __UpgradeableReentrancyGuard_init();

        require(_treasury != address(0), "FeeCollector: zero treasury");
        treasury = _treasury;

        // Initialize default tier fee rates
        tierSubFeeBps[TIER_FREE] = 200;   // 2.0%
        tierSubFeeBps[TIER_PLUS] = 100;   // 1.0%
        tierSubFeeBps[TIER_PRO]  = 50;    // 0.5%

        tierSettleFeeBps[TIER_FREE] = 100; // 1.0%
        tierSettleFeeBps[TIER_PLUS] = 50;  // 0.5%
        tierSettleFeeBps[TIER_PRO]  = 30;  // 0.3%
    }

    // ============================================================
    //                       MODIFIERS
    // ============================================================

    modifier onlyAuthorized() {
        require(
            authorizedCollectors[msg.sender] || msg.sender == owner(),
            "FeeCollector: unauthorized"
        );
        _;
    }

    // ============================================================
    //                      ADMIN FUNCTIONS
    // ============================================================

    /// @notice Updates the treasury address
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "FeeCollector: zero treasury");
        treasury = _treasury;
    }

    /// @notice Authorizes a contract to collect fees
    function authorizeCollector(address collector) external onlyOwner {
        require(collector != address(0), "FeeCollector: zero collector");
        authorizedCollectors[collector] = true;
    }

    /// @notice Revokes a collector's authorization
    function revokeCollector(address collector) external onlyOwner {
        authorizedCollectors[collector] = false;
    }

    /// @notice Sets fee rate overrides for a specific provider (tier-based)
    /// @param provider The provider wallet address
    /// @param subFeeBps Subscription fee in basis points (0 = use default, max 1000 = 10%)
    /// @param settleFeeBps Settlement fee in basis points (0 = use default, max 1000 = 10%)
    function setProviderFeeRates(
        address provider,
        uint256 subFeeBps,
        uint256 settleFeeBps
    ) external onlyOwner {
        require(provider != address(0), "FeeCollector: zero provider");
        require(subFeeBps <= 1000, "FeeCollector: sub fee > 10%");
        require(settleFeeBps <= 1000, "FeeCollector: settle fee > 10%");
        _providerSubFeeOverrides[provider] = subFeeBps;
        _providerSettleFeeOverrides[provider] = settleFeeBps;
        emit ProviderFeeRateSet(provider, subFeeBps, settleFeeBps);
    }

    /// @notice Returns the effective subscription fee rate for a provider
    /// @param provider The provider wallet address
    /// @return The fee rate in basis points
    function getProviderSubFeeBps(
        address provider
    ) public view returns (uint256) {
        uint256 override_ = _providerSubFeeOverrides[provider];
        return override_ > 0 ? override_ : SUBSCRIPTION_FEE_BPS;
    }

    /// @notice Returns the effective settlement fee rate for a provider
    /// @param provider The provider wallet address
    /// @return The fee rate in basis points
    function getProviderSettleFeeBps(
        address provider
    ) public view returns (uint256) {
        uint256 override_ = _providerSettleFeeOverrides[provider];
        return override_ > 0 ? override_ : SETTLEMENT_FEE_BPS;
    }

    /// @notice Updates the default fee rates for a platform tier
    /// @param tier The tier (0=FREE, 1=PLUS, 2=PRO)
    /// @param subFeeBps Subscription fee in basis points
    /// @param settleFeeBps Settlement fee in basis points
    function setTierFeeRates(
        uint8 tier,
        uint256 subFeeBps,
        uint256 settleFeeBps
    ) external onlyOwner {
        require(tier <= TIER_PRO, "FeeCollector: invalid tier");
        require(subFeeBps <= 1000, "FeeCollector: sub fee > 10%");
        require(settleFeeBps <= 1000, "FeeCollector: settle fee > 10%");
        tierSubFeeBps[tier] = subFeeBps;
        tierSettleFeeBps[tier] = settleFeeBps;
    }

    /// @notice Syncs a provider's fee rates based on their platform tier.
    ///         Called by the platform backend when a provider upgrades/downgrades.
    /// @param provider The provider wallet address
    /// @param tier The platform tier (0=FREE, 1=PLUS, 2=PRO)
    function syncProviderTier(
        address provider,
        uint8 tier
    ) external onlyOwner {
        require(provider != address(0), "FeeCollector: zero provider");
        require(tier <= TIER_PRO, "FeeCollector: invalid tier");

        uint256 subFee = tierSubFeeBps[tier];
        uint256 settleFee = tierSettleFeeBps[tier];

        _providerSubFeeOverrides[provider] = subFee;
        _providerSettleFeeOverrides[provider] = settleFee;

        emit ProviderTierSynced(provider, tier, subFee, settleFee);
    }

    // ============================================================
    //                    FEE COLLECTION
    // ============================================================

    /// @inheritdoc IFeeCollector
    function collectSubscriptionFee(
        uint256 amount
    ) external onlyAuthorized returns (uint256 feeAmount) {
        feeAmount = (amount * SUBSCRIPTION_FEE_BPS) / BPS_DENOMINATOR;
        emit FeeCollected(msg.sender, amount, feeAmount, "subscription");
        return feeAmount;
    }

    /// @notice Collects subscription fee using the provider-specific rate override
    /// @param amount The total transaction amount
    /// @param provider The provider whose rate to use
    /// @return feeAmount The fee amount collected
    function collectSubscriptionFeeFor(
        uint256 amount,
        address provider
    ) external onlyAuthorized returns (uint256 feeAmount) {
        uint256 feeBps = getProviderSubFeeBps(provider);
        feeAmount = (amount * feeBps) / BPS_DENOMINATOR;
        emit FeeCollected(msg.sender, amount, feeAmount, "subscription");
        return feeAmount;
    }

    /// @inheritdoc IFeeCollector
    function collectSettlementFee(
        uint256 amount
    ) external onlyAuthorized returns (uint256 feeAmount) {
        feeAmount = (amount * SETTLEMENT_FEE_BPS) / BPS_DENOMINATOR;
        emit FeeCollected(msg.sender, amount, feeAmount, "settlement");
        return feeAmount;
    }

    /// @notice Collects settlement fee using the provider-specific rate override
    /// @param amount The total settlement amount
    /// @param provider The provider whose rate to use
    /// @return feeAmount The fee amount collected
    function collectSettlementFeeFor(
        uint256 amount,
        address provider
    ) external onlyAuthorized returns (uint256 feeAmount) {
        uint256 feeBps = getProviderSettleFeeBps(provider);
        feeAmount = (amount * feeBps) / BPS_DENOMINATOR;
        emit FeeCollected(msg.sender, amount, feeAmount, "settlement");
        return feeAmount;
    }

    /// @notice Receives fee tokens (called by billing contracts after transfer)
    function receiveFee(address token, uint256 amount) external onlyAuthorized {
        _accumulatedFees[token] += amount;
    }

    /// @inheritdoc IFeeCollector
    function subscriptionFeeRate() external pure returns (uint256) {
        return SUBSCRIPTION_FEE_BPS;
    }

    /// @inheritdoc IFeeCollector
    function settlementFeeRate() external pure returns (uint256) {
        return SETTLEMENT_FEE_BPS;
    }

    /// @inheritdoc IFeeCollector
    function accumulatedFees(address token) external view returns (uint256) {
        return _accumulatedFees[token];
    }

    /// @inheritdoc IFeeCollector
    function withdrawFees(address token) external onlyOwner nonReentrant {
        uint256 balance = _accumulatedFees[token];
        require(balance > 0, "FeeCollector: no fees");

        _accumulatedFees[token] = 0;
        IERC20(token).safeTransfer(treasury, balance);

        emit FeesWithdrawn(treasury, balance);
    }

    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        (newImplementation);
    }
}
