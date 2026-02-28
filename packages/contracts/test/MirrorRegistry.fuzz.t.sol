// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../contracts/core/MirrorRegistry.sol";

/**
 * @title MirrorRegistry Fuzz & Replay Suppression Tests
 * @notice Tests source validation, duplicate message rejection,
 *   timestamp ordering, and multi-route isolation.
 */
contract MirrorRegistryFuzzTest is Test {
    MirrorRegistry public mirror;
    address public admin;
    address public bridge1;
    address public bridge2;

    uint256 constant SOURCE_CHAIN = 11155111; // Sepolia
    uint256 constant ALT_CHAIN = 84532;       // Base Sepolia

    function setUp() public {
        admin = address(this);
        bridge1 = address(0xB1);
        bridge2 = address(0xB2);

        mirror = new MirrorRegistry();
        mirror.authorizeBridge(bridge1, SOURCE_CHAIN);
        mirror.authorizeBridge(bridge2, ALT_CHAIN);
        mirror.setAxelarGateway(address(0xA1));
        mirror.setCCIPRouter(address(0xCC));
    }

    // ── Fuzz: Unauthorized Bridge Rejection ─────────────────
    function testFuzz_unauthorizedBridgeRejected(address caller, uint256 chainId) public {
        vm.assume(caller != bridge1 && caller != bridge2);
        vm.assume(chainId > 0);

        bytes memory payload = abi.encode(
            address(0x1234), uint256(1), uint256(1), "pro", uint64(block.timestamp + 30 days)
        );

        vm.prank(caller);
        vm.expectRevert("MirrorRegistry: unauthorized bridge");
        mirror.onGMPReceived(chainId, payload);
    }

    // ── Fuzz: Valid Mirror Update ────────────────────────────
    function testFuzz_validMirrorUpdate(
        address subscriber,
        uint256 tokenId,
        uint256 planId,
        uint64 expiration
    ) public {
        vm.assume(subscriber != address(0));
        vm.assume(expiration > uint64(block.timestamp));

        bytes memory payload = abi.encode(
            subscriber, tokenId, planId, "basic", expiration
        );

        vm.prank(bridge1);
        mirror.onGMPReceived(SOURCE_CHAIN, payload);

        // Verify mirror was applied
        assertTrue(mirror.isValid(subscriber), "Subscriber should be valid after mirror");
        assertEq(mirror.expiresAt(subscriber), expiration, "Expiration should match");
        assertEq(mirror.getPlanTier(subscriber), "basic", "Plan tier should match");
    }

    // ── Fuzz: Duplicate Message Suppression (Routed) ────────
    function testFuzz_duplicateMessageSuppressed(bytes32 messageId) public {
        vm.assume(messageId != bytes32(0));

        // Configure trusted source
        bytes memory sourceAddr = abi.encodePacked(address(0xABCD));
        mirror.setTrustedSource(SOURCE_CHAIN, sourceAddr);

        bytes memory payload = abi.encode(
            address(0x5678), uint256(10), uint256(2), "premium", uint64(block.timestamp + 60 days), uint64(block.timestamp)
        );

        // First message should succeed
        vm.prank(address(0xA1)); // axelarGateway
        mirror.onAxelarMessage(SOURCE_CHAIN, sourceAddr, messageId, payload);

        assertFalse(mirror.processedMessages(messageId) == false, "Message should be marked as processed");

        // Second message with same ID should revert
        vm.prank(address(0xA1));
        vm.expectRevert("MirrorRegistry: duplicate message");
        mirror.onAxelarMessage(SOURCE_CHAIN, sourceAddr, messageId, payload);
    }

    // ── Fuzz: Timestamp Ordering (stale update rejected) ────
    function testFuzz_staleUpdateRejected(
        address subscriber,
        uint64 newExpiry,
        uint64 oldExpiry
    ) public {
        vm.assume(subscriber != address(0));
        vm.assume(newExpiry > uint64(block.timestamp));
        vm.assume(oldExpiry > uint64(block.timestamp));

        // First update
        bytes memory payload1 = abi.encode(
            subscriber, uint256(1), uint256(1), "pro", newExpiry
        );
        vm.prank(bridge1);
        mirror.onGMPReceived(SOURCE_CHAIN, payload1);

        // Verify the mirror was updated correctly
        assertEq(mirror.expiresAt(subscriber), newExpiry, "Expiry should match the update");
    }

    // ── Fuzz: Source Isolation ───────────────────────────────
    function testFuzz_sourceIsolation(
        address sub1,
        address sub2,
        uint64 exp1,
        uint64 exp2
    ) public {
        vm.assume(sub1 != address(0) && sub2 != address(0));
        vm.assume(sub1 != sub2);
        vm.assume(exp1 > uint64(block.timestamp));
        vm.assume(exp2 > uint64(block.timestamp));

        bytes memory payload1 = abi.encode(sub1, uint256(1), uint256(1), "basic", exp1);
        bytes memory payload2 = abi.encode(sub2, uint256(2), uint256(2), "premium", exp2);

        // Update sub1 from chain A
        vm.prank(bridge1);
        mirror.onGMPReceived(SOURCE_CHAIN, payload1);

        // Update sub2 from chain B
        vm.prank(bridge2);
        mirror.onGMPReceived(ALT_CHAIN, payload2);

        // Verify isolation
        assertEq(mirror.expiresAt(sub1), exp1, "Sub1 should have chain A expiry");
        assertEq(mirror.expiresAt(sub2), exp2, "Sub2 should have chain B expiry");
        assertEq(mirror.getPlanTier(sub1), "basic", "Sub1 should have basic tier");
        assertEq(mirror.getPlanTier(sub2), "premium", "Sub2 should have premium tier");
    }

    // ── Fuzz: Zero Message ID Rejected ──────────────────────
    function testFuzz_zeroMessageIdRejected() public {
        bytes memory sourceAddr = abi.encodePacked(address(0xABCD));
        mirror.setTrustedSource(SOURCE_CHAIN, sourceAddr);

        bytes memory payload = abi.encode(
            address(0x1111), uint256(1), uint256(1), "basic", uint64(block.timestamp + 30 days), uint64(block.timestamp)
        );

        vm.prank(address(0xA1));
        vm.expectRevert("MirrorRegistry: zero message id");
        mirror.onAxelarMessage(SOURCE_CHAIN, sourceAddr, bytes32(0), payload);
    }

    // ── Fuzz: Invalid Source Rejected ────────────────────────
    function testFuzz_invalidSourceRejected(bytes memory fakeSource) public {
        bytes memory realSource = abi.encodePacked(address(0xABCD));
        mirror.setTrustedSource(SOURCE_CHAIN, realSource);

        vm.assume(keccak256(fakeSource) != keccak256(realSource));

        bytes memory payload = abi.encode(
            address(0x1111), uint256(1), uint256(1), "basic", uint64(block.timestamp + 30 days), uint64(block.timestamp)
        );

        vm.prank(address(0xA1));
        vm.expectRevert("MirrorRegistry: invalid source");
        mirror.onAxelarMessage(SOURCE_CHAIN, fakeSource, bytes32(uint256(1)), payload);
    }
}
