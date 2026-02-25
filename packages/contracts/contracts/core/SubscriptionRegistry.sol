// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../interfaces/ISubscriptionRegistry.sol";
import "../interfaces/IERC5643.sol";
import "../interfaces/IPlanFactory.sol";

/// @title SubscriptionRegistry
/// @notice ERC-5643 based subscription NFT lifecycle management
/// @dev Extends ERC-721 with subscription-specific logic: expiry, renewal, cancellation
contract SubscriptionRegistry is
    ERC721,
    ERC721Enumerable,
    IERC5643,
    ISubscriptionRegistry,
    Ownable,
    ReentrancyGuard
{
    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Counter for token IDs
    uint256 private _nextTokenId;

    /// @notice Reference to PlanFactory contract
    IPlanFactory public planFactory;

    /// @notice Token ID => subscription expiration timestamp
    mapping(uint256 => uint64) private _expirations;

    /// @notice Token ID => plan ID
    mapping(uint256 => uint256) private _tokenPlans;

    /// @notice Wallet address => token ID (one active subscription per wallet per registry)
    mapping(address => uint256) private _walletTokens;

    /// @notice Authorized billing contracts that can mint/renew
    mapping(address => bool) public authorizedBillers;

    /// @notice Authorized GMP bridge addresses for cross-chain updates
    mapping(address => bool) public authorizedBridges;

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    constructor(
        string memory name_,
        string memory symbol_,
        address _planFactory
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        require(_planFactory != address(0), "SubscriptionRegistry: zero PlanFactory");
        planFactory = IPlanFactory(_planFactory);
        _nextTokenId = 1; // Start at 1
    }

    // ============================================================
    //                       MODIFIERS
    // ============================================================

    modifier onlyBiller() {
        require(authorizedBillers[msg.sender], "SubscriptionRegistry: unauthorized biller");
        _;
    }

    modifier onlyBridge() {
        require(authorizedBridges[msg.sender], "SubscriptionRegistry: unauthorized bridge");
        _;
    }

    // ============================================================
    //                      ADMIN FUNCTIONS
    // ============================================================

    /// @notice Authorizes a billing contract
    function authorizeBiller(address biller) external onlyOwner {
        authorizedBillers[biller] = true;
    }

    /// @notice Revokes a billing contract's authorization
    function revokeBiller(address biller) external onlyOwner {
        authorizedBillers[biller] = false;
    }

    /// @notice Authorizes a GMP bridge address
    function authorizeBridge(address bridge) external onlyOwner {
        authorizedBridges[bridge] = true;
    }

    /// @notice Revokes a bridge's authorization
    function revokeBridge(address bridge) external onlyOwner {
        authorizedBridges[bridge] = false;
    }

    // ============================================================
    //                  SUBSCRIPTION LIFECYCLE
    // ============================================================

    /// @inheritdoc ISubscriptionRegistry
    function mint(
        address to,
        uint256 planId,
        uint64 duration
    ) external onlyBiller nonReentrant returns (uint256 tokenId) {
        require(to != address(0), "SubscriptionRegistry: zero address");
        require(duration > 0, "SubscriptionRegistry: zero duration");

        // Verify plan exists and is active
        IPlanFactory.Plan memory plan = planFactory.getPlan(planId);
        require(plan.active, "SubscriptionRegistry: plan inactive");

        // Check if wallet already has an active subscription
        uint256 existingToken = _walletTokens[to];
        if (existingToken != 0 && _ownerOf(existingToken) == to) {
            // If existing subscription for same plan, just renew it
            if (_tokenPlans[existingToken] == planId) {
                _renewInternal(existingToken, duration);
                return existingToken;
            }
        }

        // Mint new token
        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);

        // Set subscription data
        uint64 expiration = uint64(block.timestamp) + duration;
        _expirations[tokenId] = expiration;
        _tokenPlans[tokenId] = planId;
        _walletTokens[to] = tokenId;

        emit SubscriptionUpdate(tokenId, expiration);
        emit SubscriptionMinted(to, tokenId, planId, expiration);

        return tokenId;
    }

    /// @inheritdoc ISubscriptionRegistry
    function renew(uint256 tokenId, uint64 extension) external onlyBiller nonReentrant {
        _renewInternal(tokenId, extension);
    }

    /// @inheritdoc ISubscriptionRegistry
    function cancel(uint256 tokenId) external {
        address owner_ = ownerOf(tokenId);
        require(
            msg.sender == owner_ || authorizedBillers[msg.sender],
            "SubscriptionRegistry: unauthorized"
        );

        // Set expiry to now (access until current period end would require different logic)
        _expirations[tokenId] = uint64(block.timestamp);

        emit SubscriptionUpdate(tokenId, uint64(block.timestamp));
        emit SubscriptionCancelled(tokenId);
    }

    /// @inheritdoc ISubscriptionRegistry
    function isValid(uint256 tokenId) external view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) return false;
        return _expirations[tokenId] > block.timestamp;
    }

    /// @inheritdoc IERC5643
    function expiresAt(uint256 tokenId) external view returns (uint64) {
        require(_ownerOf(tokenId) != address(0), "SubscriptionRegistry: nonexistent token");
        return _expirations[tokenId];
    }

    /// @inheritdoc ISubscriptionRegistry
    function getPlanFeatures(uint256 tokenId) external view returns (uint256 planId, string memory planTier) {
        require(_ownerOf(tokenId) != address(0), "SubscriptionRegistry: nonexistent token");
        planId = _tokenPlans[tokenId];
        IPlanFactory.Plan memory plan = planFactory.getPlan(planId);
        planTier = plan.tier;
    }

    /// @inheritdoc ISubscriptionRegistry
    function updateCrossChain(uint256 tokenId, bytes calldata gmMessage) external onlyBridge {
        // Decode GMP message: (uint64 newExpiration, uint256 planId)
        (uint64 newExpiration, uint256 planId) = abi.decode(gmMessage, (uint64, uint256));

        if (_ownerOf(tokenId) == address(0)) {
            // Token doesn't exist on this chain — this is a MirrorRegistry concern
            // For now, just update if it exists
            revert("SubscriptionRegistry: token does not exist on this chain");
        }

        _expirations[tokenId] = newExpiration;
        _tokenPlans[tokenId] = planId;

        emit SubscriptionUpdate(tokenId, newExpiration);
    }

    // ============================================================
    //                    ERC-5643 IMPLEMENTATION
    // ============================================================

    /// @inheritdoc IERC5643
    function renewSubscription(uint256 tokenId, uint64 duration) external payable {
        // Public renewal (for direct user calls) — requires biller authorization in production
        // In MVP, delegate to authorized biller flow
        revert("SubscriptionRegistry: use authorized biller");
    }

    /// @inheritdoc IERC5643
    function cancelSubscription(uint256 tokenId) external payable {
        address owner_ = ownerOf(tokenId);
        require(msg.sender == owner_, "SubscriptionRegistry: not owner");

        _expirations[tokenId] = uint64(block.timestamp);

        emit SubscriptionUpdate(tokenId, uint64(block.timestamp));
        emit SubscriptionCancelled(tokenId);
    }

    /// @inheritdoc IERC5643
    function isRenewable(uint256 tokenId) external view returns (bool) {
        if (_ownerOf(tokenId) == address(0)) return false;
        // A subscription is renewable if it exists (even if expired)
        return true;
    }

    // ============================================================
    //                    QUERY FUNCTIONS
    // ============================================================

    /// @notice Returns the active subscription token for a wallet
    /// @param wallet The wallet address
    /// @return tokenId The token ID (0 if none)
    function getWalletSubscription(address wallet) external view returns (uint256) {
        return _walletTokens[wallet];
    }

    /// @notice Checks if a wallet has an active subscription
    /// @param wallet The wallet address
    /// @return True if wallet has a valid subscription
    function hasActiveSubscription(address wallet) external view returns (bool) {
        uint256 tokenId = _walletTokens[wallet];
        if (tokenId == 0) return false;
        if (_ownerOf(tokenId) != wallet) return false;
        return _expirations[tokenId] > block.timestamp;
    }

    // ============================================================
    //                    INTERNAL FUNCTIONS
    // ============================================================

    function _renewInternal(uint256 tokenId, uint64 extension) internal {
        require(_ownerOf(tokenId) != address(0), "SubscriptionRegistry: nonexistent token");
        require(extension > 0, "SubscriptionRegistry: zero extension");

        uint64 currentExpiry = _expirations[tokenId];
        uint64 newExpiry;

        if (currentExpiry > block.timestamp) {
            // Currently active — extend from current expiry
            newExpiry = currentExpiry + extension;
        } else {
            // Expired — restart from now
            newExpiry = uint64(block.timestamp) + extension;
        }

        _expirations[tokenId] = newExpiry;

        emit SubscriptionUpdate(tokenId, newExpiry);
        emit SubscriptionRenewed(tokenId, newExpiry, 0); // Amount set to 0 here; biller tracks payment
    }

    // ============================================================
    //              REQUIRED OVERRIDES (ERC721 + Enumerable)
    // ============================================================

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override(ERC721, ERC721Enumerable) returns (address) {
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(
        address account,
        uint128 value
    ) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, ERC721Enumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
