// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/core/FeeCollector.sol";
import "../contracts/interfaces/IFeeCollector.sol";

/// @title FeeCollectorTest
/// @notice Tests for tier-based fee management in FeeCollector
contract FeeCollectorTest is Test {
    FeeCollector public feeCollector;

    address public treasury = makeAddr("treasury");
    address public provider1 = makeAddr("provider1");
    address public provider2 = makeAddr("provider2");

    function setUp() public {
        feeCollector = new FeeCollector(treasury);
        // Authorize this test contract as a fee collector
        feeCollector.authorizeCollector(address(this));
    }

    // ── syncProviderTier ─────────────────────────────────────────

    function test_syncProviderTier_setsCorrectFees() public {
        // Sync provider1 to FREE tier (0)
        feeCollector.syncProviderTier(provider1, 0);
        assertEq(feeCollector.getProviderSubFeeBps(provider1), 200, "FREE sub fee should be 200 bps");
        assertEq(feeCollector.getProviderSettleFeeBps(provider1), 100, "FREE settle fee should be 100 bps");

        // Sync provider1 to PLUS tier (1)
        feeCollector.syncProviderTier(provider1, 1);
        assertEq(feeCollector.getProviderSubFeeBps(provider1), 100, "PLUS sub fee should be 100 bps");
        assertEq(feeCollector.getProviderSettleFeeBps(provider1), 50, "PLUS settle fee should be 50 bps");

        // Sync provider2 to PRO tier (2)
        feeCollector.syncProviderTier(provider2, 2);
        assertEq(feeCollector.getProviderSubFeeBps(provider2), 50, "PRO sub fee should be 50 bps");
        assertEq(feeCollector.getProviderSettleFeeBps(provider2), 30, "PRO settle fee should be 30 bps");
    }

    function test_syncProviderTier_revertsForInvalidTier() public {
        vm.expectRevert("FeeCollector: invalid tier");
        feeCollector.syncProviderTier(provider1, 3);
    }

    function test_syncProviderTier_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit IFeeCollector.ProviderTierSynced(provider1, 1, 100, 50);
        feeCollector.syncProviderTier(provider1, 1);
    }

    // ── setTierFeeRates ──────────────────────────────────────────

    function test_setTierFeeRates_updatesDefaults() public {
        // Update FREE tier rates
        feeCollector.setTierFeeRates(0, 300, 150);
        assertEq(feeCollector.tierSubFeeBps(0), 300, "Updated FREE sub fee");
        assertEq(feeCollector.tierSettleFeeBps(0), 150, "Updated FREE settle fee");

        // Sync a provider to the updated FREE tier
        feeCollector.syncProviderTier(provider1, 0);
        assertEq(feeCollector.getProviderSubFeeBps(provider1), 300, "Provider should use updated tier rate");
    }

    // ── collectSubscriptionFeeFor ────────────────────────────────

    function test_collectSubscriptionFeeFor_usesProviderOverride() public {
        // Set provider1 to PLUS (100 bps = 1%)
        feeCollector.syncProviderTier(provider1, 1);

        uint256 amount = 10_000; // $100 in USDC (6 decimals)
        uint256 fee = feeCollector.collectSubscriptionFeeFor(amount, provider1);

        // 1% of 10000 = 100
        assertEq(fee, 100, "PLUS provider fee should be 1%");
    }

    // ── collectSettlementFeeFor ──────────────────────────────────

    function test_collectSettlementFeeFor_usesProviderOverride() public {
        // Set provider2 to PRO (30 bps = 0.3%)
        feeCollector.syncProviderTier(provider2, 2);

        uint256 amount = 100_000;
        uint256 fee = feeCollector.collectSettlementFeeFor(amount, provider2);

        // 0.3% of 100000 = 300
        assertEq(fee, 300, "PRO provider settle fee should be 0.3%");
    }

    // ── Default fallback ─────────────────────────────────────────

    function test_providerFeeDefaultsToProtocolRate() public {
        // provider1 has no override set — should fall back to SUBSCRIPTION_FEE_BPS (50)
        uint256 subFee = feeCollector.getProviderSubFeeBps(provider1);
        assertEq(subFee, 50, "Unset provider should use default 50 bps");

        uint256 settleFee = feeCollector.getProviderSettleFeeBps(provider1);
        assertEq(settleFee, 30, "Unset provider should use default 30 bps");
    }
}
