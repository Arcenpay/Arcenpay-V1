// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SubscriptionCollateralModule
/// @notice Experimental/frozen contract. Preserved for future work and not part of the current launch runtime.
/// @notice Allows subscribers to borrow against active subscription NFTs
/// @dev Subscribers can lock their subscription NFT as collateral to borrow
///   stablecoins for subscription renewals or other purposes. The loan is
///   secured by the remaining subscription value and auto-repaid on renewal.
///
///   Liquidation: If subscription expires without repayment, the collateral
///   (subscription NFT) can be liquidated by the protocol.
contract SubscriptionCollateralModule is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================
    //                          STRUCTS
    // ============================================================

    struct LoanPosition {
        address borrower;
        uint256 tokenId;           // Subscription NFT token ID
        uint256 planId;            // Plan ID of the subscription
        uint256 collateralValue;   // Estimated value of the subscription
        uint256 borrowedAmount;    // Amount borrowed
        uint256 interestAccrued;   // Accumulated interest
        uint256 interestRateBps;   // Interest rate in basis points (annual)
        uint64 borrowedAt;         // Timestamp when loan was taken
        uint64 maturityAt;         // When the loan matures (subscription expiration)
        bool active;
        bool liquidated;
    }

    struct CollateralConfig {
        uint256 maxLtvBps;          // Maximum LTV ratio in basis points (e.g., 5000 = 50%)
        uint256 interestRateBps;    // Annual interest rate in bps
        uint256 liquidationBonusBps;// Bonus for liquidators in bps
        bool enabled;
    }

    // ============================================================
    //                          EVENTS
    // ============================================================

    event LoanCreated(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 tokenId,
        uint256 borrowedAmount,
        uint64 maturityAt
    );
    event LoanRepaid(uint256 indexed loanId, uint256 amount, uint256 interest);
    event LoanLiquidated(uint256 indexed loanId, address indexed liquidator, uint256 collateralSeized);
    event CollateralConfigSet(uint256 indexed planId, uint256 maxLtvBps, uint256 interestRateBps);

    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Loan positions by ID
    mapping(uint256 => LoanPosition) public loans;

    /// @notice Borrower => active loan IDs
    mapping(address => uint256[]) private _borrowerLoans;

    /// @notice Token ID => active loan ID (one loan per subscription)
    mapping(uint256 => uint256) public tokenLoans;

    /// @notice Plan ID => collateral configuration
    mapping(uint256 => CollateralConfig) public collateralConfigs;

    /// @notice Accepted stablecoin for borrowing
    IERC20 public stablecoin;

    /// @notice Reserve pool for lending
    uint256 public totalReserves;

    /// @notice Total outstanding loans
    uint256 public totalBorrowed;

    /// @notice Loan counter
    uint256 public nextLoanId;

    /// @notice Subscription registry address (for NFT ownership checks)
    address public subscriptionRegistry;

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    constructor(
        address _stablecoin,
        address _subscriptionRegistry
    ) Ownable(msg.sender) {
        require(_stablecoin != address(0), "Collateral: zero stablecoin");
        require(_subscriptionRegistry != address(0), "Collateral: zero registry");
        stablecoin = IERC20(_stablecoin);
        subscriptionRegistry = _subscriptionRegistry;
        nextLoanId = 1;
    }

    // ============================================================
    //                      ADMIN FUNCTIONS
    // ============================================================

    /// @notice Configure collateral parameters for a plan
    function setCollateralConfig(
        uint256 planId,
        uint256 maxLtvBps,
        uint256 interestRateBps,
        uint256 liquidationBonusBps
    ) external onlyOwner {
        require(maxLtvBps <= 8000, "Collateral: LTV > 80%");
        require(interestRateBps <= 5000, "Collateral: rate > 50%");

        collateralConfigs[planId] = CollateralConfig({
            maxLtvBps: maxLtvBps,
            interestRateBps: interestRateBps,
            liquidationBonusBps: liquidationBonusBps,
            enabled: true
        });

        emit CollateralConfigSet(planId, maxLtvBps, interestRateBps);
    }

    /// @notice Deposit stablecoins into the reserve pool
    function depositReserves(uint256 amount) external onlyOwner {
        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        totalReserves += amount;
    }

    /// @notice Withdraw excess reserves
    function withdrawReserves(uint256 amount) external onlyOwner {
        require(amount <= totalReserves - totalBorrowed, "Collateral: insufficient free reserves");
        totalReserves -= amount;
        stablecoin.safeTransfer(msg.sender, amount);
    }

    // ============================================================
    //                    BORROWING
    // ============================================================

    /// @notice Borrow against a subscription NFT
    /// @param tokenId The subscription NFT to collateralize
    /// @param planId The plan ID of the subscription
    /// @param amount The amount to borrow
    /// @param subscriptionExpiry When the subscription expires (collateral maturity)
    /// @param subscriptionValue The estimated value of the remaining subscription
    function borrow(
        uint256 tokenId,
        uint256 planId,
        uint256 amount,
        uint64 subscriptionExpiry,
        uint256 subscriptionValue
    ) external nonReentrant returns (uint256 loanId) {
        CollateralConfig storage config = collateralConfigs[planId];
        require(config.enabled, "Collateral: plan not enabled");
        require(tokenLoans[tokenId] == 0, "Collateral: token already collateralized");
        require(subscriptionExpiry > block.timestamp, "Collateral: expired subscription");
        require(amount > 0, "Collateral: zero amount");

        // Check LTV ratio
        uint256 maxBorrow = (subscriptionValue * config.maxLtvBps) / 10000;
        require(amount <= maxBorrow, "Collateral: exceeds max LTV");

        // Check reserve availability
        uint256 freeReserves = totalReserves - totalBorrowed;
        require(amount <= freeReserves, "Collateral: insufficient reserves");

        loanId = nextLoanId++;
        loans[loanId] = LoanPosition({
            borrower: msg.sender,
            tokenId: tokenId,
            planId: planId,
            collateralValue: subscriptionValue,
            borrowedAmount: amount,
            interestAccrued: 0,
            interestRateBps: config.interestRateBps,
            borrowedAt: uint64(block.timestamp),
            maturityAt: subscriptionExpiry,
            active: true,
            liquidated: false
        });

        tokenLoans[tokenId] = loanId;
        _borrowerLoans[msg.sender].push(loanId);
        totalBorrowed += amount;

        // Transfer stablecoin to borrower
        stablecoin.safeTransfer(msg.sender, amount);

        emit LoanCreated(loanId, msg.sender, tokenId, amount, subscriptionExpiry);
    }

    /// @notice Repay a loan (full or partial)
    /// @param loanId The loan to repay
    /// @param amount The repayment amount
    function repay(uint256 loanId, uint256 amount) external nonReentrant {
        LoanPosition storage loan = loans[loanId];
        require(loan.active, "Collateral: loan not active");
        require(amount > 0, "Collateral: zero repayment");

        // Calculate current interest
        uint256 interest = _calculateInterest(loan);
        uint256 totalOwed = loan.borrowedAmount + interest;

        uint256 repayAmount = amount > totalOwed ? totalOwed : amount;

        // Apply repayment: interest first, then principal
        if (repayAmount <= interest) {
            loan.interestAccrued = interest - repayAmount;
        } else {
            uint256 principalPayment = repayAmount - interest;
            loan.interestAccrued = 0;
            loan.borrowedAmount -= principalPayment;
            totalBorrowed -= principalPayment;
        }

        stablecoin.safeTransferFrom(msg.sender, address(this), repayAmount);

        // Close loan if fully repaid
        if (loan.borrowedAmount == 0) {
            loan.active = false;
            delete tokenLoans[loan.tokenId];
        }

        emit LoanRepaid(loanId, repayAmount, interest);
    }

    /// @notice Liquidate an expired/defaulted loan
    /// @param loanId The loan to liquidate
    function liquidate(uint256 loanId) external nonReentrant {
        LoanPosition storage loan = loans[loanId];
        require(loan.active, "Collateral: loan not active");
        require(
            block.timestamp > loan.maturityAt,
            "Collateral: loan not matured"
        );

        uint256 interest = _calculateInterest(loan);
        uint256 totalOwed = loan.borrowedAmount + interest;

        // Liquidation bonus
        CollateralConfig storage config = collateralConfigs[loan.planId];
        uint256 bonus = (totalOwed * config.liquidationBonusBps) / 10000;
        uint256 liquidationCost = totalOwed + bonus;

        // Liquidator pays the debt + bonus → receives the collateral right
        stablecoin.safeTransferFrom(msg.sender, address(this), liquidationCost);

        // Close loan
        loan.active = false;
        loan.liquidated = true;
        totalBorrowed -= loan.borrowedAmount;
        delete tokenLoans[loan.tokenId];

        emit LoanLiquidated(loanId, msg.sender, loan.collateralValue);
    }

    // ============================================================
    //                    QUERY FUNCTIONS
    // ============================================================

    /// @notice Get current amount owed on a loan
    function getAmountOwed(uint256 loanId) external view returns (uint256) {
        LoanPosition storage loan = loans[loanId];
        if (!loan.active) return 0;
        return loan.borrowedAmount + _calculateInterest(loan);
    }

    /// @notice Get all loans for a borrower
    function getBorrowerLoans(address borrower) external view returns (uint256[] memory) {
        return _borrowerLoans[borrower];
    }

    /// @notice Available reserves for lending
    function availableReserves() external view returns (uint256) {
        return totalReserves - totalBorrowed;
    }

    // ============================================================
    //                    INTERNAL FUNCTIONS
    // ============================================================

    /// @dev Calculate accrued interest using simple interest formula
    function _calculateInterest(LoanPosition storage loan) internal view returns (uint256) {
        if (!loan.active) return 0;
        uint256 elapsed = block.timestamp - loan.borrowedAt;
        // Simple interest: principal × rate × time / (365 days × 10000 bps)
        return (loan.borrowedAmount * loan.interestRateBps * elapsed) / (365 days * 10000);
    }
}
