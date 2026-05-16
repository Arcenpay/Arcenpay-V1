// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "../interfaces/IPlanFactory.sol";
import "../utils/UpgradeableReentrancyGuard.sol";

/// @title PlanFactory
/// @notice SaaS provider plan configuration and deployment
/// @dev Manages provider registration and plan tier CRUD operations
/// @dev Supports EIP-712 meta-transactions for gasless plan creation
contract PlanFactory is
    Initializable,
    IPlanFactory,
    OwnableUpgradeable,
    UpgradeableReentrancyGuard,
    EIP712Upgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using ECDSA for bytes32;
    // ============================================================
    //                      EIP-712 CONSTANTS
    // ============================================================

    /// @notice EIP-712 typehash for createPlanFor meta-transaction
    bytes32 public constant CREATE_PLAN_TYPEHASH = keccak256(
        "CreatePlan(address provider,string name,string tier,uint256 price,uint32 billingInterval,address acceptedToken,string metadataURI,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant UPDATE_PLAN_TYPEHASH = keccak256(
        "UpdatePlan(address provider,uint256 planId,uint256 price,string metadataURI,uint256 nonce,uint256 deadline)"
    );

    // ============================================================
    //                         STORAGE
    // ============================================================

    /// @notice Counter for plan IDs
    uint256 private _nextPlanId;

    /// @notice EIP-712 nonces for replay protection (provider => nonce)
    mapping(address => uint256) public nonces;

    /// @notice Registered providers
    mapping(address => bool) private _providers;

    /// @notice Plan storage by ID
    mapping(uint256 => Plan) private _plans;

    /// @notice Provider address => array of plan IDs
    mapping(address => uint256[]) private _providerPlans;

    /// @notice Approved stablecoin tokens
    mapping(address => bool) public approvedTokens;

    // ============================================================
    //                        CONSTRUCTOR
    // ============================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address initialOwner, address[] memory _approvedTokens) external initializer {
        __Ownable_init(initialOwner);
        __UpgradeableReentrancyGuard_init();
        __EIP712_init("ArcenPay PlanFactory", "1");
        __Pausable_init();

        _nextPlanId = 1; // Start plan IDs at 1
        for (uint256 i = 0; i < _approvedTokens.length; i++) {
            require(_approvedTokens[i] != address(0), "PlanFactory: zero token");
            approvedTokens[_approvedTokens[i]] = true;
        }
    }

    // ============================================================
    //                      ADMIN FUNCTIONS
    // ============================================================

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Adds a token to the approved list
    /// @param token The token address to approve
    function approveToken(address token) external onlyOwner {
        require(token != address(0), "PlanFactory: zero token");
        approvedTokens[token] = true;
    }

    /// @notice Removes a token from the approved list
    /// @param token The token address to remove
    function revokeToken(address token) external onlyOwner {
        require(token != address(0), "PlanFactory: zero token");
        approvedTokens[token] = false;
    }

    // ============================================================
    //                    PROVIDER FUNCTIONS
    // ============================================================

    /// @inheritdoc IPlanFactory
    function registerProvider(address provider) external onlyOwner {
        require(provider != address(0), "PlanFactory: zero address");
        require(!_providers[provider], "PlanFactory: already registered");
        _providers[provider] = true;
        emit ProviderRegistered(provider);
    }

    /// @inheritdoc IPlanFactory
    function createPlan(
        string calldata name,
        string calldata tier,
        uint256 price,
        uint32 billingInterval,
        address acceptedToken,
        string calldata metadataURI
    ) external whenNotPaused returns (uint256 planId) {
        require(price > 0, "PlanFactory: price must be > 0");
        require(billingInterval >= 2_592_000, "PlanFactory: interval must be >= 30 days");
        require(approvedTokens[acceptedToken], "PlanFactory: token not approved");
        require(bytes(name).length > 0, "PlanFactory: empty name");

        _registerProviderIfNeeded(msg.sender);

        planId = _nextPlanId++;

        _plans[planId] = Plan({
            id: planId,
            provider: msg.sender,
            name: name,
            tier: tier,
            price: price,
            billingInterval: billingInterval,
            acceptedToken: acceptedToken,
            active: true,
            metadataURI: metadataURI
        });

        _providerPlans[msg.sender].push(planId);

        emit PlanCreated(planId, msg.sender, name, price, billingInterval);
    }

    /// @inheritdoc IPlanFactory
    function createPlanFor(
        address provider,
        string calldata name,
        string calldata tier,
        uint256 price,
        uint32 billingInterval,
        address acceptedToken,
        string calldata metadataURI,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused returns (uint256 planId) {
        require(block.timestamp <= deadline, "PlanFactory: signature expired");
        require(price > 0, "PlanFactory: price must be > 0");
        require(billingInterval >= 2_592_000, "PlanFactory: interval must be >= 30 days");
        require(approvedTokens[acceptedToken], "PlanFactory: token not approved");
        require(bytes(name).length > 0, "PlanFactory: empty name");

        // Get and increment nonce atomically
        uint256 currentNonce = nonces[provider];
        nonces[provider] = currentNonce + 1;

        // Build EIP-712 struct hash
        bytes32 structHash = keccak256(abi.encode(
            CREATE_PLAN_TYPEHASH,
            provider,
            keccak256(bytes(name)),
            keccak256(bytes(tier)),
            price,
            billingInterval,
            acceptedToken,
            keccak256(bytes(metadataURI)),
            currentNonce,
            deadline
        ));

        // Verify signature
        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSA.recover(digest, signature);
        require(recoveredSigner == provider, "PlanFactory: invalid signature");

        _registerProviderIfNeeded(provider);

        // Create plan with provider as owner (not msg.sender)
        planId = _nextPlanId++;

        _plans[planId] = Plan({
            id: planId,
            provider: provider,
            name: name,
            tier: tier,
            price: price,
            billingInterval: billingInterval,
            acceptedToken: acceptedToken,
            active: true,
            metadataURI: metadataURI
        });

        _providerPlans[provider].push(planId);

        emit PlanCreated(planId, provider, name, price, billingInterval);
    }

    /// @notice Returns the EIP-712 domain separator
    /// @return The domain separator hash
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @inheritdoc IPlanFactory
    function getPlan(uint256 planId) external view returns (Plan memory plan) {
        require(_plans[planId].id != 0, "PlanFactory: plan not found");
        return _plans[planId];
    }

    /// @inheritdoc IPlanFactory
    function updatePlan(
        uint256 planId,
        uint256 price,
        string calldata metadataURI
    ) external {
        Plan storage plan = _plans[planId];
        require(plan.id != 0, "PlanFactory: plan not found");
        require(plan.provider == msg.sender, "PlanFactory: not plan owner");

        if (price > 0) {
            plan.price = price;
        }
        if (bytes(metadataURI).length > 0) {
            plan.metadataURI = metadataURI;
        }

        emit PlanUpdated(planId);
    }

    /// @inheritdoc IPlanFactory
    function updatePlanFor(
        address provider,
        uint256 planId,
        uint256 price,
        string calldata metadataURI,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused {
        require(block.timestamp <= deadline, "PlanFactory: signature expired");

        Plan storage plan = _plans[planId];
        require(plan.id != 0, "PlanFactory: plan not found");
        require(plan.provider == provider, "PlanFactory: not plan owner");

        uint256 currentNonce = nonces[provider];
        nonces[provider] = currentNonce + 1;

        bytes32 structHash = keccak256(abi.encode(
            UPDATE_PLAN_TYPEHASH,
            provider,
            planId,
            price,
            keccak256(bytes(metadataURI)),
            currentNonce,
            deadline
        ));

        bytes32 digest = _hashTypedDataV4(structHash);
        address recoveredSigner = ECDSA.recover(digest, signature);
        require(recoveredSigner == provider, "PlanFactory: invalid signature");

        if (price > 0) {
            plan.price = price;
        }
        if (bytes(metadataURI).length > 0) {
            plan.metadataURI = metadataURI;
        }

        emit PlanUpdated(planId);
    }

    /// @inheritdoc IPlanFactory
    function deactivatePlan(uint256 planId) external {
        Plan storage plan = _plans[planId];
        require(plan.id != 0, "PlanFactory: plan not found");
        require(plan.provider == msg.sender, "PlanFactory: not plan owner");
        require(plan.active, "PlanFactory: already inactive");

        plan.active = false;
        emit PlanDeactivated(planId);
    }

    /// @inheritdoc IPlanFactory
    function getProviderPlans(address provider) external view returns (uint256[] memory planIds) {
        return _providerPlans[provider];
    }

    /// @inheritdoc IPlanFactory
    function isProvider(address provider) external view returns (bool) {
        return _providers[provider];
    }

    function _registerProviderIfNeeded(address provider) internal {
        require(provider != address(0), "PlanFactory: zero address");
        if (_providers[provider]) {
            return;
        }

        _providers[provider] = true;
        emit ProviderRegistered(provider);
    }

    function _authorizeUpgrade(address newImplementation) internal view override onlyOwner {
        (newImplementation);
    }
}
