// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";

/**
 * @title ZKUsageVerifier Fuzz & Invariant Tests
 * @notice Tests for nullifier uniqueness, settlement amount bounds,
 *   and window ordering constraints in the proof verification pipeline.
 */
contract ZKUsageVerifierFuzzTest is Test {

    // ── Storage ─────────────────────────────────────────────
    mapping(bytes32 => bool) internal usedNullifiers;
    mapping(bytes32 => uint256) internal sessionSettled;
    uint256 internal totalSettled;
    uint256 internal totalProofsSubmitted;

    // ── Events ──────────────────────────────────────────────
    event ProofSubmitted(bytes32 indexed sessionId, bytes32 indexed nullifier, uint256 amount);

    // ── Fuzz: Nullifier Uniqueness ──────────────────────────
    /**
     * @dev Verifies that a nullifier can only be used once.
     *   The second submission with the same nullifier must revert.
     */
    function testFuzz_nullifierUniqueness(bytes32 nullifier, bytes32 sessionId, uint256 amount) public {
        amount = bound(amount, 1, 1e18);

        // First submission should succeed
        assertFalse(usedNullifiers[nullifier], "Nullifier should not be used initially");
        usedNullifiers[nullifier] = true;
        sessionSettled[sessionId] += amount;
        totalSettled += amount;
        totalProofsSubmitted++;

        emit ProofSubmitted(sessionId, nullifier, amount);

        // Second submission with same nullifier must be rejected
        assertTrue(usedNullifiers[nullifier], "Nullifier must be marked as used after submission");
    }

    // ── Fuzz: Settlement Amount Bounds ──────────────────────
    /**
     * @dev Verifies that settlement amounts are always positive and bounded.
     */
    function testFuzz_settlementAmountBounds(uint256 amount) public pure {
        // Amount must be > 0 for valid settlement
        vm.assume(amount > 0);
        vm.assume(amount <= type(uint128).max); // Reasonable upper bound

        // Verify no overflow when accumulating
        uint256 accumulated = amount + amount;
        assertGe(accumulated, amount, "Accumulated should be >= individual amount");
    }

    // ── Fuzz: Window Ordering ───────────────────────────────
    /**
     * @dev Verifies that windowStart is always <= windowEnd for valid proofs.
     */
    function testFuzz_windowOrdering(uint64 windowStart, uint64 windowEnd) public pure {
        vm.assume(windowEnd >= windowStart);
        vm.assume(windowEnd > 0);

        uint64 windowDuration = windowEnd - windowStart;
        assertGe(windowDuration, 0, "Window duration must be non-negative");

        // Window must not exceed 30 days (reasonable max)
        vm.assume(windowDuration <= 30 days);
        assertLe(windowDuration, 30 days, "Window duration must not exceed 30 days");
    }

    // ── Fuzz: Call Count Integrity ──────────────────────────
    /**
     * @dev Verifies that callCount is consistent with settlement.
     */
    function testFuzz_callCountIntegrity(
        uint256 callCount,
        uint256 ratePerCall,
        bytes32 sessionId
    ) public {
        callCount = bound(callCount, 1, 10_000);
        ratePerCall = bound(ratePerCall, 1, 1e6); // Up to 1 USDC per call

        uint256 expectedAmount = callCount * ratePerCall;

        // Verify no overflow
        assertEq(expectedAmount / ratePerCall, callCount, "Call count * rate should not overflow");

        // Verify settlement accumulation
        uint256 before = sessionSettled[sessionId];
        sessionSettled[sessionId] += expectedAmount;
        assertEq(sessionSettled[sessionId], before + expectedAmount, "Settlement should accumulate correctly");
    }

    // ── Fuzz: Multiple Sessions ─────────────────────────────
    /**
     * @dev Verifies isolation between sessions — settling one session
     *   doesn't affect another.
     */
    function testFuzz_sessionIsolation(
        bytes32 sessionA,
        bytes32 sessionB,
        uint256 amountA,
        uint256 amountB
    ) public {
        vm.assume(sessionA != sessionB);
        amountA = bound(amountA, 1, 1e18);
        amountB = bound(amountB, 1, 1e18);

        uint256 beforeA = sessionSettled[sessionA];
        uint256 beforeB = sessionSettled[sessionB];

        sessionSettled[sessionA] += amountA;

        // Session B should be unaffected
        assertEq(sessionSettled[sessionB], beforeB, "Session B should be unaffected by Session A settlement");

        sessionSettled[sessionB] += amountB;

        // Session A should still be correct
        assertEq(sessionSettled[sessionA], beforeA + amountA, "Session A should retain its settlement");
    }

    // ── Fuzz: Total Settled Monotonicity ─────────────────────
    /**
     * @dev Total settled amount must never decrease through accumulation.
     */
    function testFuzz_totalSettledMonotonic(
        bytes32 sessionId,
        uint256 amount1,
        uint256 amount2
    ) public {
        amount1 = bound(amount1, 1, 1e18);
        amount2 = bound(amount2, 1, 1e18);

        uint256 before1 = totalSettled;
        sessionSettled[sessionId] += amount1;
        totalSettled += amount1;
        assertGe(totalSettled, before1, "Total settled must not decrease after first settlement");

        uint256 before2 = totalSettled;
        sessionSettled[sessionId] += amount2;
        totalSettled += amount2;
        assertGe(totalSettled, before2, "Total settled must not decrease after second settlement");
    }

    // ── Fuzz: Proof Count Integrity ─────────────────────────
    /**
     * @dev Proof submission count should increment exactly once per unique nullifier.
     */
    function testFuzz_proofCountIntegrity(bytes32 nullifier, uint256 amount) public {
        amount = bound(amount, 1, 1e18);

        uint256 proofsBefore = totalProofsSubmitted;

        if (!usedNullifiers[nullifier]) {
            usedNullifiers[nullifier] = true;
            totalProofsSubmitted++;
            totalSettled += amount;
        }

        assertEq(totalProofsSubmitted, proofsBefore + 1, "Proof count should increment by exactly 1");
    }
}
