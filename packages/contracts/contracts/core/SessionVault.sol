// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "../interfaces/ISessionVault.sol";
import "../utils/UpgradeableReentrancyGuard.sol";

/// @title SessionVault
/// @notice Pre-funded stablecoin balance vault for ZKVUB billing sessions
/// @dev Agents deposit stablecoins into sessions; verifier settles from session balance
contract SessionVault is
    Initializable,
    ISessionVault,
    OwnableUpgradeable,
    UpgradeableReentrancyGuard,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============================================================
    //                          STRUCTS
    // ============================================================

    struct Session {
        address agent;       // Session owner (agent wallet)
        address token;       // Stablecoin used
        uint256 balance;     // Remaining balance
        uint256 totalFunded; // Total amount deposited
        uint256 totalSettled;// Total amount settled
        bool active;         // Whether session is active
        uint64 createdAt;    // Creation timestamp
    }

    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Session storage by ID
    mapping(bytes32 => Session) private _sessions;

    /// @notice Agent address => array of session IDs
    mapping(address => bytes32[]) private _agentSessions;

    /// @notice Authorized settlement contracts (ZKUsageVerifier)
    mapping(address => bool) public authorizedSettlers;

    /// @notice Nonce for session ID generation
    uint256 private _sessionNonce;

    /// @notice Optional provider whitelist (address => authorized)
    mapping(address => bool) public whitelistedProviders;

    /// @notice Whether provider whitelist is active
    bool public providerWhitelistEnabled;

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner) external initializer {
        __Ownable_init(initialOwner);
        __UpgradeableReentrancyGuard_init();
        __Pausable_init();
    }

    // ============================================================
    //                       MODIFIERS
    // ============================================================

    modifier onlySettler() {
        require(authorizedSettlers[msg.sender], "SessionVault: unauthorized settler");
        _;
    }

    // ============================================================
    //                      ADMIN FUNCTIONS
    // ============================================================

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Authorizes a settlement contract
    function authorizeSettler(address settler) external onlyOwner {
        require(settler != address(0), "SessionVault: zero settler");
        authorizedSettlers[settler] = true;
    }

    /// @notice Revokes a settler's authorization
    function revokeSettler(address settler) external onlyOwner {
        authorizedSettlers[settler] = false;
    }

    /// @notice Enables/disables the provider whitelist
    function setProviderWhitelistEnabled(bool enabled) external onlyOwner {
        providerWhitelistEnabled = enabled;
    }

    /// @notice Adds a provider to the whitelist
    function whitelistProvider(address _provider) external onlyOwner {
        require(_provider != address(0), "SessionVault: zero provider");
        whitelistedProviders[_provider] = true;
    }

    /// @notice Removes a provider from the whitelist
    function removeProviderFromWhitelist(address _provider) external onlyOwner {
        whitelistedProviders[_provider] = false;
    }

    // ============================================================
    //                    SESSION MANAGEMENT
    // ============================================================

    /// @inheritdoc ISessionVault
    function fundSession(
        uint256 amount,
        address token
    ) external nonReentrant whenNotPaused returns (bytes32 sessionId) {
        require(amount > 0, "SessionVault: zero amount");
        require(token != address(0), "SessionVault: zero token");

        // Generate unique session ID (hardened with blockhash and contract address)
        sessionId = keccak256(abi.encodePacked(
            msg.sender,
            token,
            amount,
            block.timestamp,
            blockhash(block.number - 1),
            address(this),
            _sessionNonce++
        ));

        // Defense-in-depth: ensure no collision
        require(_sessions[sessionId].createdAt == 0, "SessionVault: session ID collision");

        // Transfer tokens from agent to vault
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Create session
        _sessions[sessionId] = Session({
            agent: msg.sender,
            token: token,
            balance: amount,
            totalFunded: amount,
            totalSettled: 0,
            active: true,
            createdAt: uint64(block.timestamp)
        });

        _agentSessions[msg.sender].push(sessionId);

        emit SessionFunded(msg.sender, sessionId, amount, token);
    }

    /// @notice Adds funds to an existing session
    /// @param sessionId The session to top up
    /// @param amount The amount to add
    function topUp(bytes32 sessionId, uint256 amount) external nonReentrant whenNotPaused {
        Session storage session = _sessions[sessionId];
        require(session.active, "SessionVault: session not active");
        require(session.agent == msg.sender, "SessionVault: not session owner");
        require(amount > 0, "SessionVault: zero amount");

        IERC20(session.token).safeTransferFrom(msg.sender, address(this), amount);

        session.balance += amount;
        session.totalFunded += amount;

        emit SessionFunded(msg.sender, sessionId, amount, session.token);
    }

    /// @inheritdoc ISessionVault
    function settle(bytes32 sessionId, uint256 amount, address provider) external onlySettler nonReentrant whenNotPaused {
        Session storage session = _sessions[sessionId];
        require(session.active, "SessionVault: session not active");
        require(amount > 0, "SessionVault: zero amount");
        require(session.balance >= amount, "SessionVault: insufficient balance");
        require(provider != address(0), "SessionVault: zero provider");

        if (providerWhitelistEnabled) {
            require(whitelistedProviders[provider], "SessionVault: provider not whitelisted");
        }

        session.balance -= amount;
        session.totalSettled += amount;

        // Transfer settlement to provider
        IERC20(session.token).safeTransfer(provider, amount);

        emit SessionSettled(sessionId, amount, provider);
    }

    /// @inheritdoc ISessionVault
    function withdraw(bytes32 sessionId) external nonReentrant {
        Session storage session = _sessions[sessionId];
        require(session.agent == msg.sender, "SessionVault: not session owner");
        require(session.active, "SessionVault: session not active");

        uint256 remaining = session.balance;
        require(remaining > 0, "SessionVault: no balance");

        session.balance = 0;
        session.active = false;

        IERC20(session.token).safeTransfer(msg.sender, remaining);

        emit SessionWithdrawn(sessionId, remaining, msg.sender);
    }

    /// @inheritdoc ISessionVault
    function getBalance(bytes32 sessionId) external view returns (uint256) {
        return _sessions[sessionId].balance;
    }

    /// @inheritdoc ISessionVault
    function getAgentBalance(address agent) external view returns (uint256) {
        bytes32[] storage sessions = _agentSessions[agent];
        uint256 total = 0;
        for (uint256 i = 0; i < sessions.length; i++) {
            if (_sessions[sessions[i]].active) {
                total += _sessions[sessions[i]].balance;
            }
        }
        return total;
    }

    /// @notice Returns session details
    /// @param sessionId The session ID
    function getSession(bytes32 sessionId) external view returns (Session memory) {
        return _sessions[sessionId];
    }

    /// @notice Returns all session IDs for an agent
    /// @param agent The agent address
    function getAgentSessions(address agent) external view returns (bytes32[] memory) {
        return _agentSessions[agent];
    }

    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        (newImplementation);
    }
}
