// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title YieldSessionVault
/// @notice Optional experimental extension. Not part of the default deployed core runtime.
/// @notice ERC4626-compatible yield-bearing session vault
/// @dev Wraps the base SessionVault pattern with ERC4626 vault shares.
///   Idle session deposits earn yield from a configurable strategy
///   (e.g., Aave aUSDC, Compound cUSDC). Settlement draws from the vault,
///   and yield accrues proportionally to all depositors.
///
///   Architecture:
///   - Agents deposit USDC → receive vault shares (arcenUSDC)
///   - Idle USDC is deployed to yield strategy
///   - Settlement draws from vault reserves (no share burn)
///   - Agents withdraw shares → receive USDC + proportional yield
contract YieldSessionVault is ERC4626, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================
    //                          STRUCTS
    // ============================================================

    struct SessionAllocation {
        address agent;          // Session owner
        uint256 shares;          // Shares allocated to this session
        uint256 depositedAssets; // Original USDC deposited
        bool active;
        uint64 createdAt;
    }

    // ============================================================
    //                          EVENTS
    // ============================================================

    event SessionCreated(address indexed agent, bytes32 indexed sessionId, uint256 shares, uint256 assets);
    event SessionSettled(bytes32 indexed sessionId, uint256 amount, address provider);
    event SessionClosed(bytes32 indexed sessionId, uint256 sharesRedeemed, uint256 assetsReturned);
    event StrategyUpdated(address indexed oldStrategy, address indexed newStrategy);
    event StrategyAssetsDeployed(uint256 amount, uint256 totalDeployed);
    event StrategyAssetsWithdrawn(uint256 amount, uint256 realizedYield, uint256 totalDeployed);
    event YieldHarvested(uint256 amount);

    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Session allocations
    mapping(bytes32 => SessionAllocation) private _sessions;

    /// @notice Agent => session IDs
    mapping(address => bytes32[]) private _agentSessions;

    /// @notice Authorized settlement contracts
    mapping(address => bool) public authorizedSettlers;

    /// @notice Yield strategy contract (Aave, Compound, etc.)
    address public yieldStrategy;

    /// @notice Total assets deployed to yield strategy
    uint256 public deployedToStrategy;

    /// @notice Session nonce
    uint256 private _sessionNonce;

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    /// @param asset_ The underlying stablecoin (e.g., USDC)
    constructor(
        IERC20 asset_
    ) ERC4626(asset_) ERC20("ArcenPay Yield Session", "arcenUSDC") Ownable(msg.sender) {}

    // ============================================================
    //                      ADMIN FUNCTIONS
    // ============================================================

    /// @notice Authorize a settlement contract
    function authorizeSettler(address settler) external onlyOwner {
        authorizedSettlers[settler] = true;
    }

    /// @notice Revoke settler authorization
    function revokeSettler(address settler) external onlyOwner {
        authorizedSettlers[settler] = false;
    }

    /// @notice Set the yield strategy contract
    function setYieldStrategy(address strategy) external onlyOwner {
        require(strategy != address(0), "YieldVault: zero strategy");
        address old = yieldStrategy;
        yieldStrategy = strategy;
        emit StrategyUpdated(old, strategy);
    }

    /// @notice Clears the configured yield strategy after all assets are withdrawn
    function clearYieldStrategy() external onlyOwner {
        require(deployedToStrategy == 0, "YieldVault: strategy still funded");
        address old = yieldStrategy;
        yieldStrategy = address(0);
        emit StrategyUpdated(old, address(0));
    }

    modifier onlySettler() {
        require(authorizedSettlers[msg.sender], "YieldVault: unauthorized settler");
        _;
    }

    // ============================================================
    //                  SESSION MANAGEMENT
    // ============================================================

    /// @notice Fund a new session — deposits USDC, mints vault shares
    /// @param amount The USDC amount to deposit
    /// @return sessionId The unique session identifier
    function fundSession(uint256 amount) external nonReentrant returns (bytes32 sessionId) {
        require(amount > 0, "YieldVault: zero amount");

        // Deposit through ERC4626 → mints shares to this contract
        uint256 shares = deposit(amount, address(this));

        // Generate session ID
        sessionId = keccak256(abi.encodePacked(
            msg.sender,
            amount,
            block.timestamp,
            _sessionNonce++
        ));

        require(_sessions[sessionId].createdAt == 0, "YieldVault: session exists");

        _sessions[sessionId] = SessionAllocation({
            agent: msg.sender,
            shares: shares,
            depositedAssets: amount,
            active: true,
            createdAt: uint64(block.timestamp)
        });

        _agentSessions[msg.sender].push(sessionId);

        emit SessionCreated(msg.sender, sessionId, shares, amount);
    }

    /// @notice Settle a session — transfers USDC to provider
    /// @param sessionId The session to settle from
    /// @param amount The USDC amount to settle
    /// @param provider The provider receiving payment
    function settle(
        bytes32 sessionId,
        uint256 amount,
        address provider
    ) external onlySettler nonReentrant {
        SessionAllocation storage session = _sessions[sessionId];
        require(session.active, "YieldVault: session not active");
        require(amount > 0, "YieldVault: zero amount");
        require(provider != address(0), "YieldVault: zero provider");

        // Burn enough shares to withdraw the requested amount, rounding up when needed.
        uint256 sharesToBurn = previewWithdraw(amount);
        require(session.shares >= sharesToBurn, "YieldVault: insufficient session balance");

        session.shares -= sharesToBurn;

        // Withdraw the exact requested assets to the provider.
        withdraw(amount, provider, address(this));

        emit SessionSettled(sessionId, amount, provider);
    }

    /// @notice Close a session — returns remaining USDC + yield to agent
    /// @param sessionId The session to close
    /// @param agent The agent who owns the session
    function closeSession(bytes32 sessionId, address agent) external nonReentrant {
        SessionAllocation storage session = _sessions[sessionId];
        require(session.active, "YieldVault: session not active");
        require(session.agent == agent, "YieldVault: agent mismatch");
        // Only agent or settler can close
        require(
            msg.sender == session.agent || authorizedSettlers[msg.sender],
            "YieldVault: unauthorized"
        );

        uint256 remainingShares = session.shares;
        session.shares = 0;
        session.active = false;

        uint256 assetsReturned = 0;
        if (remainingShares > 0) {
            assetsReturned = redeem(remainingShares, agent, address(this));
        }

        emit SessionClosed(sessionId, remainingShares, assetsReturned);
    }

    // ============================================================
    //                    YIELD MANAGEMENT
    // ============================================================

    /// @notice Deploy idle assets to yield strategy
    /// @param amount The amount to deploy
    function deployToStrategy(uint256 amount) external onlyOwner {
        require(yieldStrategy != address(0), "YieldVault: no strategy");
        require(amount > 0, "YieldVault: zero amount");

        IERC20 underlying = IERC20(asset());
        require(amount <= underlying.balanceOf(address(this)), "YieldVault: insufficient idle assets");
        underlying.safeTransfer(yieldStrategy, amount);
        deployedToStrategy += amount;
        emit StrategyAssetsDeployed(amount, deployedToStrategy);
    }

    /// @notice Withdraw assets from yield strategy
    /// @param amount The amount to withdraw
    function withdrawFromStrategy(uint256 amount) external onlyOwner {
        require(yieldStrategy != address(0), "YieldVault: no strategy");
        require(amount > 0, "YieldVault: zero amount");

        IERC20 underlying = IERC20(asset());
        underlying.safeTransferFrom(yieldStrategy, address(this), amount);

        uint256 realizedYield = 0;
        if (amount > deployedToStrategy) {
            // Yield earned — more came back than deployed
            realizedYield = amount - deployedToStrategy;
            deployedToStrategy = 0;
            emit YieldHarvested(realizedYield);
        } else {
            deployedToStrategy -= amount;
        }

        emit StrategyAssetsWithdrawn(amount, realizedYield, deployedToStrategy);
    }

    /// @notice ERC4626 total assets, including assets temporarily deployed to the strategy.
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + deployedToStrategy;
    }

    // ============================================================
    //                    QUERY FUNCTIONS
    // ============================================================

    /// @notice Get session balance in USDC terms (including yield)
    function getSessionBalance(bytes32 sessionId) external view returns (uint256) {
        SessionAllocation storage session = _sessions[sessionId];
        if (!session.active || session.shares == 0) return 0;
        return convertToAssets(session.shares);
    }

    /// @notice Get session details
    function getSession(bytes32 sessionId) external view returns (SessionAllocation memory) {
        return _sessions[sessionId];
    }

    /// @notice Get all sessions for an agent
    function getAgentSessions(address agent) external view returns (bytes32[] memory) {
        return _agentSessions[agent];
    }

    /// @notice Total assets under management (vault + strategy)
    function totalManagedAssets() external view returns (uint256) {
        return totalAssets();
    }
}
