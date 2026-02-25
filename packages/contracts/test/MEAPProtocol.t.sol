// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/core/PlanFactory.sol";
import "../contracts/core/FeeCollector.sol";
import "../contracts/core/SubscriptionRegistry.sol";
import "../contracts/core/SessionVault.sol";
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
    MockUSDC public usdc;

    address public owner = address(this);
    address public provider = address(0x1);
    address public subscriber = address(0x2);
    address public agent = address(0x3);
    address public treasury = address(0x4);

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

        // Fund test accounts
        usdc.mint(subscriber, 1_000 * 10 ** 6);
        usdc.mint(agent, 1_000 * 10 ** 6);

        // Register provider
        planFactory.registerProvider(provider);

        // Authorize this contract as biller on registry
        registry.authorizeBiller(address(this));
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
}
