// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/IFeeCollector.sol";

/// @title FeeCollector
/// @notice Protocol fee collection and distribution
/// @dev Collects 0.5% on subscriptions and 0.3% on ZKVUB settlements
contract FeeCollector is IFeeCollector, Ownable, ReentrancyGuard {
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

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    constructor(address _treasury) Ownable(msg.sender) {
        require(_treasury != address(0), "FeeCollector: zero treasury");
        treasury = _treasury;
    }

    // ============================================================
    //                       MODIFIERS
    // ============================================================

    modifier onlyAuthorized() {
        require(authorizedCollectors[msg.sender] || msg.sender == owner(), "FeeCollector: unauthorized");
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
        authorizedCollectors[collector] = true;
    }

    /// @notice Revokes a collector's authorization
    function revokeCollector(address collector) external onlyOwner {
        authorizedCollectors[collector] = false;
    }

    // ============================================================
    //                    FEE COLLECTION
    // ============================================================

    /// @inheritdoc IFeeCollector
    function collectSubscriptionFee(uint256 amount) external onlyAuthorized returns (uint256 feeAmount) {
        feeAmount = (amount * SUBSCRIPTION_FEE_BPS) / BPS_DENOMINATOR;
        // Fee is tracked internally; actual transfer happens in the billing flow
        // The billing contract should transfer the fee amount to this contract
        emit FeeCollected(msg.sender, amount, feeAmount, "subscription");
        return feeAmount;
    }

    /// @inheritdoc IFeeCollector
    function collectSettlementFee(uint256 amount) external onlyAuthorized returns (uint256 feeAmount) {
        feeAmount = (amount * SETTLEMENT_FEE_BPS) / BPS_DENOMINATOR;
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
}
