// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "../interfaces/ISubscriptionRegistry.sol";
import "../interfaces/IERC5643.sol";
import "../interfaces/IPlanFactory.sol";

interface ICrossChainTransport {
    function dispatch(
        uint256 destinationChainId,
        bytes calldata payload,
        address refundAddress
    ) external payable returns (bytes32 messageId);
}

/// @title SubscriptionRegistry
/// @notice ERC-5643 based subscription NFT lifecycle management
/// @dev Extends ERC-721 with subscription-specific logic: expiry, renewal, cancellation
contract SubscriptionRegistry is
    ERC721,
    ERC721Enumerable,
    IERC5643,
    ISubscriptionRegistry,
    Ownable,
    ReentrancyGuard,
    Pausable
{
    uint8 public constant ROUTE_AXELAR = 1;
    uint8 public constant ROUTE_CCIP = 2;

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

    /// @notice Primary (Axelar) transport adapter
    address public axelarTransport;

    /// @notice Fallback (CCIP) transport adapter
    address public ccipTransport;

    /// @notice Migration import window toggle
    bool public migrationEnabled = true;

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

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

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

    /// @inheritdoc ISubscriptionRegistry
    function setCrossChainTransports(
        address _axelarTransport,
        address _ccipTransport
    ) external onlyOwner {
        axelarTransport = _axelarTransport;
        ccipTransport = _ccipTransport;
    }

    /// @inheritdoc ISubscriptionRegistry
    function importSubscription(
        address to,
        uint256 tokenId,
        uint256 planId,
        uint64 expiration
    ) external onlyOwner whenNotPaused {
        require(migrationEnabled, "SubscriptionRegistry: migration closed");
        require(to != address(0), "SubscriptionRegistry: zero address");
        require(tokenId > 0, "SubscriptionRegistry: zero tokenId");
        require(_ownerOf(tokenId) == address(0), "SubscriptionRegistry: token exists");
        require(_walletTokens[to] == 0, "SubscriptionRegistry: wallet already imported");

        IPlanFactory.Plan memory plan = planFactory.getPlan(planId);
        require(plan.active, "SubscriptionRegistry: plan inactive");

        _safeMint(to, tokenId);
        _expirations[tokenId] = expiration;
        _tokenPlans[tokenId] = planId;
        _walletTokens[to] = tokenId;

        if (tokenId >= _nextTokenId) {
            _nextTokenId = tokenId + 1;
        }

        emit SubscriptionUpdate(tokenId, expiration);
        emit SubscriptionImported(to, tokenId, planId, expiration);
    }

    /// @inheritdoc ISubscriptionRegistry
    function finalizeMigration() external onlyOwner {
        require(migrationEnabled, "SubscriptionRegistry: migration closed");
        migrationEnabled = false;
        emit RegistryMigrationFinalized();
    }

    // ============================================================
    //                  SUBSCRIPTION LIFECYCLE
    // ============================================================

    /// @inheritdoc ISubscriptionRegistry
    function mint(
        address to,
        uint256 planId,
        uint64 duration
    ) external onlyBiller nonReentrant whenNotPaused returns (uint256 tokenId) {
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
    function renew(uint256 tokenId, uint64 extension) external onlyBiller nonReentrant whenNotPaused {
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
    function changePlan(uint256 tokenId, uint256 newPlanId) external {
        address owner_ = ownerOf(tokenId);
        require(
            msg.sender == owner_ || authorizedBillers[msg.sender],
            "SubscriptionRegistry: unauthorized"
        );

        require(_ownerOf(tokenId) != address(0), "SubscriptionRegistry: nonexistent token");

        uint256 currentPlanId = _tokenPlans[tokenId];
        require(currentPlanId != newPlanId, "SubscriptionRegistry: same plan");

        IPlanFactory.Plan memory newPlan = planFactory.getPlan(newPlanId);
        require(newPlan.active, "SubscriptionRegistry: plan inactive");

        _tokenPlans[tokenId] = newPlanId;
        _walletTokens[owner_] = tokenId;

        emit SubscriptionUpdate(tokenId, _expirations[tokenId]);
        emit SubscriptionPlanChanged(tokenId, currentPlanId, newPlanId, _expirations[tokenId]);
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
    function updateCrossChain(uint256 tokenId, bytes calldata gmMessage) external onlyBridge whenNotPaused {
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

    /// @inheritdoc ISubscriptionRegistry
    function dispatchCrossChainUpdate(
        uint256 tokenId,
        uint256 destinationChainId,
        address refundAddress
    ) external payable onlyBiller whenNotPaused returns (bytes32 messageId, uint8 routeUsed) {
        require(_ownerOf(tokenId) != address(0), "SubscriptionRegistry: nonexistent token");
        require(destinationChainId > 0, "SubscriptionRegistry: invalid destination");
        require(refundAddress != address(0), "SubscriptionRegistry: zero refund");

        bytes memory payload = _buildMirrorPayload(tokenId);

        if (axelarTransport != address(0)) {
            (bool ok, bytes memory data) = axelarTransport.call{value: msg.value}(
                abi.encodeWithSelector(
                    ICrossChainTransport.dispatch.selector,
                    destinationChainId,
                    payload,
                    refundAddress
                )
            );

            if (ok) {
                messageId = data.length >= 32 ? abi.decode(data, (bytes32)) : bytes32(0);
                emit CrossChainDispatchRequested(
                    tokenId,
                    destinationChainId,
                    ROUTE_AXELAR,
                    messageId
                );
                return (messageId, ROUTE_AXELAR);
            }

            emit CrossChainFallbackTriggered(tokenId, destinationChainId, data);
        }

        require(ccipTransport != address(0), "SubscriptionRegistry: no fallback transport");
        (bool fallbackOk, bytes memory fallbackData) = ccipTransport.call{value: msg.value}(
            abi.encodeWithSelector(
                ICrossChainTransport.dispatch.selector,
                destinationChainId,
                payload,
                refundAddress
            )
        );
        require(fallbackOk, "SubscriptionRegistry: fallback dispatch failed");

        messageId = fallbackData.length >= 32 ? abi.decode(fallbackData, (bytes32)) : bytes32(0);
        emit CrossChainDispatchRequested(tokenId, destinationChainId, ROUTE_CCIP, messageId);
        return (messageId, ROUTE_CCIP);
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

    function _buildMirrorPayload(uint256 tokenId) internal view returns (bytes memory payload) {
        uint256 planId = _tokenPlans[tokenId];
        IPlanFactory.Plan memory plan = planFactory.getPlan(planId);
        payload = abi.encode(
            ownerOf(tokenId),
            tokenId,
            planId,
            plan.tier,
            _expirations[tokenId],
            uint64(block.timestamp)
        );
    }

    // ============================================================
    //              REQUIRED OVERRIDES (ERC721 + Enumerable)
    // ============================================================

    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override(ERC721, ERC721Enumerable) returns (address) {
        address from = super._update(to, tokenId, auth);

        if (from != address(0) && _walletTokens[from] == tokenId) {
            delete _walletTokens[from];
        }

        if (to != address(0)) {
            _walletTokens[to] = tokenId;
        }

        return from;
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
