// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/core/PlanFactory.sol";
import "../contracts/core/FeeCollector.sol";
import "../contracts/core/SubscriptionRegistry.sol";
import "../contracts/core/SessionVault.sol";
import "../contracts/core/ERC7579AutopayModule.sol";
import "../contracts/core/MirrorRegistry.sol";
import "../contracts/core/ZKUsageVerifier.sol";
import "../contracts/interfaces/IERC7579AutopayModule.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Mock USDC token for testing
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {
        _mint(msg.sender, 1_000_000_000 * 10 ** 6); // 1B USDC
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Mock Groth16 verifier that always returns true
contract MockGroth16Verifier {
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[] calldata
    ) external pure returns (bool) {
        return true;
    }
}

/// @title MEAPProtocolTest
/// @notice End-to-end Foundry tests for MEAP core contracts
contract MEAPProtocolTest is Test {
    // ============================================================
    //                       TEST STATE
    // ============================================================

    PlanFactory public planFactory;
    FeeCollector public feeCollector;
    SubscriptionRegistry public registry;
    SessionVault public sessionVault;
    ERC7579AutopayModule public autopayModule;
    MirrorRegistry public mirrorRegistry;
    ZKUsageVerifier public zkVerifier;
    MockGroth16Verifier public mockVerifier;
    MockUSDC public usdc;

    address public owner = address(this);
    address public provider = address(0x1);
    address public subscriber = address(0x2);
    address public agent = address(0x3);
    address public treasury = address(0x4);
    address public bridge = address(0x10);
    uint256 public constant SOURCE_CHAIN_ID = 1;

    uint256 public constant PLAN_PRICE = 10 * 10 ** 6; // 10 USDC
    uint32 public constant MONTHLY = 2_592_000; // 30 days
    uint64 public constant DURATION = 2_592_000; // 30 days

    // ============================================================
    //                       SETUP
    // ============================================================

    function setUp() public {
        // Deploy mock USDC
        usdc = new MockUSDC();

        // Deploy PlanFactory with USDC approved
        address[] memory approvedTokens = new address[](1);
        approvedTokens[0] = address(usdc);
        planFactory = new PlanFactory(approvedTokens);

        // Deploy FeeCollector
        feeCollector = new FeeCollector(treasury);

        // Deploy SubscriptionRegistry
        registry = new SubscriptionRegistry(
            "MEAP Subscription",
            "MEAP-SUB",
            address(planFactory)
        );

        // Deploy SessionVault
        sessionVault = new SessionVault();
        autopayModule = new ERC7579AutopayModule(
            address(planFactory),
            address(registry),
            address(feeCollector),
            address(this) // admin = test contract
        );

        // Deploy MirrorRegistry
        mirrorRegistry = new MirrorRegistry();

        // Deploy mock Groth16 verifier and ZKUsageVerifier
        mockVerifier = new MockGroth16Verifier();
        zkVerifier = new ZKUsageVerifier(
            address(sessionVault),
            address(feeCollector),
            address(planFactory)
        );
        zkVerifier.setGroth16Verifier(address(mockVerifier));

        // Fund test accounts
        usdc.mint(subscriber, 1_000 * 10 ** 6);
        usdc.mint(agent, 1_000 * 10 ** 6);

        // Register provider
        planFactory.registerProvider(provider);

        // Authorize this contract as biller on registry
        registry.authorizeBiller(address(this));
        registry.authorizeBiller(address(autopayModule));
        feeCollector.authorizeCollector(address(autopayModule));
        feeCollector.authorizeCollector(address(zkVerifier));
        sessionVault.authorizeSettler(address(zkVerifier));
    }

    // ============================================================
    //                  PLAN FACTORY TESTS
    // ============================================================

    function test_registerProvider() public {
        assertTrue(planFactory.isProvider(provider));
    }

    function test_registerProvider_revert_duplicate() public {
        vm.expectRevert("PlanFactory: already registered");
        planFactory.registerProvider(provider);
    }

    function test_createPlan() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan(
            "Pro Plan",
            "pro",
            PLAN_PRICE,
            MONTHLY,
            address(usdc),
            "ipfs://metadata"
        );

        assertEq(planId, 1);

        IPlanFactory.Plan memory plan = planFactory.getPlan(planId);
        assertEq(plan.name, "Pro Plan");
        assertEq(plan.tier, "pro");
        assertEq(plan.price, PLAN_PRICE);
        assertEq(plan.billingInterval, MONTHLY);
        assertEq(plan.provider, provider);
        assertTrue(plan.active);
    }

    function test_createPlan_revert_notProvider() public {
        vm.prank(subscriber);
        vm.expectRevert("PlanFactory: not a provider");
        planFactory.createPlan("Plan", "basic", PLAN_PRICE, MONTHLY, address(usdc), "");
    }

    function test_createPlan_revert_shortInterval() public {
        vm.prank(provider);
        vm.expectRevert("PlanFactory: interval must be >= 30 days");
        planFactory.createPlan("Plan", "basic", PLAN_PRICE, 1000, address(usdc), "");
    }

    function test_createPlan_revert_unapprovedToken() public {
        vm.prank(provider);
        vm.expectRevert("PlanFactory: token not approved");
        planFactory.createPlan("Plan", "basic", PLAN_PRICE, MONTHLY, address(0x999), "");
    }

    function test_deactivatePlan() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");

        vm.prank(provider);
        planFactory.deactivatePlan(planId);

        IPlanFactory.Plan memory plan = planFactory.getPlan(planId);
        assertFalse(plan.active);
    }

    function test_getProviderPlans() public {
        vm.startPrank(provider);
        planFactory.createPlan("Starter", "starter", 5 * 10 ** 6, MONTHLY, address(usdc), "");
        planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");
        planFactory.createPlan("Enterprise", "enterprise", 50 * 10 ** 6, MONTHLY, address(usdc), "");
        vm.stopPrank();

        uint256[] memory plans = planFactory.getProviderPlans(provider);
        assertEq(plans.length, 3);
    }

    // ============================================================
    //              CREATE PLAN FOR (EIP-712) TESTS
    // ============================================================

    function test_createPlanFor_withValidSignature() public {
        // Setup: Create a new provider with a known private key
        uint256 providerPk = 0xA11CE;
        address providerAddr = vm.addr(providerPk);
        planFactory.registerProvider(providerAddr);

        // Get the nonce before creating plan
        uint256 nonce = planFactory.nonces(providerAddr);
        assertEq(nonce, 0, "Nonce should start at 0");

        // Set deadline 1 hour from now
        uint256 deadline = block.timestamp + 1 hours;

        // Build the EIP-712 typed data hash
        bytes32 structHash = keccak256(abi.encode(
            planFactory.CREATE_PLAN_TYPEHASH(),
            providerAddr,
            keccak256(bytes("Pro Plan")),
            keccak256(bytes("pro")),
            PLAN_PRICE,
            MONTHLY,
            address(usdc),
            keccak256(bytes("")),
            nonce,
            deadline
        ));

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            planFactory.DOMAIN_SEPARATOR(),
            structHash
        ));

        // Sign the digest
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(providerPk, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // Relayer (this contract) calls createPlanFor
        uint256 planId = planFactory.createPlanFor(
            providerAddr,
            "Pro Plan",
            "pro",
            PLAN_PRICE,
            MONTHLY,
            address(usdc),
            "",
            deadline,
            signature
        );

        // Verify the plan was created with the correct owner
        IPlanFactory.Plan memory plan = planFactory.getPlan(planId);
        assertEq(plan.provider, providerAddr, "Provider should be the signer, not msg.sender");
        assertEq(plan.name, "Pro Plan");
        assertEq(plan.price, PLAN_PRICE);

        // Verify nonce was incremented
        assertEq(planFactory.nonces(providerAddr), 1, "Nonce should be incremented");

        // Verify provider plans mapping
        uint256[] memory plans = planFactory.getProviderPlans(providerAddr);
        assertEq(plans.length, 1);
        assertEq(plans[0], planId);
    }

    function test_createPlanFor_revert_expiredSignature() public {
        uint256 providerPk = 0xA11CE;
        address providerAddr = vm.addr(providerPk);
        planFactory.registerProvider(providerAddr);

        uint256 deadline = block.timestamp - 1; // Already expired
        uint256 nonce = planFactory.nonces(providerAddr);

        bytes32 structHash = keccak256(abi.encode(
            planFactory.CREATE_PLAN_TYPEHASH(),
            providerAddr,
            keccak256(bytes("Pro Plan")),
            keccak256(bytes("pro")),
            PLAN_PRICE,
            MONTHLY,
            address(usdc),
            keccak256(bytes("")),
            nonce,
            deadline
        ));

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            planFactory.DOMAIN_SEPARATOR(),
            structHash
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(providerPk, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert("PlanFactory: signature expired");
        planFactory.createPlanFor(
            providerAddr,
            "Pro Plan",
            "pro",
            PLAN_PRICE,
            MONTHLY,
            address(usdc),
            "",
            deadline,
            signature
        );
    }

    function test_createPlanFor_revert_replayAttack() public {
        uint256 providerPk = 0xA11CE;
        address providerAddr = vm.addr(providerPk);
        planFactory.registerProvider(providerAddr);

        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = planFactory.nonces(providerAddr);

        bytes32 structHash = keccak256(abi.encode(
            planFactory.CREATE_PLAN_TYPEHASH(),
            providerAddr,
            keccak256(bytes("Pro Plan")),
            keccak256(bytes("pro")),
            PLAN_PRICE,
            MONTHLY,
            address(usdc),
            keccak256(bytes("")),
            nonce,
            deadline
        ));

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            planFactory.DOMAIN_SEPARATOR(),
            structHash
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(providerPk, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        // First call should succeed
        planFactory.createPlanFor(
            providerAddr,
            "Pro Plan",
            "pro",
            PLAN_PRICE,
            MONTHLY,
            address(usdc),
            "",
            deadline,
            signature
        );

        // Second call with same signature should fail (nonce already used)
        vm.expectRevert("PlanFactory: invalid signature");
        planFactory.createPlanFor(
            providerAddr,
            "Pro Plan",
            "pro",
            PLAN_PRICE,
            MONTHLY,
            address(usdc),
            "",
            deadline,
            signature
        );
    }

    function test_createPlanFor_revert_invalidSignature() public {
        uint256 providerPk = 0xA11CE;
        address providerAddr = vm.addr(providerPk);
        planFactory.registerProvider(providerAddr);

        // Sign with a different private key
        uint256 attackerPk = 0xBAD;

        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = planFactory.nonces(providerAddr);

        bytes32 structHash = keccak256(abi.encode(
            planFactory.CREATE_PLAN_TYPEHASH(),
            providerAddr,
            keccak256(bytes("Pro Plan")),
            keccak256(bytes("pro")),
            PLAN_PRICE,
            MONTHLY,
            address(usdc),
            keccak256(bytes("")),
            nonce,
            deadline
        ));

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            planFactory.DOMAIN_SEPARATOR(),
            structHash
        ));

        // Sign with attacker's key instead of provider's key
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attackerPk, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert("PlanFactory: invalid signature");
        planFactory.createPlanFor(
            providerAddr,
            "Pro Plan",
            "pro",
            PLAN_PRICE,
            MONTHLY,
            address(usdc),
            "",
            deadline,
            signature
        );
    }

    function test_createPlanFor_revert_notProvider() public {
        uint256 userPk = 0xA11CE;
        address userAddr = vm.addr(userPk);
        // Note: NOT registering as provider

        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = planFactory.nonces(userAddr);

        bytes32 structHash = keccak256(abi.encode(
            planFactory.CREATE_PLAN_TYPEHASH(),
            userAddr,
            keccak256(bytes("Pro Plan")),
            keccak256(bytes("pro")),
            PLAN_PRICE,
            MONTHLY,
            address(usdc),
            keccak256(bytes("")),
            nonce,
            deadline
        ));

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            planFactory.DOMAIN_SEPARATOR(),
            structHash
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.expectRevert("PlanFactory: not a provider");
        planFactory.createPlanFor(
            userAddr,
            "Pro Plan",
            "pro",
            PLAN_PRICE,
            MONTHLY,
            address(usdc),
            "",
            deadline,
            signature
        );
    }

    // ============================================================
    //              SUBSCRIPTION REGISTRY TESTS
    // ============================================================

    function test_mintSubscription() public {
        // Create a plan first
        vm.prank(provider);
        uint256 planId = planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");

        // Mint subscription NFT
        uint256 tokenId = registry.mint(subscriber, planId, DURATION);

        assertEq(tokenId, 1);
        assertEq(registry.ownerOf(tokenId), subscriber);
        assertTrue(registry.isValid(tokenId));
        assertEq(registry.expiresAt(tokenId), uint64(block.timestamp) + DURATION);
    }

    function test_mintSubscription_revert_unauthorized() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");

        // Non-biller cannot mint
        registry.revokeBiller(address(this));
        vm.expectRevert("SubscriptionRegistry: unauthorized biller");
        registry.mint(subscriber, planId, DURATION);
    }

    function test_renewSubscription() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");

        uint256 tokenId = registry.mint(subscriber, planId, DURATION);
        uint64 originalExpiry = registry.expiresAt(tokenId);

        // Renew
        registry.renew(tokenId, DURATION);
        uint64 newExpiry = registry.expiresAt(tokenId);

        assertEq(newExpiry, originalExpiry + DURATION);
    }

    function test_cancelSubscription() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");

        uint256 tokenId = registry.mint(subscriber, planId, DURATION);
        assertTrue(registry.isValid(tokenId));

        // Cancel as owner
        vm.prank(subscriber);
        registry.cancel(tokenId);
        assertFalse(registry.isValid(tokenId));
    }

    function test_getPlanFeatures() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");

        uint256 tokenId = registry.mint(subscriber, planId, DURATION);

        (uint256 returnedPlanId, string memory tier) = registry.getPlanFeatures(tokenId);
        assertEq(returnedPlanId, planId);
        assertEq(tier, "pro");
    }

    function test_walletSubscription() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");

        registry.mint(subscriber, planId, DURATION);

        assertTrue(registry.hasActiveSubscription(subscriber));
        assertFalse(registry.hasActiveSubscription(agent));
    }

    function test_subscriptionExpiry() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");

        uint256 tokenId = registry.mint(subscriber, planId, DURATION);
        assertTrue(registry.isValid(tokenId));

        // Fast forward past expiration
        vm.warp(block.timestamp + DURATION + 1);
        assertFalse(registry.isValid(tokenId));
    }

    function test_renewExpiredSubscription() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");

        uint256 tokenId = registry.mint(subscriber, planId, DURATION);

        // Expire it
        vm.warp(block.timestamp + DURATION + 1000);
        assertFalse(registry.isValid(tokenId));

        // Renew from now
        registry.renew(tokenId, DURATION);
        assertTrue(registry.isValid(tokenId));
        // New expiry should be from now, not from old expiry
        assertEq(registry.expiresAt(tokenId), uint64(block.timestamp) + DURATION);
    }

    // ============================================================
    //                  FEE COLLECTOR TESTS
    // ============================================================

    function test_subscriptionFeeRate() public view {
        assertEq(feeCollector.subscriptionFeeRate(), 50); // 0.5%
    }

    function test_settlementFeeRate() public view {
        assertEq(feeCollector.settlementFeeRate(), 30); // 0.3%
    }

    function test_collectSubscriptionFee() public {
        feeCollector.authorizeCollector(address(this));

        uint256 fee = feeCollector.collectSubscriptionFee(PLAN_PRICE);
        // 10 USDC * 0.5% = 0.05 USDC = 50,000 atomic units
        assertEq(fee, 50_000);
    }

    function test_collectSettlementFee() public {
        feeCollector.authorizeCollector(address(this));

        uint256 fee = feeCollector.collectSettlementFee(100 * 10 ** 6); // 100 USDC
        // 100 USDC * 0.3% = 0.30 USDC = 300,000 atomic units
        assertEq(fee, 300_000);
    }

    // ============================================================
    //                  SESSION VAULT TESTS
    // ============================================================

    function test_fundSession() public {
        vm.startPrank(agent);
        usdc.approve(address(sessionVault), 100 * 10 ** 6);
        bytes32 sessionId = sessionVault.fundSession(100 * 10 ** 6, address(usdc));
        vm.stopPrank();

        assertEq(sessionVault.getBalance(sessionId), 100 * 10 ** 6);
        assertEq(sessionVault.getAgentBalance(agent), 100 * 10 ** 6);
    }

    function test_sessionSettlement() public {
        // Fund session
        vm.startPrank(agent);
        usdc.approve(address(sessionVault), 100 * 10 ** 6);
        bytes32 sessionId = sessionVault.fundSession(100 * 10 ** 6, address(usdc));
        vm.stopPrank();

        // Authorize settler
        sessionVault.authorizeSettler(address(this));

        // Settle 30 USDC
        sessionVault.settle(sessionId, 30 * 10 ** 6, provider);

        assertEq(sessionVault.getBalance(sessionId), 70 * 10 ** 6);
        assertEq(usdc.balanceOf(provider), 30 * 10 ** 6);
    }

    function test_sessionWithdraw() public {
        // Fund session
        vm.startPrank(agent);
        usdc.approve(address(sessionVault), 100 * 10 ** 6);
        bytes32 sessionId = sessionVault.fundSession(100 * 10 ** 6, address(usdc));

        uint256 balanceBefore = usdc.balanceOf(agent);

        // Withdraw remaining
        sessionVault.withdraw(sessionId);
        vm.stopPrank();

        assertEq(sessionVault.getBalance(sessionId), 0);
        assertEq(usdc.balanceOf(agent), balanceBefore + 100 * 10 ** 6);
    }

    function test_sessionWithdraw_revert_notOwner() public {
        vm.startPrank(agent);
        usdc.approve(address(sessionVault), 100 * 10 ** 6);
        bytes32 sessionId = sessionVault.fundSession(100 * 10 ** 6, address(usdc));
        vm.stopPrank();

        vm.prank(subscriber);
        vm.expectRevert("SessionVault: not session owner");
        sessionVault.withdraw(sessionId);
    }

    // ============================================================
    //              END-TO-END INTEGRATION TEST
    // ============================================================

    function test_e2e_subscriptionLifecycle() public {
        // 1. Provider creates a plan
        vm.prank(provider);
        uint256 planId = planFactory.createPlan(
            "Pro Plan",
            "pro",
            PLAN_PRICE,
            MONTHLY,
            address(usdc),
            "ipfs://pro-metadata"
        );

        // 2. Subscriber gets subscription NFT minted (by authorized biller)
        uint256 tokenId = registry.mint(subscriber, planId, DURATION);

        // 3. Verify subscription is active
        assertTrue(registry.isValid(tokenId));
        assertTrue(registry.hasActiveSubscription(subscriber));

        // 4. Check plan features
        (uint256 pid, string memory tier) = registry.getPlanFeatures(tokenId);
        assertEq(pid, planId);
        assertEq(tier, "pro");

        // 5. Time passes, subscription still valid
        vm.warp(block.timestamp + 15 days);
        assertTrue(registry.isValid(tokenId));

        // 6. Renew subscription
        registry.renew(tokenId, DURATION);
        assertTrue(registry.isValid(tokenId));

        // 7. Cancel subscription
        vm.prank(subscriber);
        registry.cancel(tokenId);
        assertFalse(registry.isValid(tokenId));
    }

    function test_e2e_sessionBillingCycle() public {
        // 1. Agent funds a session vault
        vm.startPrank(agent);
        usdc.approve(address(sessionVault), 100 * 10 ** 6);
        bytes32 sessionId = sessionVault.fundSession(100 * 10 ** 6, address(usdc));
        vm.stopPrank();

        assertEq(sessionVault.getBalance(sessionId), 100 * 10 ** 6);

        // 2. Authorize settlement
        sessionVault.authorizeSettler(address(this));

        // 3. Settle usage (simulating ZK proof verification)
        sessionVault.settle(sessionId, 25 * 10 ** 6, provider);
        assertEq(sessionVault.getBalance(sessionId), 75 * 10 ** 6);

        // 4. More usage
        sessionVault.settle(sessionId, 15 * 10 ** 6, provider);
        assertEq(sessionVault.getBalance(sessionId), 60 * 10 ** 6);

        // 5. Agent withdraws remaining
        vm.prank(agent);
        sessionVault.withdraw(sessionId);
        assertEq(sessionVault.getBalance(sessionId), 0);

        // 6. Provider received payments
        assertEq(usdc.balanceOf(provider), 40 * 10 ** 6);
    }

    function test_autopayMirrorPath_singleRenewalPerCycle() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan(
            "Pro Plan",
            "pro",
            PLAN_PRICE,
            MONTHLY,
            address(usdc),
            "ipfs://pro-plan"
        );

        vm.prank(subscriber);
        usdc.approve(address(autopayModule), type(uint256).max);

        uint64 startTime = uint64(block.timestamp + 5);
        IERC7579AutopayModule.AutopayConfig memory config = IERC7579AutopayModule
            .AutopayConfig({
                merchant: provider,
                maxAmount: PLAN_PRICE,
                token: address(usdc),
                interval: MONTHLY,
                startTime: startTime,
                planId: planId,
                maxTotalAmount: 0 // unlimited
            });

        vm.prank(subscriber);
        autopayModule.onInstall(abi.encode(config));

        vm.prank(subscriber);
        autopayModule.setMirrorDestination(8453);

        vm.warp(startTime + 1);
        vm.prank(provider);
        autopayModule.execute(subscriber, PLAN_PRICE);

        uint256 tokenId = registry.getWalletSubscription(subscriber);
        assertGt(tokenId, 0, "token must be minted on first pull");
        uint64 expiryAfterFirstBilling = registry.expiresAt(tokenId);

        vm.warp(block.timestamp + MONTHLY);
        vm.prank(provider);
        autopayModule.execute(subscriber, PLAN_PRICE);

        uint64 expiryAfterSecondBilling = registry.expiresAt(tokenId);
        assertEq(
            expiryAfterSecondBilling,
            expiryAfterFirstBilling + MONTHLY,
            "autopay renew should happen only once per cycle"
        );
    }

    function test_subscriptionRegistry_changePlan_preservesExpiry() public {
        vm.startPrank(provider);
        uint256 starterPlanId = planFactory.createPlan(
            "Starter Plan",
            "starter",
            PLAN_PRICE,
            MONTHLY,
            address(usdc),
            "ipfs://starter"
        );
        uint256 proPlanId = planFactory.createPlan(
            "Pro Plan",
            "pro",
            20 * 10 ** 6,
            MONTHLY,
            address(usdc),
            "ipfs://pro"
        );
        vm.stopPrank();

        uint256 tokenId = registry.mint(subscriber, starterPlanId, DURATION);
        uint64 expiryBefore = registry.expiresAt(tokenId);

        vm.prank(subscriber);
        registry.changePlan(tokenId, proPlanId);

        (uint256 changedPlanId,) = registry.getPlanFeatures(tokenId);
        uint64 expiryAfter = registry.expiresAt(tokenId);

        assertEq(changedPlanId, proPlanId, "plan should switch in-place");
        assertEq(expiryAfter, expiryBefore, "plan change must preserve expiry");
        assertEq(registry.getWalletSubscription(subscriber), tokenId, "wallet should retain same token");
    }

    function test_autopayUpdateConfig_reusesExistingTokenWhenPlanChanges() public {
        vm.startPrank(provider);
        uint256 starterPlanId = planFactory.createPlan(
            "Starter Plan",
            "starter",
            PLAN_PRICE,
            MONTHLY,
            address(usdc),
            "ipfs://starter"
        );
        uint256 proPlanId = planFactory.createPlan(
            "Pro Plan",
            "pro",
            20 * 10 ** 6,
            MONTHLY,
            address(usdc),
            "ipfs://pro"
        );
        vm.stopPrank();

        vm.prank(subscriber);
        usdc.approve(address(autopayModule), type(uint256).max);

        uint64 startTime = uint64(block.timestamp + 5);
        IERC7579AutopayModule.AutopayConfig memory starterConfig = IERC7579AutopayModule
            .AutopayConfig({
                merchant: provider,
                maxAmount: PLAN_PRICE,
                token: address(usdc),
                interval: MONTHLY,
                startTime: startTime,
                planId: starterPlanId,
                maxTotalAmount: 0
            });

        vm.prank(subscriber);
        autopayModule.onInstall(abi.encode(starterConfig));

        vm.warp(startTime + 1);
        vm.prank(provider);
        autopayModule.execute(subscriber, PLAN_PRICE);

        uint256 tokenId = registry.getWalletSubscription(subscriber);
        uint64 expiryAfterFirstBilling = registry.expiresAt(tokenId);

        IERC7579AutopayModule.AutopayConfig memory proConfig = IERC7579AutopayModule
            .AutopayConfig({
                merchant: provider,
                maxAmount: 20 * 10 ** 6,
                token: address(usdc),
                interval: MONTHLY,
                startTime: startTime,
                planId: proPlanId,
                maxTotalAmount: 0
            });

        vm.prank(subscriber);
        autopayModule.updateConfig(proConfig);

        vm.warp(block.timestamp + MONTHLY);
        vm.prank(provider);
        autopayModule.execute(subscriber, 20 * 10 ** 6);

        uint256 walletTokenAfterChange = registry.getWalletSubscription(subscriber);
        (uint256 activePlanId,) = registry.getPlanFeatures(walletTokenAfterChange);
        uint64 expiryAfterSecondBilling = registry.expiresAt(walletTokenAfterChange);

        assertEq(walletTokenAfterChange, tokenId, "plan change should reuse existing subscription token");
        assertEq(activePlanId, proPlanId, "renewal should switch the token to the new plan");
        assertEq(
            expiryAfterSecondBilling,
            expiryAfterFirstBilling + MONTHLY,
            "renewal after plan change should preserve cadence"
        );
    }

    // ============================================================
    //          SECURITY FIX: MirrorRegistry trustedSources
    // ============================================================

    function test_mirrorRegistry_onGMPReceived_revert_noTrustedSource() public {
        mirrorRegistry.authorizeBridge(bridge, SOURCE_CHAIN_ID);

        bytes memory sourceAddr = abi.encodePacked(address(0xABC));
        bytes32 msgId = keccak256("msg1");
        bytes memory payload = abi.encode(subscriber, uint256(1), uint256(1), "pro", uint64(block.timestamp + 30 days));

        vm.prank(bridge);
        vm.expectRevert("MirrorRegistry: source not configured");
        mirrorRegistry.onGMPReceived(SOURCE_CHAIN_ID, sourceAddr, msgId, payload);
    }

    function test_mirrorRegistry_onGMPReceived_revert_wrongSource() public {
        mirrorRegistry.authorizeBridge(bridge, SOURCE_CHAIN_ID);
        mirrorRegistry.setTrustedSource(SOURCE_CHAIN_ID, abi.encodePacked(address(0xABC)));

        bytes memory wrongSource = abi.encodePacked(address(0xDEF));
        bytes32 msgId = keccak256("msg1");
        bytes memory payload = abi.encode(subscriber, uint256(1), uint256(1), "pro", uint64(block.timestamp + 30 days));

        vm.prank(bridge);
        vm.expectRevert("MirrorRegistry: invalid source");
        mirrorRegistry.onGMPReceived(SOURCE_CHAIN_ID, wrongSource, msgId, payload);
    }

    function test_mirrorRegistry_onGMPReceived_revert_duplicateMessage() public {
        mirrorRegistry.authorizeBridge(bridge, SOURCE_CHAIN_ID);
        bytes memory sourceAddr = abi.encodePacked(address(0xABC));
        mirrorRegistry.setTrustedSource(SOURCE_CHAIN_ID, sourceAddr);

        bytes32 msgId = keccak256("msg1");
        bytes memory payload = abi.encode(subscriber, uint256(1), uint256(1), "pro", uint64(block.timestamp + 30 days));

        vm.prank(bridge);
        mirrorRegistry.onGMPReceived(SOURCE_CHAIN_ID, sourceAddr, msgId, payload);

        vm.prank(bridge);
        vm.expectRevert("MirrorRegistry: duplicate message");
        mirrorRegistry.onGMPReceived(SOURCE_CHAIN_ID, sourceAddr, msgId, payload);
    }

    function test_mirrorRegistry_onGMPReceived_success() public {
        mirrorRegistry.authorizeBridge(bridge, SOURCE_CHAIN_ID);
        bytes memory sourceAddr = abi.encodePacked(address(0xABC));
        mirrorRegistry.setTrustedSource(SOURCE_CHAIN_ID, sourceAddr);

        uint64 expiry = uint64(block.timestamp + 30 days);
        bytes32 msgId = keccak256("msg1");
        bytes memory payload = abi.encode(subscriber, uint256(1), uint256(1), "pro", expiry);

        vm.prank(bridge);
        mirrorRegistry.onGMPReceived(SOURCE_CHAIN_ID, sourceAddr, msgId, payload);

        assertTrue(mirrorRegistry.isValid(subscriber));
        assertEq(mirrorRegistry.expiresAt(subscriber), expiry);
        assertTrue(mirrorRegistry.processedMessages(msgId));
    }

    function test_mirrorRegistry_pause() public {
        mirrorRegistry.pause();
        mirrorRegistry.authorizeBridge(bridge, SOURCE_CHAIN_ID);
        bytes memory sourceAddr = abi.encodePacked(address(0xABC));
        mirrorRegistry.setTrustedSource(SOURCE_CHAIN_ID, sourceAddr);

        bytes32 msgId = keccak256("msg1");
        bytes memory payload = abi.encode(subscriber, uint256(1), uint256(1), "pro", uint64(block.timestamp + 30 days));

        vm.prank(bridge);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        mirrorRegistry.onGMPReceived(SOURCE_CHAIN_ID, sourceAddr, msgId, payload);
    }

    // ============================================================
    //      SECURITY FIX: SessionVault hardened IDs + whitelist
    // ============================================================

    function test_sessionVault_uniqueSessionIds() public {
        vm.startPrank(agent);
        usdc.approve(address(sessionVault), 300 * 10 ** 6);

        bytes32 id1 = sessionVault.fundSession(100 * 10 ** 6, address(usdc));
        bytes32 id2 = sessionVault.fundSession(100 * 10 ** 6, address(usdc));
        bytes32 id3 = sessionVault.fundSession(100 * 10 ** 6, address(usdc));
        vm.stopPrank();

        assertTrue(id1 != id2);
        assertTrue(id2 != id3);
        assertTrue(id1 != id3);
    }

    function test_sessionVault_pause_fundSession() public {
        sessionVault.pause();

        vm.startPrank(agent);
        usdc.approve(address(sessionVault), 100 * 10 ** 6);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        sessionVault.fundSession(100 * 10 ** 6, address(usdc));
        vm.stopPrank();
    }

    function test_sessionVault_withdraw_whenPaused() public {
        vm.startPrank(agent);
        usdc.approve(address(sessionVault), 100 * 10 ** 6);
        bytes32 sessionId = sessionVault.fundSession(100 * 10 ** 6, address(usdc));
        vm.stopPrank();

        sessionVault.pause();

        // Withdraw should still work when paused
        vm.prank(agent);
        sessionVault.withdraw(sessionId);
        assertEq(sessionVault.getBalance(sessionId), 0);
    }

    function test_sessionVault_providerWhitelist() public {
        sessionVault.authorizeSettler(address(this));

        vm.startPrank(agent);
        usdc.approve(address(sessionVault), 100 * 10 ** 6);
        bytes32 sessionId = sessionVault.fundSession(100 * 10 ** 6, address(usdc));
        vm.stopPrank();

        // Enable whitelist
        sessionVault.setProviderWhitelistEnabled(true);

        // Settle to non-whitelisted provider should revert
        vm.expectRevert("SessionVault: provider not whitelisted");
        sessionVault.settle(sessionId, 10 * 10 ** 6, provider);

        // Whitelist the provider
        sessionVault.whitelistProvider(provider);

        // Now should succeed
        sessionVault.settle(sessionId, 10 * 10 ** 6, provider);
        assertEq(sessionVault.getBalance(sessionId), 90 * 10 ** 6);
    }

    function test_sessionVault_providerWhitelist_disabled_by_default() public {
        sessionVault.authorizeSettler(address(this));

        vm.startPrank(agent);
        usdc.approve(address(sessionVault), 100 * 10 ** 6);
        bytes32 sessionId = sessionVault.fundSession(100 * 10 ** 6, address(usdc));
        vm.stopPrank();

        // Whitelist not enabled — any provider should work
        sessionVault.settle(sessionId, 10 * 10 ** 6, provider);
        assertEq(sessionVault.getBalance(sessionId), 90 * 10 ** 6);
    }

    // ============================================================
    //    SECURITY FIX: AutopayModule rate limiting + account pause
    // ============================================================

    function test_autopay_accountPause() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");

        vm.prank(subscriber);
        usdc.approve(address(autopayModule), type(uint256).max);

        uint64 startTime = uint64(block.timestamp + 5);
        IERC7579AutopayModule.AutopayConfig memory config = IERC7579AutopayModule.AutopayConfig({
            merchant: provider,
            maxAmount: PLAN_PRICE,
            token: address(usdc),
            interval: MONTHLY,
            startTime: startTime,
            planId: planId,
            maxTotalAmount: 0
        });

        vm.prank(subscriber);
        autopayModule.onInstall(abi.encode(config));

        // Subscriber pauses their own autopay
        vm.prank(subscriber);
        autopayModule.pauseAccount();

        vm.warp(startTime + 1);
        vm.prank(provider);
        vm.expectRevert("AutopayModule: account paused");
        autopayModule.execute(subscriber, PLAN_PRICE);

        // Subscriber unpauses
        vm.prank(subscriber);
        autopayModule.unpauseAccount();

        // Now should succeed
        vm.prank(provider);
        autopayModule.execute(subscriber, PLAN_PRICE);
    }

    function test_autopay_maxTotalAmount() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");

        vm.prank(subscriber);
        usdc.approve(address(autopayModule), type(uint256).max);

        uint64 startTime = uint64(block.timestamp + 5);
        // maxTotalAmount = 2 months worth
        IERC7579AutopayModule.AutopayConfig memory config = IERC7579AutopayModule.AutopayConfig({
            merchant: provider,
            maxAmount: PLAN_PRICE,
            token: address(usdc),
            interval: MONTHLY,
            startTime: startTime,
            planId: planId,
            maxTotalAmount: PLAN_PRICE * 2
        });

        vm.prank(subscriber);
        autopayModule.onInstall(abi.encode(config));

        // First pull — OK
        vm.warp(startTime + 1);
        vm.prank(provider);
        autopayModule.execute(subscriber, PLAN_PRICE);
        assertEq(autopayModule.totalPulled(subscriber), PLAN_PRICE);

        // Second pull — OK
        vm.warp(block.timestamp + MONTHLY);
        vm.prank(provider);
        autopayModule.execute(subscriber, PLAN_PRICE);
        assertEq(autopayModule.totalPulled(subscriber), PLAN_PRICE * 2);

        // Third pull — should revert (total exceeded)
        vm.warp(block.timestamp + MONTHLY);
        vm.prank(provider);
        vm.expectRevert("AutopayModule: total amount exceeded");
        autopayModule.execute(subscriber, PLAN_PRICE);
    }

    function test_autopay_globalPause() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");

        vm.prank(subscriber);
        usdc.approve(address(autopayModule), type(uint256).max);

        uint64 startTime = uint64(block.timestamp + 5);
        IERC7579AutopayModule.AutopayConfig memory config = IERC7579AutopayModule.AutopayConfig({
            merchant: provider,
            maxAmount: PLAN_PRICE,
            token: address(usdc),
            interval: MONTHLY,
            startTime: startTime,
            planId: planId,
            maxTotalAmount: 0
        });

        vm.prank(subscriber);
        autopayModule.onInstall(abi.encode(config));

        // Admin pauses globally
        autopayModule.pause();

        vm.warp(startTime + 1);
        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        autopayModule.execute(subscriber, PLAN_PRICE);

        // Admin unpauses
        autopayModule.unpause();

        vm.prank(provider);
        autopayModule.execute(subscriber, PLAN_PRICE);
    }

    // ============================================================
    //       SECURITY FIX: AutopayModule dispatch retry
    // ============================================================

    function test_autopay_retryDispatch_noPending() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");

        uint64 startTime = uint64(block.timestamp + 5);
        IERC7579AutopayModule.AutopayConfig memory config = IERC7579AutopayModule.AutopayConfig({
            merchant: provider,
            maxAmount: PLAN_PRICE,
            token: address(usdc),
            interval: MONTHLY,
            startTime: startTime,
            planId: planId,
            maxTotalAmount: 0
        });

        vm.prank(subscriber);
        usdc.approve(address(autopayModule), type(uint256).max);
        vm.prank(subscriber);
        autopayModule.onInstall(abi.encode(config));

        vm.expectRevert("AutopayModule: no pending dispatch");
        autopayModule.retryDispatch(subscriber);
    }

    function test_autopay_getPendingDispatch_empty() public view {
        (uint256 tokenId, uint256 destChain, address merchant, uint64 ts) = autopayModule.getPendingDispatch(subscriber);
        assertEq(tokenId, 0);
        assertEq(destChain, 0);
        assertEq(merchant, address(0));
        assertEq(ts, 0);
    }

    // ============================================================
    //       SECURITY FIX: PlanFactory pause
    // ============================================================

    function test_planFactory_pause_createPlan() public {
        planFactory.pause();

        vm.prank(provider);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");
    }

    function test_planFactory_deactivatePlan_whenPaused() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");

        planFactory.pause();

        // deactivatePlan should still work when paused
        vm.prank(provider);
        planFactory.deactivatePlan(planId);

        IPlanFactory.Plan memory plan = planFactory.getPlan(planId);
        assertFalse(plan.active);
    }

    // ============================================================
    //   SECURITY FIX: SubscriptionRegistry pause
    // ============================================================

    function test_registry_pause_mint() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");

        registry.pause();

        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        registry.mint(subscriber, planId, DURATION);
    }

    function test_registry_cancel_whenPaused() public {
        vm.prank(provider);
        uint256 planId = planFactory.createPlan("Pro", "pro", PLAN_PRICE, MONTHLY, address(usdc), "");

        uint256 tokenId = registry.mint(subscriber, planId, DURATION);

        registry.pause();

        // Cancel should still work when paused
        vm.prank(subscriber);
        registry.cancel(tokenId);
        assertFalse(registry.isValid(tokenId));
    }
}
